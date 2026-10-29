import type { Db } from "@illini/db";
import type { Queryable } from "./membership.ts";
import { NotOnRosterError } from "./lineups.ts";
import { activeLimit, rosterOn, RosterFullError } from "./roster.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

/**
 * Injured reserve in an `everyone` league.
 *
 * With no bench, a player who is hurt is a seat that scores nothing, and the
 * only way to field a replacement is to drop him. IR is the third option: a
 * seat outside the twelve, for a player the injury report lists out, that
 * frees one of the twelve for somebody else.
 *
 * A move to or from IR is a roster move like any other, so it lands at the
 * next lock. It closes the player's tenure and opens a new one — reserve or
 * not — at the same instant, which is what lets the `fielded` view keep
 * answering "what did this team hold at the lock" from tenures alone: the
 * week already under way still counts him (or still does not), and the next
 * one sees the new tenure.
 *
 * A manual league has IR as a lineup slot instead and never calls these.
 */

export class NotEveryoneLeagueError extends Error {
  constructor() {
    super("IR is a lineup slot in this league — set it on the lineup");
    this.name = "NotEveryoneLeagueError";
  }
}

export class NotInjuredError extends Error {
  constructor(readonly playerId: number, readonly status: string | null) {
    super(status === null
      ? `player ${playerId} has no injury report — only a player listed out can go on IR`
      : `player ${playerId} is listed ${status} — only a player listed out can go on IR`);
    this.name = "NotInjuredError";
  }
}

export class ReserveFullError extends Error {
  constructor(readonly limit: number) {
    super(`IR is full at ${limit}`);
    this.name = "ReserveFullError";
  }
}

async function settingsOf(q: Queryable, fantasyTeamId: number): Promise<{ leagueId: number; settings: LeagueSettings }> {
  const { rows } = await q.query<{ league_id: string; settings: LeagueSettings | null }>(
    `SELECT l.id AS league_id, l.settings FROM fantasy_team t JOIN league l ON l.id = t.league_id
      WHERE t.id = $1 FOR UPDATE OF t`,
    [fantasyTeamId],
  );
  if (!rows[0]) throw new Error(`no fantasy team ${fantasyTeamId}`);
  return { leagueId: Number(rows[0].league_id), settings: { ...DEFAULT_SETTINGS, ...(rows[0].settings ?? {}) } };
}

/** Swaps one tenure for the same player with `reserve` flipped, at one instant. */
async function flip(
  q: Queryable, { fantasyTeamId, playerId, on, at, reserve, leagueId }: {
    fantasyTeamId: number; playerId: number; on: string; at: Date; reserve: boolean; leagueId: number;
  },
): Promise<void> {
  const { rows } = await q.query<{ acquired_via: string }>(
    `UPDATE roster_slot SET released_on = $3, released_at = $4
      WHERE fantasy_team_id = $1 AND player_id = $2 AND released_on IS NULL
      RETURNING acquired_via`,
    [fantasyTeamId, playerId, on, at],
  );
  if (!rows[0]) throw new NotOnRosterError(playerId, fantasyTeamId);
  // The new tenure keeps how he was acquired: he was drafted, not "IR'd".
  await q.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via, acquired_at, reserve)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [fantasyTeamId, leagueId, playerId, on, rows[0].acquired_via, at, reserve],
  );
  await q.query(
    `INSERT INTO transaction (league_id, kind, payload) VALUES ($1, $2, $3)`,
    [leagueId, reserve ? "ir" : "activate", JSON.stringify({ fantasyTeamId, playerId, on })],
  );
}

async function inTransaction<T>(db: Db, work: (q: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out = await work(client);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Puts a player listed out on IR, from the next lock. */
export async function moveToReserve(
  db: Db, { fantasyTeamId, playerId, now = new Date() }: { fantasyTeamId: number; playerId: number; now?: Date },
): Promise<void> {
  await inTransaction(db, async (q) => {
    const { leagueId, settings } = await settingsOf(q, fantasyTeamId);
    if (settings.lineupMode !== "everyone") throw new NotEveryoneLeagueError();
    const on = now.toISOString().slice(0, 10);
    const held = await rosterOn(q, fantasyTeamId, on);
    const him = held.find((p) => p.playerId === playerId);
    if (!him || him.reserve) throw new NotOnRosterError(playerId, fantasyTeamId);
    if (held.filter((p) => p.reserve).length >= settings.ir) throw new ReserveFullError(settings.ir);

    const { rows } = await q.query<{ status: string }>(
      `SELECT status FROM player_availability WHERE player_id = $1 ORDER BY as_of DESC LIMIT 1`, [playerId]);
    const status = rows[0]?.status ?? null;
    if (status !== "out") throw new NotInjuredError(playerId, status);

    await flip(q, { fantasyTeamId, playerId, on, at: now, reserve: true, leagueId });
  });
}

/**
 * Brings a player back from IR, from the next lock. Needs a free seat among
 * the twelve — a team that filled his seat drops somebody first.
 */
export async function activateFromReserve(
  db: Db, { fantasyTeamId, playerId, now = new Date() }: { fantasyTeamId: number; playerId: number; now?: Date },
): Promise<void> {
  await inTransaction(db, async (q) => {
    const { leagueId, settings } = await settingsOf(q, fantasyTeamId);
    if (settings.lineupMode !== "everyone") throw new NotEveryoneLeagueError();
    const on = now.toISOString().slice(0, 10);
    const held = await rosterOn(q, fantasyTeamId, on);
    const him = held.find((p) => p.playerId === playerId);
    if (!him || !him.reserve) throw new NotOnRosterError(playerId, fantasyTeamId);
    const active = held.filter((p) => !p.reserve).length;
    const limit = activeLimit(settings);
    if (active >= limit) throw new RosterFullError(fantasyTeamId, active, limit);

    await flip(q, { fantasyTeamId, playerId, on, at: now, reserve: false, leagueId });
  });
}
