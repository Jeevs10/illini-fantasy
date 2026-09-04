import type { Db } from "@illini/db";
import type { Archetype, BlockName } from "@illini/scoring";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";
import { scorePeriod, type TeamPeriod } from "./settle.ts";

/** A league and the team the signed-in user runs in it. */
export interface Membership {
  leagueId: number;
  leagueName: string;
  season: number;
  configId: number;
  settings: LeagueSettings;
  role: string;
  fantasyTeamId: number | null;
  fantasyTeamName: string | null;
}

export async function membershipsFor(db: Db, userId: number): Promise<Membership[]> {
  const { rows } = await db.query<{
    league_id: string; league_name: string; season: number; config_id: string;
    settings: LeagueSettings; role: string; team_id: string | null; team_name: string | null;
  }>(
    `SELECT l.id AS league_id, l.name AS league_name, l.season, l.config_id, l.settings, m.role,
            t.id AS team_id, t.name AS team_name
       FROM league_member m
       JOIN league l ON l.id = m.league_id
       LEFT JOIN fantasy_team t ON t.league_id = l.id AND t.owner_id = m.user_id
      WHERE m.user_id = $1
      ORDER BY l.season DESC, l.id`,
    [userId],
  );
  return rows.map((r) => ({
    leagueId: Number(r.league_id),
    leagueName: r.league_name,
    season: r.season,
    configId: Number(r.config_id),
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    role: r.role,
    fantasyTeamId: r.team_id === null ? null : Number(r.team_id),
    fantasyTeamName: r.team_name,
  }));
}

export interface MatchupView {
  matchupId: number;
  week: number;
  startsOn: string;
  endsOn: string;
  settled: boolean;
  /** "Quarterfinal", "Semifinal", "Final", "Third place" — null in the regular season. */
  roundLabel: string | null;
  home: TeamPeriod & { name: string; seed: number | null };
  away: TeamPeriod & { name: string; seed: number | null };
}

const ROUND_LABELS: Record<string, string> = {
  QF: "Quarterfinal", SF: "Semifinal", F: "Final", "3rd": "Third place",
  R16: "Round of 16", R32: "Round of 32",
};

function roundLabel(round: string | null, bracket: string | null): string | null {
  if (round === null) return null;
  const base = ROUND_LABELS[round] ?? round;
  return bracket === "consolation" ? `Consolation ${base.toLowerCase()}` : base;
}

/**
 * The scoring period containing a date, or the nearest week that was played.
 *
 * The fallback matters more than it looks. A manager opening the app in July
 * should see how the year ended — and "nearest by date" gives them the last
 * week on the *schedule*, which in a season that stopped early is a fixture
 * nobody played: two zeroes and an empty game log. Preferring a week with
 * lineups in it means the off-season lands on the last week that happened.
 *
 * Inside a season this changes nothing: a date the schedule covers still wins
 * on the first clause.
 */
async function weekContaining(
  db: Db, leagueId: number, on: string,
): Promise<{ week: number } | null> {
  const { rows } = await db.query<{ week: number }>(
    `SELECT m.week FROM matchup m
      WHERE m.league_id = $1
      ORDER BY (m.starts_on <= $2::date AND m.ends_on >= $2::date) DESC,
               EXISTS (
                 SELECT 1 FROM lineup_entry l
                   JOIN fantasy_team ft ON ft.id = l.fantasy_team_id
                  WHERE ft.league_id = m.league_id
                    AND l.played_on BETWEEN m.starts_on AND m.ends_on
               ) DESC,
               abs(m.starts_on - $2::date)
      LIMIT 1`,
    [leagueId, on],
  );
  return rows[0] ?? null;
}

/** The first and last week the schedule actually holds. */
export async function seasonWeeks(
  db: Db, leagueId: number,
): Promise<{ first: number; last: number } | null> {
  const { rows } = await db.query<{ first: number; last: number }>(
    "SELECT min(week) AS first, max(week) AS last FROM matchup WHERE league_id = $1",
    [leagueId],
  );
  const row = rows[0];
  return row === undefined || row.first === null ? null
    : { first: Number(row.first), last: Number(row.last) };
}

/**
 * Every matchup in a week, scored live from stored player scores.
 *
 * Totals are recomputed rather than read from `matchup.home_points`, so a week
 * in progress reads the same way a settled one does and a Torvik revision shows
 * up without waiting for settlement.
 */
