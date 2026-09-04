import type { Db } from "@illini/db";
import { requireCommissioner, type Queryable } from "./membership.ts";
import {
  AlreadyRosteredError, claimPlayer, clearFutureLineups, releasePlayer, rosterLimit, rosterOn,
} from "./roster.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

export type TradeStatus =
  | "proposed" | "accepted" | "rejected" | "cancelled"
  | "expired" | "vetoed" | "executed" | "invalid";

/** The statuses a trade can still move out of. Everything else is history. */
const LIVE: TradeStatus[] = ["proposed", "accepted"];

export class EmptyTradeError extends Error {
  constructor() {
    super("a trade has to move at least one player");
    this.name = "EmptyTradeError";
  }
}

export class NotTradeableError extends Error {
  constructor(readonly playerId: number, readonly fantasyTeamId: number) {
    super(`player ${playerId} is not on team ${fantasyTeamId}`);
    this.name = "NotTradeableError";
  }
}

export class TradeClosedError extends Error {
  constructor(readonly tradeId: number, readonly status: TradeStatus) {
    super(`trade ${tradeId} is ${status} and can no longer be answered`);
    this.name = "TradeClosedError";
  }
}

export class NotYourTradeError extends Error {
  constructor(readonly tradeId: number, readonly fantasyTeamId: number) {
    super(`trade ${tradeId} is not team ${fantasyTeamId}'s to answer`);
    this.name = "NotYourTradeError";
  }
}

/**
 * Raised when the deadline has passed and the deal was never agreed.
 *
 * Carries the date rather than a sentence, because the three callers that
 * report it — the offer form, the accept button and the CLI — each say it
 * differently and all of them need the day.
 */
export class TradeDeadlineError extends Error {
  constructor(readonly deadline: string) {
    super(`trading closed after ${deadline}`);
    this.name = "TradeDeadlineError";
  }
}

export class TradeRosterError extends Error {
  constructor(readonly teamName: string, readonly size: number, readonly limit: number) {
    super(`${teamName} would hold ${size} players, and the limit is ${limit}`);
    this.name = "TradeRosterError";
  }
}

// ---------------------------------------------------------------------------
// Reading a trade
// ---------------------------------------------------------------------------

export interface TradePlayer {
  playerId: number;
  name: string;
  /** His real school, not the fantasy team. */
  teamName: string | null;
}

export interface TradeSide {
  fantasyTeamId: number;
  teamName: string;
  /** Who this side is giving up. */
  gives: TradePlayer[];
}

export interface Trade {
  id: number;
  leagueId: number;
  /** The side that made the offer. Only the other one can accept it. */
  from: TradeSide;
  to: TradeSide;
  status: TradeStatus;
  message: string | null;
  /** Why it ended the way it did. Null while it is still live. */
  reason: string | null;
  proposedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  /** When the review window closes and the players move. Null until accepted. */
  executesAt: string | null;
  executedOn: string | null;
  vetoedBy: number | null;
  vetoedByName: string | null;
  settledAt: string | null;
}

interface TradeRow {
  id: string; league_id: string; from_team_id: string; to_team_id: string;
  from_name: string; to_name: string; status: TradeStatus;
  message: string | null; reason: string | null;
  created_at: Date; expires_at: Date; accepted_at: Date | null;
  executes_at: Date | null; executed_on: string | null;
  vetoed_by: string | null; vetoed_by_name: string | null; settled_at: Date | null;
}

const TRADE_SELECT = `
  SELECT t.id, t.league_id, t.from_team_id, t.to_team_id,
         f.name AS from_name, o.name AS to_name, t.status, t.message, t.reason,
         t.created_at, t.expires_at, t.accepted_at, t.executes_at,
         to_char(t.executed_on, 'YYYY-MM-DD') AS executed_on,
         t.vetoed_by, u.display_name AS vetoed_by_name, t.settled_at
    FROM trade t
    JOIN fantasy_team f ON f.id = t.from_team_id
    JOIN fantasy_team o ON o.id = t.to_team_id
    LEFT JOIN app_user u ON u.id = t.vetoed_by`;

