import type { Archetype } from "@illini/scoring";
import type { Queryable } from "./membership.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

export type Acquisition = "draft" | "waiver" | "free_agent" | "trade";

export interface RosteredPlayer {
  playerId: number;
  name: string;
  teamName: string | null;
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
    player_id: string; name: string; team_name: string | null; role: string | null;
    acquired_on: string; acquired_via: string;
  }>(
    `SELECT r.player_id, p.name, t.name AS team_name,
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
  { fantasyTeamId, playerId, on, via = "free_agent", settings = DEFAULT_SETTINGS }: {
    fantasyTeamId: number; playerId: number; on: string;
    via?: Acquisition; settings?: LeagueSettings;
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
    `INSERT INTO transaction (league_id, kind, payload) VALUES ($1, $2, $3)`,
    [leagueId, via, JSON.stringify({ fantasyTeamId, playerId, on })],
  );
}

/**
 * Closes a tenure. The row stays: a released player's past games still belong
 * to the team that started them.
 */
export async function releasePlayer(
  db: Queryable, { fantasyTeamId, playerId, on }: {
    fantasyTeamId: number; playerId: number; on: string;
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
     SELECT league_id, 'release', $2 FROM fantasy_team WHERE id = $1`,
    [fantasyTeamId, JSON.stringify({ fantasyTeamId, playerId, on })],
  );
  return true;
}

export interface PoolPlayer {
  playerId: number;
  name: string;
  teamName: string | null;
  conference: string | null;
  role: string | null;
  /** What the scoring model most recently called him — the slot eligibility. */
  archetype: Archetype | null;
  games: number;
  totalScore: number;
  averageScore: number;
  ownedBy: string | null;
}

/**
 * The player pool, ranked by season Player-Score, with ownership attached.
 *
 * One query rather than a list plus N ownership lookups, since the pool screen
 * is ~5,000 rows and the draft board reads it on every pick.
 */
export async function playerPool(
  db: Queryable,
  { leagueId, season, configId, limit = 200, offset = 0, availableOnly = false, search }: {
    leagueId: number; season: number; configId: number;
    limit?: number; offset?: number; availableOnly?: boolean; search?: string;
  },
): Promise<PoolPlayer[]> {
  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null; conference: string | null;
    role: string | null; archetype: Archetype | null; games: string; total: number;
    owned_by: string | null;
  }>(
    `WITH owned AS (
       SELECT r.player_id, t.name
         FROM roster_slot r JOIN fantasy_team t ON t.id = r.fantasy_team_id
        WHERE r.league_id = $1 AND r.released_on IS NULL
     ),
     totals AS (
       SELECT s.player_id, count(*) AS games, sum(s.score) AS total,
              max(st.role) FILTER (WHERE st.role IS NOT NULL) AS role,
              (array_agg(s.archetype ORDER BY s.played_on DESC))[1] AS archetype
         FROM player_game_score s
         JOIN player_game_stat st
           ON st.player_id = s.player_id AND st.played_on = s.played_on
        WHERE s.config_id = $3 AND st.season = $2
        GROUP BY s.player_id
     )
     SELECT p.id AS player_id, p.name, t.name AS team_name, t.conference,
            totals.role, totals.archetype, totals.games, totals.total,
            owned.name AS owned_by
       FROM totals
       JOIN player p ON p.id = totals.player_id
       LEFT JOIN team t ON t.id = p.team_id
       LEFT JOIN owned ON owned.player_id = p.id
      WHERE ($6::boolean IS NOT TRUE OR owned.player_id IS NULL)
        AND ($7::text IS NULL OR p.normalised LIKE '%' || $7 || '%')
      ORDER BY totals.total DESC
      LIMIT $4 OFFSET $5`,
    [leagueId, season, configId, limit, offset, availableOnly,
     search?.trim().toLowerCase() || null],
  );

  return rows.map((r) => ({
    playerId: Number(r.player_id),
    name: r.name,
    teamName: r.team_name,
    conference: r.conference,
    role: r.role,
    archetype: r.archetype,
    games: Number(r.games),
    totalScore: Number(r.total),
    averageScore: Number(r.total) / Math.max(1, Number(r.games)),
    ownedBy: r.owned_by,
  }));
}
