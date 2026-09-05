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

/** One starter's whole week: every game he played, and what they add up to. */
export interface PlayerWeek {
  playerId: number;
  playerName: string;
  slot: string;
  games: number;
  total: number;
  /**
   * Where his week lands once the nights he has not played yet are filled in
   * from form. Equal to `total` for a week with nothing left in it, and only
   * set by `periodOutlook` — settlement has no unplayed nights to project.
   */
  projected?: number;
}

export interface TeamPeriod {
  fantasyTeamId: number;
  total: number;
  gamesPlayed: number;
  gamesCounted: number;
  games: CountedGame[];
  /** The starters, each with their cumulative total — what the week is made of. */
  players: PlayerWeek[];
}

/**
 * Scores one fantasy team over a scoring period.
 *
 * A starter is started for the period, and everything he scores in it counts.
 * The team's total is the sum of its starters' cumulative totals — no best-of
 * selection, no cap. A player with three games contributes all three.
 *
 * This is deliberately a rule about *players*, not about games. The lineup is
 * set once for the period, so the question a manager answers is "who are my
 * seven?" and not "who are my seven tonight, and again tomorrow" — and the
 * answer to the first question should not be re-litigated by a scoring rule
 * that then discards most of what those seven did.
 *
 * The consequence, taken on purpose: a heavier slate is worth more. Two games
 * from an even starter beat one game from a better one, so who a team plays
 * this week is part of what a manager is picking. The previous cap existed to
 * neutralise exactly that; scheduling is now a thing to be good at instead.
 *
 * Takes any queryable rather than the pool, for the same reason `claimPlayer`
 * does: a caller already inside a transaction — `settlePlayoffs` scoring
 * several rounds on one connection — has to run on the same connection rather
 * than racing itself from a second one.
 */
export async function scorePeriod(
  db: Queryable,
  { fantasyTeamId, configId, from, to, settings = DEFAULT_SETTINGS, asOf }: {
    fantasyTeamId: number; configId: number; from: string; to: string;
    settings?: LeagueSettings;
    /**
     * The last night whose box scores may be read, when one applies.
     *
     * A database can hold the whole season's scores at once — a backfill, or a
     * finished season being replayed a night at a time — and a screen pinned to
     * a date inside that range must not read the ones dated after it. Without
     * the cap, a matchup two weeks out shows its real result. Settlement passes
     * nothing here: a week being settled is a week that has happened.
     */
    asOf?: string;
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
        AND ($5::date IS NULL OR l.played_on <= $5)
      ORDER BY l.played_on`,
    [fantasyTeamId, configId, from, to, asOf ?? null],
  );

  // Every started game counts, so `counted` is now always true. It stays on the
  // row because the screens still ask each game whether it scored, and because
  // a game that did not count is exactly what an IR or bench slot produces.
  const games: CountedGame[] = rows.map((r) => ({
    playerId: Number(r.player_id),
    playerName: r.name,
    playedOn: r.played_on,
    slot: r.slot,
    score: Number(r.score),
    counted: true,
  }));

  const byPlayer = new Map<number, PlayerWeek>();
  for (const g of games) {
    const held = byPlayer.get(g.playerId);
    if (held === undefined) {
      byPlayer.set(g.playerId, {
        playerId: g.playerId, playerName: g.playerName, slot: g.slot,
        games: 1, total: g.score,
      });
      continue;
    }
    held.games += 1;
    held.total += g.score;
  }

  return {
    fantasyTeamId,
    total: games.reduce((a, g) => a + g.score, 0),
    gamesPlayed: games.length,
    gamesCounted: games.length,
    games,
    players: [...byPlayer.values()].sort((a, b) => b.total - a.total),
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
      `UPDATE matchup SET home_points = $2, away_points = $3, settled_at = now(),
              config_id = $4, settings = $5
         WHERE id = $1`,
      [m.id, home.total, away.total, configId, JSON.stringify(settings)],
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