/**
 * Attaches the players to a set of trades.
 *
 * One query for every trade on the page rather than two per trade: the trades
 * screen shows an inbox, an outbox, everything under review and a history, and
 * a per-trade lookup turns that into thirty round trips.
 */
async function withItems(q: Queryable, rows: TradeRow[]): Promise<Trade[]> {
  if (rows.length === 0) return [];
  const { rows: items } = await q.query<{
    trade_id: string; fantasy_team_id: string; player_id: string;
    name: string; team_name: string | null;
  }>(
    `SELECT i.trade_id, i.fantasy_team_id, i.player_id, p.name, t.name AS team_name
       FROM trade_item i
       JOIN player p ON p.id = i.player_id
       LEFT JOIN team t ON t.id = p.team_id
      WHERE i.trade_id = ANY($1::bigint[])
      ORDER BY p.name`,
    [rows.map((r) => r.id)],
  );

  return rows.map((r) => {
    const mine = items.filter((i) => i.trade_id === r.id);
    const side = (fantasyTeamId: string, teamName: string): TradeSide => ({
      fantasyTeamId: Number(fantasyTeamId),
      teamName,
      gives: mine.filter((i) => i.fantasy_team_id === fantasyTeamId).map((i) => ({
        playerId: Number(i.player_id), name: i.name, teamName: i.team_name,
      })),
    });
    return {
      id: Number(r.id),
      leagueId: Number(r.league_id),
      from: side(r.from_team_id, r.from_name),
      to: side(r.to_team_id, r.to_name),
      status: r.status,
      message: r.message,
      reason: r.reason,
      proposedAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      acceptedAt: r.accepted_at === null ? null : r.accepted_at.toISOString(),
      executesAt: r.executes_at === null ? null : r.executes_at.toISOString(),
      executedOn: r.executed_on,
      vetoedBy: r.vetoed_by === null ? null : Number(r.vetoed_by),
      vetoedByName: r.vetoed_by_name,
      settledAt: r.settled_at === null ? null : r.settled_at.toISOString(),
    };
  });
}

/**
 * Trades in a league, newest first.
 *
 * `involving` narrows to one team's own deals; without it the answer is the
 * whole league's, which is what the review window is for — an accepted trade is
 * public before it happens, or nobody can object to it.
 */
export async function listTrades(
  db: Db, { leagueId, involving, statuses, limit = 40 }: {
    leagueId: number; involving?: number; statuses?: TradeStatus[]; limit?: number;
  },
): Promise<Trade[]> {
  const { rows } = await db.query<TradeRow>(
    `${TRADE_SELECT}
      WHERE t.league_id = $1
        AND ($2::bigint IS NULL OR t.from_team_id = $2 OR t.to_team_id = $2)
        AND ($3::text[] IS NULL OR t.status = ANY($3))
      ORDER BY (t.status IN ('proposed', 'accepted')) DESC, t.created_at DESC, t.id DESC
      LIMIT $4`,
    [leagueId, involving ?? null, statuses ?? null, limit],
  );
  return withItems(db, rows);
}

export async function tradeById(q: Queryable, tradeId: number): Promise<Trade | null> {
  const { rows } = await q.query<TradeRow>(`${TRADE_SELECT} WHERE t.id = $1`, [tradeId]);
  return rows[0] ? (await withItems(q, rows))[0]! : null;
}

export interface TradeableTeam {
  fantasyTeamId: number;
  teamName: string;
  ownerName: string | null;
  players: TradePlayer[];
}

/**
 * Every team's roster as it stands, for the side of the form where a manager
 * picks who they want.
 *
 * A trade is the one transaction that needs to see somebody else's roster, and
 * it needs all of them at once: the question is not "what does team 4 have", it
 * is "who in this league can help me".
 */
