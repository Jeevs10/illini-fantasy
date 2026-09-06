import type { Archetype } from "@illini/scoring";
import type { Queryable } from "./membership.ts";
import { DEFAULT_SETTINGS, KNOWN_ROLES, rolesFor, type LeagueSettings, type PositionRole } from "./slots.ts";

export type Acquisition = "draft" | "waiver" | "free_agent" | "trade";

export interface RosteredPlayer {
  playerId: number;
  name: string;
  teamName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  role: string | null;
  acquiredOn: string;
  acquiredVia: string;
}

/** Raised when a player is already owned, carrying who owns him. */
export class AlreadyRosteredError extends Error {
  constructor(readonly playerId: number, readonly byTeamId: number, readonly byTeamName: string) {
    super(`player ${playerId} is already rostered by ${byTeamName}`);
    this.name = "AlreadyRosteredError";
  }
}

export class RosterFullError extends Error {
  constructor(readonly fantasyTeamId: number, readonly size: number, readonly limit: number) {
    super(`team ${fantasyTeamId} has ${size} players, limit ${limit}`);
    this.name = "RosterFullError";
  }
}

export function rosterLimit(settings: LeagueSettings = DEFAULT_SETTINGS): number {
  return settings.starters.reduce((a, s) => a + s.count, 0) + settings.bench + settings.ir;
}

/**
 * The roster as it stood on a given night.
 *
 * Tenures are closed rather than deleted, so settling an old week sees the
 * players who were actually owned then — a trade in March does not rewrite who
 * scored for whom in January.
 */
export async function rosterOn(
  db: Queryable, fantasyTeamId: number, on: string,
): Promise<RosteredPlayer[]> {
  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null;
    primary_color: string | null; secondary_color: string | null; role: string | null;
    acquired_on: string; acquired_via: string;
  }>(
    `SELECT r.player_id, p.name, t.name AS team_name,
            t.primary_color, t.secondary_color,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = r.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role,
            to_char(r.acquired_on, 'YYYY-MM-DD') AS acquired_on, r.acquired_via
       FROM roster_slot r
       JOIN player p ON p.id = r.player_id
       LEFT JOIN team t ON t.id = p.team_id
      WHERE r.fantasy_team_id = $1
        AND r.acquired_on <= $2
        AND (r.released_on IS NULL OR r.released_on > $2)
      ORDER BY p.name`,
    [fantasyTeamId, on],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    name: r.name,
    teamName: r.team_name,
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    role: r.role,
    acquiredOn: r.acquired_on,
    acquiredVia: r.acquired_via,
  }));
}

/**
 * Adds a player to a roster.
 *
 * Ownership is exclusive per league, enforced by a unique index rather than by
 * this check alone — the read here exists to name the other owner in the error,
 * not to prevent the race. Two managers claiming one player at the same instant
 * is exactly the waiver case, and the loser must lose in the database.
 *
 * Takes any queryable rather than the pool, so a caller already inside a
 * transaction — a draft pick holds a lock on the draft row while it claims —
 * runs the claim on the same connection instead of racing itself from a second
 * one.
 */
export async function claimPlayer(
  db: Queryable,
  { fantasyTeamId, playerId, on, via = "free_agent", settings = DEFAULT_SETTINGS, byUserId }: {
    fantasyTeamId: number; playerId: number; on: string;
    via?: Acquisition; settings?: LeagueSettings; byUserId?: number;
  },
): Promise<void> {
  const { rows: teams } = await db.query<{ league_id: string }>(
    "SELECT league_id FROM fantasy_team WHERE id = $1", [fantasyTeamId],
  );
  const leagueId = teams[0]?.league_id;
  if (leagueId === undefined) throw new Error(`no fantasy team ${fantasyTeamId}`);

  const { rows: owners } = await db.query<{ id: string; name: string }>(
    `SELECT t.id, t.name FROM roster_slot r JOIN fantasy_team t ON t.id = r.fantasy_team_id
      WHERE r.league_id = $1 AND r.player_id = $2 AND r.released_on IS NULL`,
    [leagueId, playerId],
  );
  if (owners[0]) {
    throw new AlreadyRosteredError(playerId, Number(owners[0].id), owners[0].name);
  }

  const size = (await rosterOn(db, fantasyTeamId, on)).length;
  const limit = rosterLimit(settings);
  if (size >= limit) throw new RosterFullError(fantasyTeamId, size, limit);

  try {
    await db.query(
      `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
       VALUES ($1, $2, $3, $4, $5)`,
      [fantasyTeamId, leagueId, playerId, on, via],
    );
  } catch (error) {
    // 23505: the unique index caught a claim that landed between the read above
    // and this insert.
    if ((error as { code?: string }).code === "23505") {
      throw new AlreadyRosteredError(playerId, 0, "another team");
    }
    throw error;
  }

  await db.query(
    `INSERT INTO transaction (league_id, kind, payload, created_by) VALUES ($1, $2, $3, $4)`,
    [leagueId, via, JSON.stringify({ fantasyTeamId, playerId, on }), byUserId ?? null],
  );
}

