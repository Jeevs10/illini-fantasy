import type { Db } from "@illini/db";
import type { Queryable } from "./membership.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

export interface CountedGame {
  playerId: number;
  playerName: string;
  playedOn: string;
  slot: string;
  score: number;
  counted: boolean;
}

export interface TeamPeriod {
  fantasyTeamId: number;
  total: number;
  gamesPlayed: number;
  gamesCounted: number;
  games: CountedGame[];
}

/**
 * Scores one fantasy team over a scoring period.
 *
 * The games cap is applied by keeping the highest-scoring started games, which
 * is what every major fantasy platform does. The alternative — counting
 * chronologically until the cap is hit — punishes a manager for the order the
 * schedule happened to fall in, which is exactly the schedule luck the cap
 * exists to remove.
 *
 * Takes any queryable rather than the pool, for the same reason `claimPlayer`
 * does: a caller already inside a transaction — a games-cap change re-scoring
 * the weeks it just invalidated — has to run on the same connection rather than
 * racing itself from a second one.
 */
export async function scorePeriod(
  db: Queryable,
  { fantasyTeamId, configId, from, to, settings = DEFAULT_SETTINGS }: {
    fantasyTeamId: number; configId: number; from: string; to: string;
    settings?: LeagueSettings;
  },
): Promise<TeamPeriod> {
  const { rows } = await db.query<{
    player_id: string; name: string; played_on: string; slot: string; score: number;
  }>(
    `SELECT l.player_id, p.name, to_char(l.played_on, 'YYYY-MM-DD') AS played_on,
            l.slot, s.score
       FROM lineup_entry l
       JOIN player p ON p.id = l.player_id
       JOIN player_game_score s
         ON s.player_id = l.player_id
        AND s.played_on = l.played_on
        AND s.config_id = $2
      WHERE l.fantasy_team_id = $1
        AND l.played_on BETWEEN $3 AND $4
        AND l.slot NOT IN ('BENCH', 'IR')
      ORDER BY s.score DESC`,
    [fantasyTeamId, configId, from, to],
  );

  const games: CountedGame[] = rows.map((r, i) => ({
    playerId: Number(r.player_id),
    playerName: r.name,
    playedOn: r.played_on,
    slot: r.slot,
    score: Number(r.score),
    counted: i < settings.gamesCap,
  }));

  return {
    fantasyTeamId,
    total: games.filter((g) => g.counted).reduce((a, g) => a + g.score, 0),
    gamesPlayed: games.length,
    gamesCounted: Math.min(games.length, settings.gamesCap),
    games,
  };
}

export interface SettledMatchup {
  matchupId: number;
  week: number;
  home: TeamPeriod;
  away: TeamPeriod;
  winner: "home" | "away" | "tie";
}

/**
 * Settles every matchup in a week. Re-runnable: totals are recomputed from
 * scores rather than accumulated, so a Torvik revision that changes a player's
 * night flows through to the standings on the next run.
 */
export async function settleWeek(
  db: Db, leagueId: number, week: number,
): Promise<SettledMatchup[]> {
  const { rows: matchups } = await db.query<{
    id: string; home_team_id: string; away_team_id: string;
    starts_on: string; ends_on: string; config_id: string; settings: LeagueSettings;
  }>(
    `SELECT m.id, m.home_team_id, m.away_team_id,
            to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on,
            l.config_id, l.settings
       FROM matchup m JOIN league l ON l.id = m.league_id
      WHERE m.league_id = $1 AND m.week = $2`,
    [leagueId, week],
  );

  const settled: SettledMatchup[] = [];
  for (const m of matchups) {
    const settings = { ...DEFAULT_SETTINGS, ...(m.settings ?? {}) };
    const configId = Number(m.config_id);
    const [home, away] = await Promise.all([
      scorePeriod(db, { fantasyTeamId: Number(m.home_team_id), configId, from: m.starts_on, to: m.ends_on, settings }),
      scorePeriod(db, { fantasyTeamId: Number(m.away_team_id), configId, from: m.starts_on, to: m.ends_on, settings }),
    ]);

    await db.query(
      `UPDATE matchup SET home_points = $2, away_points = $3, settled_at = now() WHERE id = $1`,
      [m.id, home.total, away.total],
    );

    settled.push({
      matchupId: Number(m.id),
      week,
      home,
      away,
      winner: home.total === away.total ? "tie" : home.total > away.total ? "home" : "away",
    });
  }
  return settled;
}

export interface StandingsRow {
  fantasyTeamId: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

/**
 * Standings from settled regular-season matchups only — an unsettled week
 * counts for nobody, and neither does a playoff round. `round IS NULL` is the
 * whole test: a playoff loss is not a regular-season loss, or a team that
 * missed the bracket would watch its own eliminated opponent's playoff run
 * change the table it is no longer part of.
 */
export async function standings(db: Queryable, leagueId: number): Promise<StandingsRow[]> {
  const { rows } = await db.query<{
    id: string; name: string; wins: string; losses: string; ties: string;
    points_for: string | null; points_against: string | null;
  }>(
    `WITH sides AS (
       SELECT home_team_id AS team_id, home_points AS pf, away_points AS pa
         FROM matchup WHERE league_id = $1 AND settled_at IS NOT NULL AND round IS NULL
       UNION ALL
       SELECT away_team_id, away_points, home_points
         FROM matchup WHERE league_id = $1 AND settled_at IS NOT NULL AND round IS NULL
     )
     SELECT t.id, t.name,
            count(*) FILTER (WHERE s.pf > s.pa) AS wins,
            count(*) FILTER (WHERE s.pf < s.pa) AS losses,
            count(*) FILTER (WHERE s.pf = s.pa) AS ties,
            sum(s.pf) AS points_for, sum(s.pa) AS points_against
       FROM fantasy_team t LEFT JOIN sides s ON s.team_id = t.id
      WHERE t.league_id = $1
      GROUP BY t.id, t.name
      ORDER BY wins DESC, points_for DESC NULLS LAST`,
    [leagueId],
  );

  return rows.map((r) => ({
    fantasyTeamId: Number(r.id),
    name: r.name,
    wins: Number(r.wins),
    losses: Number(r.losses),
    ties: Number(r.ties),
    pointsFor: Number(r.points_for ?? 0),
    pointsAgainst: Number(r.points_against ?? 0),
  }));
}