export async function tradeableRosters(
  db: Db, { leagueId, on }: { leagueId: number; on: string },
): Promise<TradeableTeam[]> {
  const { rows } = await db.query<{
    fantasy_team_id: string; team_name: string; owner_name: string | null;
    player_id: string | null; player_name: string | null; school: string | null;
  }>(
    `SELECT ft.id AS fantasy_team_id, ft.name AS team_name, u.display_name AS owner_name,
            p.id AS player_id, p.name AS player_name, t.name AS school
       FROM fantasy_team ft
       LEFT JOIN app_user u ON u.id = ft.owner_id
       LEFT JOIN roster_slot r
         ON r.fantasy_team_id = ft.id AND r.acquired_on <= $2
        AND (r.released_on IS NULL OR r.released_on > $2)
       LEFT JOIN player p ON p.id = r.player_id
       LEFT JOIN team t ON t.id = p.team_id
      WHERE ft.league_id = $1
      ORDER BY ft.id, p.name`,
    [leagueId, on],
  );

  const teams = new Map<string, TradeableTeam>();
  for (const row of rows) {
    let team = teams.get(row.fantasy_team_id);
    if (!team) {
      team = {
        fantasyTeamId: Number(row.fantasy_team_id),
        teamName: row.team_name,
        ownerName: row.owner_name,
        players: [],
      };
      teams.set(row.fantasy_team_id, team);
    }
    if (row.player_id !== null) {
      team.players.push({
        playerId: Number(row.player_id),
        name: row.player_name!,
        teamName: row.school,
      });
    }
  }
  return [...teams.values()];
}

// ---------------------------------------------------------------------------
// The deadline
// ---------------------------------------------------------------------------

/**
 * Whether trading has closed.
 *
 * Compared as roster days rather than as instants, because that is the unit
 * every tenure in this system is dated in and it is the unit a manager reads a
 * deadline in. The deadline day is inclusive: "the deadline is March 1" means a
 * deal struck on March 1 is a deal.
 *
 * The deadline binds the *handshake*. An accepted trade still executes when its
 * review window closes, even if that lands the day after — the window belongs
 * to the league and the commissioner, and voiding a deal two managers agreed to
 * in time because somebody else's review period straddled midnight punishes
 * them for a setting they do not control.
 */
export function tradingClosed(settings: LeagueSettings, now: Date): boolean {
  return settings.tradeDeadline !== null && isoDay(now) > settings.tradeDeadline;
}

/**
 * The first moment after a deadline.
 *
 * An offer killed by the deadline is dated to it rather than to the moment
 * somebody finally loaded the page, the same rule the expiry and the execution
 * already follow.
 */