/**
 * Closes a tenure. The row stays: a released player's past games still belong
 * to the team that started them.
 *
 * `via` names what closed it, for the transaction log's sake. A player who was
 * traded was not released, and a log that says otherwise is the one place a
 * manager goes to find out what happened to him.
 */
export async function releasePlayer(
  db: Queryable, { fantasyTeamId, playerId, on, via = "release" }: {
    fantasyTeamId: number; playerId: number; on: string; via?: string;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE roster_slot SET released_on = $3
      WHERE fantasy_team_id = $1 AND player_id = $2 AND released_on IS NULL`,
    [fantasyTeamId, playerId, on],
  );
  if ((rowCount ?? 0) === 0) return false;

  await db.query(
    `INSERT INTO transaction (league_id, kind, payload)
     SELECT league_id, $3, $2 FROM fantasy_team WHERE id = $1`,
    [fantasyTeamId, JSON.stringify({ fantasyTeamId, playerId, on }), via],
  );
  return true;
}

/**
 * Deletes the lineups a closed tenure can no longer stand behind.
 *
 * This lives here, next to `releasePlayer`, because every path that closes a
 * tenure owes it and closing one does not do it on its own. Lineups can be set
 * for nights that have not happened yet, so a player who leaves a roster on
 * Tuesday can still be sitting in Thursday's starting five — and settling would
 * count his points for a team that no longer owns him.
 *
 * Nights that have already tipped off stay exactly as they were: those points
 * were earned by the team that started him, which is the same reason tenures
 * close rather than delete. `at` is the clock the tip-off is measured against,
 * so it is the app's clock rather than the wall clock.
 */
export async function clearFutureLineups(
  db: Queryable, { fantasyTeamId, playerId, on, at }: {
    fantasyTeamId: number; playerId: number; on: string; at: Date;
  },
): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM lineup_entry le
      WHERE le.fantasy_team_id = $1 AND le.player_id = $2 AND le.played_on >= $3
        AND NOT EXISTS (SELECT 1 FROM game g
                         WHERE g.id = le.game_id AND g.tipoff IS NOT NULL AND g.tipoff <= $4)`,
    [fantasyTeamId, playerId, on, at],
  );
  return rowCount ?? 0;
}

/**
 * One player's slice of a single scoring period.
 *
 * The pool is a season ranking by default, which is the wrong question for
 * "who should I start in week 12" — the answer to that is who *plays* in week
 * 12, and a two-game week from a good player beats a three-game week from
 * nobody about as often as it does not.
 *
 * A week behind us reports what actually happened and projects nothing; a week
 * still to come has no results to report and is entirely projection; the week
 * under way is both, which is why `scored` and `projected` are two fields and
 * not one. `projected` is always the whole week — banked plus form for the
 * nights left — so it is comparable across all three cases.
 */
export interface PoolWeek {
  /** Game nights his real team plays inside the period. */
  games: number;
  /** Of those, the ones with a filed box score on or before the viewing date. */
  played: number;
  /** What he has actually banked inside the period. */
  scored: number;
  /**
   * Where his week lands: banked, plus his form for every night in it that has
   * not finished. Equal to `scored` for a period that is over.
   */
  projected: number;
}