export async function weekMatchups(
  db: Db,
  { leagueId, configId, on, week, settings = DEFAULT_SETTINGS }: {
    leagueId: number; configId: number; on: string; week?: number;
    settings?: LeagueSettings;
  },
): Promise<MatchupView[]> {
  const target = week ?? (await weekContaining(db, leagueId, on))?.week;
  if (target === undefined) return [];

  const { rows } = await db.query<{
    id: string; week: number; starts_on: string; ends_on: string; settled_at: Date | null;
    round: string | null; bracket: string | null;
    home_team_id: string; away_team_id: string; home_name: string; away_name: string;
    home_seed: number | null; away_seed: number | null;
  }>(
    `SELECT m.id, m.week, to_char(m.starts_on,'YYYY-MM-DD') AS starts_on,
            to_char(m.ends_on,'YYYY-MM-DD') AS ends_on, m.settled_at, m.round, m.bracket,
            m.home_team_id, m.away_team_id, h.name AS home_name, a.name AS away_name,
            m.home_seed, m.away_seed
       FROM matchup m
       JOIN fantasy_team h ON h.id = m.home_team_id
       JOIN fantasy_team a ON a.id = m.away_team_id
      WHERE m.league_id = $1 AND m.week = $2
        -- A bracket slot nobody has reached yet has no teams to score. It shows
        -- on /playoffs as TBD; the week screen only shows matchups that exist.
        AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
      ORDER BY m.id`,
    [leagueId, target],
  );

  return Promise.all(rows.map(async (r) => {
    const [home, away] = await Promise.all([
      scorePeriod(db, { fantasyTeamId: Number(r.home_team_id), configId, from: r.starts_on, to: r.ends_on, settings }),
      scorePeriod(db, { fantasyTeamId: Number(r.away_team_id), configId, from: r.starts_on, to: r.ends_on, settings }),
    ]);
    return {
      matchupId: Number(r.id),
      week: r.week,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      settled: r.settled_at !== null,
      roundLabel: roundLabel(r.round, r.bracket),
      home: { ...home, name: r.home_name, seed: r.home_seed },
      away: { ...away, name: r.away_name, seed: r.away_seed },
    };
  }));
}

export interface GameLogEntry {
  playedOn: string;
  opponent: string | null;
  opponentStrength: number | null;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  archetype: Archetype;
  blocks: Record<BlockName, number>;
  raw: number;
  multiplier: number;
  minutesGate: number;
  score: number;
}

export interface PlayerCard {
  playerId: number;
  name: string;
  teamName: string | null;
  conference: string | null;
  classYear: string | null;
  role: string | null;
  ownedBy: string | null;
  games: number;
  totalScore: number;
  averageScore: number;
  log: GameLogEntry[];
}

/**
 * One player's season under one config, game by game.
 *
 * The blocks travel with each game because the point of the card is to answer
 * *why* a night scored what it did — a total on its own is the thing a manager
 * already disbelieves.
 */
export async function playerCard(
  db: Db, { playerId, configId, season, leagueId }: {
    playerId: number; configId: number; season: number; leagueId?: number;
  },
): Promise<PlayerCard | null> {
  const { rows: players } = await db.query<{
    id: string; name: string; team_name: string | null; conference: string | null;
    class_year: string | null; owned_by: string | null;
  }>(
    `SELECT p.id, p.name, t.name AS team_name, t.conference, p.class_year,
            (SELECT ft.name FROM roster_slot r JOIN fantasy_team ft ON ft.id = r.fantasy_team_id
              WHERE r.player_id = p.id AND r.released_on IS NULL
                AND ($2::bigint IS NULL OR r.league_id = $2) LIMIT 1) AS owned_by
       FROM player p LEFT JOIN team t ON t.id = p.team_id
      WHERE p.id = $1`,
    [playerId, leagueId ?? null],
  );
  const player = players[0];
  if (!player) return null;

  const { rows } = await db.query<{
    played_on: string; opponent: string | null; opponent_strength: number | null;
    minutes: number; stats: { points?: number; rebounds?: number; assists?: number };
    role: string | null; archetype: Archetype; blocks: Record<BlockName, number>;
    raw: number; multiplier: number; minutes_gate: number; score: number;
  }>(
    `SELECT to_char(s.played_on,'YYYY-MM-DD') AS played_on,
            opp.name AS opponent, rating.strength AS opponent_strength,
            st.minutes, st.stats, st.role,
            s.archetype, s.blocks, s.raw, s.multiplier, s.minutes_gate, s.score
       FROM player_game_score s
       JOIN player_game_stat st ON st.player_id = s.player_id AND st.played_on = s.played_on
       LEFT JOIN team opp ON opp.id = st.opponent_team_id
       LEFT JOIN LATERAL (
         SELECT strength FROM team_rating tr
          WHERE tr.team_id = st.opponent_team_id AND tr.season = st.season
            AND tr.as_of <= st.played_on
          ORDER BY tr.as_of DESC LIMIT 1
       ) rating ON true
      WHERE s.player_id = $1 AND s.config_id = $2 AND st.season = $3
      ORDER BY s.played_on DESC`,
    [playerId, configId, season],
  );

  const log: GameLogEntry[] = rows.map((r) => ({
    playedOn: r.played_on,
    opponent: r.opponent,
    opponentStrength: r.opponent_strength === null ? null : Number(r.opponent_strength),
    minutes: Number(r.minutes),
    points: Number(r.stats?.points ?? 0),
    rebounds: Number(r.stats?.rebounds ?? 0),
    assists: Number(r.stats?.assists ?? 0),
    archetype: r.archetype,
    blocks: r.blocks,
    raw: Number(r.raw),
    multiplier: Number(r.multiplier),
    minutesGate: Number(r.minutes_gate),
    score: Number(r.score),
  }));

  const total = log.reduce((a, g) => a + g.score, 0);
  return {
    playerId: Number(player.id),
    name: player.name,
    teamName: player.team_name,
    conference: player.conference,
    classYear: player.class_year,
    role: rows[0]?.role ?? null,
    ownedBy: player.owned_by,
    games: log.length,
    totalScore: total,
    averageScore: log.length === 0 ? 0 : total / log.length,
    log,
  };
}