export function deadlinePassedAt(deadline: string): Date {
  const at = new Date(`${deadline}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

interface LeagueContext {
  leagueId: number;
  settings: LeagueSettings;
}

async function leagueContext(
  q: Queryable, leagueId: number, { forUpdate = false } = {},
): Promise<LeagueContext> {
  const { rows } = await q.query<{ settings: LeagueSettings | null }>(
    `SELECT settings FROM league WHERE id = $1` + (forUpdate ? " FOR UPDATE" : ""),
    [leagueId],
  );
  if (!rows[0]) throw new Error(`no league ${leagueId}`);
  return { leagueId, settings: { ...DEFAULT_SETTINGS, ...(rows[0].settings ?? {}) } };
}

/** Which of these players the team does not actually own on the given day. */
async function notOwnedBy(
  q: Queryable, fantasyTeamId: number, playerIds: number[], on: string,
): Promise<number[]> {
  if (playerIds.length === 0) return [];
  const { rows } = await q.query<{ player_id: string }>(
    `SELECT r.player_id FROM roster_slot r
      WHERE r.fantasy_team_id = $1 AND r.player_id = ANY($2::bigint[])
        AND r.acquired_on <= $3 AND r.released_on IS NULL`,
    [fantasyTeamId, playerIds, on],
  );
  const held = new Set(rows.map((r) => Number(r.player_id)));
  return playerIds.filter((id) => !held.has(id));
}

/**
 * Offers a deal.
 *
 * The offer is checked for being *meant* — that both sides own the players they
 * are putting up — and no further. Roster room is deliberately not checked
 * here: a roster that is full today may not be when the trade executes, which
 * is the same reason a waiver claim names its drop and is answered at the run
 * rather than at submission.
 *
 * Two live offers for the same player are legal and are not a mistake. Shopping
 * a man to two teams is the ordinary way a trade gets made; the first deal to
 * execute takes him, and the other is voided at its own execution with a
 * sentence saying so.
 */
export async function proposeTrade(
  db: Db,
  { leagueId, fromTeamId, toTeamId, gives, gets, message, byUserId, now = new Date() }: {
    leagueId: number; fromTeamId: number; toTeamId: number;
    /** Players the proposer is giving up. */
    gives: number[];
    /** Players the proposer is asking for. */
    gets: number[];
    message?: string | null; byUserId?: number; now?: Date;
  },
): Promise<Trade> {
  if (fromTeamId === toTeamId) throw new Error("a team cannot trade with itself");
  const give = [...new Set(gives)];
  const get = [...new Set(gets)];
  if (give.length + get.length === 0) throw new EmptyTradeError();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { settings } = await leagueContext(client, leagueId);
    if (tradingClosed(settings, now)) throw new TradeDeadlineError(settings.tradeDeadline!);
    const on = isoDay(now);

    for (const [team, players] of [[fromTeamId, give], [toTeamId, get]] as const) {
      const missing = await notOwnedBy(client, team, players, on);
      if (missing[0] !== undefined) throw new NotTradeableError(missing[0], team);
    }

    const expiresAt = new Date(now.getTime() + settings.tradeOfferDays * 86_400_000);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO trade (league_id, from_team_id, to_team_id, message, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [leagueId, fromTeamId, toTeamId, message?.trim() || null, expiresAt, byUserId ?? null],
    );
    const tradeId = Number(rows[0]!.id);

    for (const [team, players] of [[fromTeamId, give], [toTeamId, get]] as const) {
      for (const playerId of players) {
        await client.query(
          "INSERT INTO trade_item (trade_id, fantasy_team_id, player_id) VALUES ($1, $2, $3)",
          [tradeId, team, playerId]);
      }
    }

    const trade = (await tradeById(client, tradeId))!;
    await client.query("COMMIT");
    return trade;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * Accepts or rejects an offer.
 *
 * Only the team that was asked can do either, and accepting is the one-way
 * door: from here the deal is out of both managers' hands and in the league's,
 * which is what the review window is. A manager who changes their mind after
 * accepting asks the commissioner, the same as in any real league.
 */
export async function respondToTrade(
  db: Db,
  { tradeId, fantasyTeamId, accept, now = new Date() }: {
    tradeId: number; fantasyTeamId: number; accept: boolean; now?: Date;
  },
): Promise<Trade> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const row = await lockTrade(client, tradeId);
    if (row.to_team_id !== fantasyTeamId) throw new NotYourTradeError(tradeId, fantasyTeamId);
    if (row.status !== "proposed") throw new TradeClosedError(tradeId, row.status);
    const { settings } = await leagueContext(client, row.league_id);

    if (!accept) {
      await client.query(
        "UPDATE trade SET status = 'rejected', settled_at = $2 WHERE id = $1", [tradeId, now]);
    } else {
      // Only on the way in. Turning down a stale offer after the deadline is
      // still an answer, and refusing it would leave a manager with an inbox
      // they cannot clear.
      if (tradingClosed(settings, now)) throw new TradeDeadlineError(settings.tradeDeadline!);
      // Checked once here so a manager finds out now rather than a day later,
      // and again at execution because a day is long enough for either roster
      // to change underneath the deal.
      await assertHonourable(client, tradeId, row, settings, isoDay(now));
      const executesAt = new Date(now.getTime() + settings.tradeReviewHours * 3_600_000);
      await client.query(
        `UPDATE trade SET status = 'accepted', accepted_at = $2, executes_at = $3 WHERE id = $1`,
        [tradeId, now, executesAt]);
    }

    const trade = (await tradeById(client, tradeId))!;
    await client.query("COMMIT");
    return trade;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Withdraws an offer. The proposer's, and only while nobody has answered it. */
export async function cancelTrade(
  db: Db, { tradeId, fantasyTeamId, now = new Date() }: {
    tradeId: number; fantasyTeamId: number; now?: Date;
  },
): Promise<Trade> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const row = await lockTrade(client, tradeId);
    if (row.from_team_id !== fantasyTeamId) throw new NotYourTradeError(tradeId, fantasyTeamId);
    if (row.status !== "proposed") throw new TradeClosedError(tradeId, row.status);
    await client.query(
      "UPDATE trade SET status = 'cancelled', settled_at = $2 WHERE id = $1", [tradeId, now]);
    const trade = (await tradeById(client, tradeId))!;
    await client.query("COMMIT");
    return trade;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Stops an accepted trade before it executes.
 *
 * The commissioner's, and only inside the window — a veto after the players
 * have moved would be an unwind rather than a veto, and unwinding a trade means
 * rewriting who owned whom on nights that have already been scored. The window
 * exists so that the answer is always "not yet" rather than "too late".
 *
 * The reason is stored and shown. A veto is the most contested thing a
 * commissioner does, and one delivered without a sentence is the reason leagues
 * argue about vetoes.
 */
export async function vetoTrade(
  db: Db, { tradeId, byUserId, reason, now = new Date() }: {
    tradeId: number; byUserId: number; reason?: string | null; now?: Date;
  },
): Promise<Trade> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const row = await lockTrade(client, tradeId);
    await requireCommissioner(db, Number(row.league_id), byUserId);
    if (row.status !== "accepted") throw new TradeClosedError(tradeId, row.status);
    await client.query(
      `UPDATE trade SET status = 'vetoed', vetoed_by = $2, settled_at = $3, reason = $4
        WHERE id = $1`,
      [tradeId, byUserId, now, reason?.trim() || "vetoed by the commissioner"]);
    const trade = (await tradeById(client, tradeId))!;
    await client.query("COMMIT");
    return trade;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface LockedTrade {
  league_id: number;
  from_team_id: number;
  to_team_id: number;
  status: TradeStatus;
}

async function lockTrade(q: Queryable, tradeId: number): Promise<LockedTrade> {
  const { rows } = await q.query<{
    league_id: string; from_team_id: string; to_team_id: string; status: TradeStatus;
  }>(
    "SELECT league_id, from_team_id, to_team_id, status FROM trade WHERE id = $1 FOR UPDATE",
    [tradeId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no trade ${tradeId}`);
  return {
    league_id: Number(row.league_id),
    from_team_id: Number(row.from_team_id),
    to_team_id: Number(row.to_team_id),
    status: row.status,
  };
}