export interface PoolPlayer {
  playerId: number;
  name: string;
  teamName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  conference: string | null;
  role: string | null;
  /** What the scoring model most recently called him — the slot eligibility. */
  archetype: Archetype | null;
  games: number;
  totalScore: number;
  averageScore: number;
  ownedBy: string | null;
  /** Present only when the pool was asked for one scoring period. */
  week?: PoolWeek;
}

export type PoolSort = "total" | "avg" | "games" | "weekProj" | "weekPts";

const POOL_ORDER: Record<PoolSort, string> = {
  total: "totals.total DESC",
  // Ties toward more games played — an average from two games outranking one
  // from twenty is the ordering the games-column exists to let a reader catch.
  avg: "(totals.total / totals.games) DESC, totals.games DESC",
  games: "totals.games DESC, totals.total DESC",
  // Both tie into the season total, so a week nobody plays in still ranks
  // sensibly rather than in whatever order the planner happened to produce.
  weekProj: "week_projected DESC, totals.total DESC",
  weekPts: "week_scored DESC, totals.total DESC",
};

/** The scoring period a pool ranking can be asked about instead of the season. */
export interface PoolWindow {
  from: string;
  to: string;
  /** The date the viewer treats as today — the barrier future scores sit behind. */
  today: string;
}

/**
 * The player pool, ranked by season Player-Score, with ownership attached.
 *
 * One query rather than a list plus N ownership lookups, since the pool screen
 * is ~5,000 rows and the draft board reads it on every pick.
 */