// ---------------------------------------------------------------------------
// Executing
// ---------------------------------------------------------------------------

/** Who moves where: playerId -> the team giving him up. */
async function movement(q: Queryable, tradeId: number): Promise<Map<number, number>> {
  const { rows } = await q.query<{ player_id: string; fantasy_team_id: string }>(
    "SELECT player_id, fantasy_team_id FROM trade_item WHERE trade_id = $1",
    [tradeId],
  );
  return new Map(rows.map((r) => [Number(r.player_id), Number(r.fantasy_team_id)]));
}

/**
 * Throws unless the deal is still one both rosters can honour.
 *
 * Two things can have gone wrong since it was offered: a player in it has left
 * the team that put him up — dropped, or traded away in a deal that executed
 * first — or a roster would end up over the limit. Both are checked here, so
 * accepting and executing ask exactly the same question and cannot disagree.
 */
async function assertHonourable(
  q: Queryable, tradeId: number,
  trade: { from_team_id: number; to_team_id: number },
  settings: LeagueSettings, on: string,
): Promise<void> {
  const from = await movement(q, tradeId);
  const sides = [trade.from_team_id, trade.to_team_id];

  for (const team of sides) {
    const players = [...from.entries()].filter(([, t]) => t === team).map(([p]) => p);
    const missing = await notOwnedBy(q, team, players, on);
    if (missing[0] !== undefined) throw new NotTradeableError(missing[0], team);
  }

  const limit = rosterLimit(settings);
  for (const team of sides) {
    const size = (await rosterOn(q, team, on)).length;
    const out = [...from.values()].filter((t) => t === team).length;
    const after = size - out + (from.size - out);
    if (after > limit) {
      const { rows } = await q.query<{ name: string }>(
        "SELECT name FROM fantasy_team WHERE id = $1", [team]);
      throw new TradeRosterError(rows[0]!.name, after, limit);
    }
  }
}