export async function playerPool(
  db: Queryable,
  {
    leagueId, season, configId, limit = 200, offset = 0, availableOnly = false, search, roles,
    sort = "total", asOf, window,
  }: {
    leagueId: number; season: number; configId: number;
    limit?: number; offset?: number; availableOnly?: boolean; search?: string; roles?: PositionRole[];
    sort?: PoolSort;
    /**
     * Rank and report one scoring period rather than the season. The season
     * columns still come back — a week is read against what a player usually
     * does — but each row gains its `week`, and the two week sorts become
     * available.
     */
    window?: PoolWindow;
    /**
     * Only count games played on or before this date. Without it the total is
     * the whole season's box scores regardless of what day the viewer is
     * looking from — right for a season that has actually finished, wrong for
     * a league (or the midseason demo) still mid-schedule, where a night that
     * has not been reached yet must not already be in anyone's average. Pass
     * the viewer's `viewDate()`.
     */
    asOf?: string;
  },
): Promise<PoolPlayer[]> {
  // The filter is asked for in the three lineup roles, but what is stored is
  // Torvik's own string — so the letters are expanded to every raw string that
  // maps onto one of them before they ever reach SQL.
  const rawRoles = roles && roles.length > 0
    ? KNOWN_ROLES.filter((raw) => rolesFor(raw).some((r) => roles.includes(r)))
    : null;

  // A week sort with no week to sort by would be a SQL error rather than an
  // empty column, so it falls back to the season ranking the screen shows
  // anyway.
  const ranking = window === undefined && (sort === "weekProj" || sort === "weekPts")
    ? "total" : sort;

  /*
   * The week, when one is asked for.
   *
   * `remaining` counts nights rather than summing a per-night projection,
   * because every night it counts is on or after today and so prices off
   * exactly the same form average: what the player has done before today. One
   * aggregate for the whole pool instead of a lateral average per player per
   * night, and the arithmetic is identical.
   *
   * The three-way split is the same barrier every other screen reads under. A
   * night behind us is finished whatever the box score says — a starter with
   * no line did not play, which is zero and not a game still to come. A night
   * after today is the season's own future and its stored score must not be
   * read, or a week the database already holds the answer to would report it.
   */
  const weekCte = window === undefined ? "" : `,
     nights AS (
       SELECT DISTINCT ON (p.id, g.played_on) p.id AS player_id, g.played_on
         FROM player p
         JOIN game g ON (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
        WHERE g.played_on BETWEEN $10 AND $11
        ORDER BY p.id, g.played_on, g.tipoff NULLS LAST
     ),
     form AS (
       SELECT sc.player_id, avg(sc.score) AS per_game
         FROM player_game_score sc
        WHERE sc.config_id = $3 AND sc.played_on < $12
        GROUP BY sc.player_id
     ),
     week AS (
       SELECT n.player_id,
              count(*) AS games,
              count(*) FILTER (WHERE s.score IS NOT NULL AND n.played_on <= $12) AS played,
              coalesce(sum(s.score) FILTER (WHERE s.score IS NOT NULL AND n.played_on <= $12), 0) AS scored,
              count(*) FILTER (
                WHERE n.played_on >= $12 AND (s.score IS NULL OR n.played_on > $12)
              ) AS remaining
         FROM nights n
         LEFT JOIN player_game_score s
           ON s.player_id = n.player_id AND s.played_on = n.played_on AND s.config_id = $3
        GROUP BY n.player_id
     )`;

  const weekColumns = window === undefined ? "" : `,
            coalesce(week.games, 0) AS week_games,
            coalesce(week.played, 0) AS week_played,
            coalesce(week.scored, 0) AS week_scored,
            coalesce(week.scored, 0)
              + coalesce(week.remaining, 0) * coalesce(form.per_game, 0) AS week_projected`;

  const weekJoins = window === undefined ? "" : `
       LEFT JOIN week ON week.player_id = p.id
       LEFT JOIN form ON form.player_id = p.id`;

  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null;
    primary_color: string | null; secondary_color: string | null; conference: string | null;
    role: string | null; archetype: Archetype | null; games: string; total: number;
    owned_by: string | null;
    week_games?: string; week_played?: string; week_scored?: number; week_projected?: number;
  }>(
    `WITH owned AS (
       SELECT r.player_id, t.name
         FROM roster_slot r JOIN fantasy_team t ON t.id = r.fantasy_team_id
        WHERE r.league_id = $1 AND r.released_on IS NULL
     ),
     totals AS (
       SELECT s.player_id, count(*) AS games, sum(s.score) AS total,
              (array_agg(st.role ORDER BY st.played_on DESC) FILTER (WHERE st.role IS NOT NULL))[1] AS role,
              (array_agg(s.archetype ORDER BY s.played_on DESC))[1] AS archetype
         FROM player_game_score s
         JOIN player_game_stat st
           ON st.player_id = s.player_id AND st.played_on = s.played_on
        WHERE s.config_id = $3 AND st.season = $2
          AND ($9::date IS NULL OR st.played_on <= $9)
        GROUP BY s.player_id
     )${weekCte}
     SELECT p.id AS player_id, p.name, t.name AS team_name,
            t.primary_color, t.secondary_color, t.conference,
            totals.role, totals.archetype, totals.games, totals.total,
            owned.name AS owned_by${weekColumns}
       FROM totals
       JOIN player p ON p.id = totals.player_id
       LEFT JOIN team t ON t.id = p.team_id
       LEFT JOIN owned ON owned.player_id = p.id${weekJoins}
      WHERE ($6::boolean IS NOT TRUE OR owned.player_id IS NULL)
        AND ($7::text IS NULL OR p.normalised LIKE '%' || $7 || '%')
        AND ($8::text[] IS NULL OR totals.role = ANY($8))
      ORDER BY ${POOL_ORDER[ranking]}
      LIMIT $4 OFFSET $5`,
    [leagueId, season, configId, limit, offset, availableOnly,
     search?.trim().toLowerCase() || null, rawRoles, asOf ?? null,
     ...(window === undefined ? [] : [window.from, window.to, window.today])],
  );

  return rows.map((r) => ({
    playerId: Number(r.player_id),
    name: r.name,
    teamName: r.team_name,
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    conference: r.conference,
    role: r.role,
    archetype: r.archetype,
    games: Number(r.games),
    totalScore: Number(r.total),
    averageScore: Number(r.total) / Math.max(1, Number(r.games)),
    ownedBy: r.owned_by,
    ...(window === undefined ? {} : {
      week: {
        games: Number(r.week_games ?? 0),
        played: Number(r.week_played ?? 0),
        scored: Number(r.week_scored ?? 0),
        projected: Number(r.week_projected ?? 0),
      },
    }),
  }));
}