export interface TradeExecution {
  tradeId: number;
  status: "executed" | "invalid" | "expired";
  reason: string | null;
  /** ISO 8601 — when it happened, which is its own moment and not the reader's. */
  at: string;
}

/**
 * Runs every trade the clock has already reached.
 *
 * There is no worker here either. An accepted trade carries `executes_at`, and
 * the first reader past that moment moves the players — dated to that moment
 * rather than to the moment somebody finally looked, so a league nobody visited
 * for a week comes back with the rosters it would have had.
 *
 * Everything serialises on the league row, the same one the waiver run holds:
 * two trades that both want the same player cannot both take him, and the
 * second one is voided with a sentence saying which took him first.
 *
 * Offers that nobody answered are expired in the same pass, because a stale
 * offer is a thing the clock owes an answer to as much as an accepted one is.
 */
export async function settleTrades(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<TradeExecution[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { settings } = await leagueContext(client, leagueId, { forUpdate: true });
    const done: TradeExecution[] = [];

    // The deadline first, and only for offers that were still alive when it
    // arrived. Two clocks can kill one offer and the honest answer is whichever
    // reached it first: an offer nobody answered in January died of neglect
    // whatever a March deadline says, and one that would have stood until
    // Saturday died of the deadline on Thursday.
    //
    // Only offers, never an agreed deal. The deadline is on the handshake, and
    // both of those managers shook hands while trading was open.
    if (tradingClosed(settings, now)) {
      const closedAt = deadlinePassedAt(settings.tradeDeadline!);
      const { rows: late } = await client.query<{ id: string }>(
        `UPDATE trade SET status = 'expired', settled_at = $2,
                reason = 'the trade deadline passed'
          WHERE league_id = $1 AND status = 'proposed' AND expires_at > $2
          RETURNING id`,
        [leagueId, closedAt]);
      for (const row of late) {
        done.push({
          tradeId: Number(row.id), status: "expired",
          reason: "the trade deadline passed", at: closedAt.toISOString(),
        });
      }
    }

    const { rows: stale } = await client.query<{ id: string; expires_at: Date }>(
      `UPDATE trade SET status = 'expired', settled_at = expires_at,
              reason = 'nobody answered before it expired'
        WHERE league_id = $1 AND status = 'proposed' AND expires_at <= $2
        RETURNING id, expires_at`,
      [leagueId, now]);
    for (const row of stale) {
      done.push({
        tradeId: Number(row.id), status: "expired",
        reason: "nobody answered before it expired", at: row.expires_at.toISOString(),
      });
    }

    // In the order the clock reached them, each against the state the one
    // before it left behind — the same rule the waiver batches follow.
    const { rows: due } = await client.query<{
      id: string; from_team_id: string; to_team_id: string; executes_at: Date;
    }>(
      `SELECT id, from_team_id, to_team_id, executes_at FROM trade
        WHERE league_id = $1 AND status = 'accepted' AND executes_at <= $2
        ORDER BY executes_at, id`,
      [leagueId, now]);

    for (const row of due) {
      const tradeId = Number(row.id);
      const trade = {
        from_team_id: Number(row.from_team_id), to_team_id: Number(row.to_team_id),
      };
      const at = row.executes_at;
      const on = isoDay(at);

      // A savepoint per trade, because a deal that cannot be honoured has to
      // leave nothing behind. Half of a two-for-one is not a smaller trade, it
      // is two teams robbed — and a failure inside Postgres rather than inside
      // this loop (the ownership index refusing a claim) aborts the whole
      // transaction unless there is a point to roll back to.
      const mark = `trade_${tradeId}`;
      let reason: string | null = null;
      try {
        await client.query(`SAVEPOINT ${mark}`);
        await assertHonourable(client, tradeId, trade, settings, on);
        await execute(client, { tradeId, at, on, settings });
        await client.query(`RELEASE SAVEPOINT ${mark}`);
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${mark}`);
        if (error instanceof NotTradeableError) {
          const { rows: who } = await client.query<{ name: string; owner: string | null }>(
            `SELECT p.name,
                    (SELECT ft.name FROM roster_slot r JOIN fantasy_team ft ON ft.id = r.fantasy_team_id
                      WHERE r.player_id = p.id AND r.released_on IS NULL AND r.league_id = $2) AS owner
               FROM player p WHERE p.id = $1`,
            [error.playerId, leagueId]);
          const name = who[0]?.name ?? `player ${error.playerId}`;
          reason = who[0]?.owner
            ? `${name} is on ${who[0].owner} now`
            : `${name} had already been dropped`;
        } else if (error instanceof TradeRosterError || error instanceof AlreadyRosteredError) {
          reason = error.message;
        } else {
          throw error;
        }
      }

      const status = reason === null ? "executed" : "invalid";
      await client.query(
        `UPDATE trade SET status = $2, reason = $3, settled_at = $4,
                executed_on = CASE WHEN $2 = 'executed' THEN $5::date ELSE NULL END
          WHERE id = $1`,
        [tradeId, status, reason, at, on]);
      done.push({ tradeId, status, reason, at: at.toISOString() });
    }

    await client.query("COMMIT");
    return done;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Moves the players.
 *
 * Every tenure closes before any opens. Doing it player by player would put a
 * two-for-one over the roster limit halfway through, and a straight swap would
 * hit the league-wide ownership index while the man is briefly on both teams —
 * neither is a state the deal ever passes through, so neither should exist.
 */
async function execute(
  q: Queryable, { tradeId, at, on, settings }: {
    tradeId: number; at: Date; on: string; settings: LeagueSettings;
  },
): Promise<void> {
  const from = await movement(q, tradeId);
  const { rows } = await q.query<{ from_team_id: string; to_team_id: string }>(
    "SELECT from_team_id, to_team_id FROM trade WHERE id = $1", [tradeId]);
  const sides = [Number(rows[0]!.from_team_id), Number(rows[0]!.to_team_id)];

  for (const [playerId, giver] of from) {
    await releasePlayer(q, { fantasyTeamId: giver, playerId, on, via: "trade" });
    // The lineup rule every path that closes a tenure owes: a player traded on
    // Tuesday can still be in Thursday's starting five for the team that gave
    // him up, and settling would count his points for them.
    await clearFutureLineups(q, { fantasyTeamId: giver, playerId, on, at });
  }
  for (const [playerId, giver] of from) {
    const taker = sides.find((id) => id !== giver)!;
    await claimPlayer(q, { fantasyTeamId: taker, playerId, on, via: "trade", settings });
  }
}

/** The roster date for a moment. Rosters are dated; the clock is not. */
function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Whether a trade is still capable of changing. */
export function isLive(status: TradeStatus): boolean {
  return LIVE.includes(status);
}
