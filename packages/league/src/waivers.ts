import type { Db } from "@illini/db";
import { DraftNotCompleteError, draftFor } from "./draft.ts";
import type { Queryable } from "./membership.ts";
import {
  AlreadyRosteredError, RosterFullError, claimPlayer, clearFutureLineups, releasePlayer,
  rosterLimit, rosterOn,
} from "./roster.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

/** A roster move that only makes sense once the draft that filled every
    other roster slot has actually finished — free agency and waivers both
    presuppose there is a draft to have missed. */
async function requireDraftComplete(q: Queryable, leagueId: number): Promise<void> {
  const draft = await draftFor(q, leagueId);
  if (!draft) throw new DraftNotCompleteError("none");
  if (draft.status !== "complete") throw new DraftNotCompleteError(draft.status);
}

export type ClaimStatus = "pending" | "won" | "lost" | "invalid" | "cancelled";

export class NotOnWaiversError extends Error {
  constructor(readonly playerId: number) {
    super(`player ${playerId} is not on waivers — he can be added outright`);
    this.name = "NotOnWaiversError";
  }
}

export class OnWaiversError extends Error {
  constructor(readonly playerId: number, readonly clearsAt: string) {
    super(`player ${playerId} is on waivers until ${clearsAt} — bid instead`);
    this.name = "OnWaiversError";
  }
}

export class BudgetExceededError extends Error {
  constructor(readonly bid: number, readonly remaining: number) {
    super(`a bid of ${bid} is more than the ${remaining} left in the budget`);
    this.name = "BudgetExceededError";
  }
}

export class NotYourPlayerError extends Error {
  constructor(readonly playerId: number, readonly fantasyTeamId: number) {
    super(`player ${playerId} is not on team ${fantasyTeamId}`);
    this.name = "NotYourPlayerError";
  }
}

// ---------------------------------------------------------------------------
// When bids are opened
// ---------------------------------------------------------------------------

/**
 * The next run, strictly after the given moment.
 *
 * Strictly matters. A claim submitted at the exact instant of a run belongs to
 * the next one: the batch opening now is already sealed, and the whole point of
 * a sealed bid is that it cannot be answered after the envelopes are open.
 *
 * Pure, and exported, because the rest of the scheduling is arithmetic and
 * arithmetic deserves a test that does not need a database.
 */
export function nextWaiverRun(from: Date, settings: LeagueSettings = DEFAULT_SETTINGS): Date {
  const run = new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), settings.waiverHour, 0, 0, 0));
  if (run.getTime() <= from.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

/**
 * The run at which a player dropped at a given moment is settled.
 *
 * `waiverDays` from the drop, then rounded forward to the next run — so the
 * wait is never shorter than the setting says and never more than a day longer,
 * and a player always clears at a moment when bids are being opened rather than
 * in the middle of the afternoon. At that run he is awarded to the best bid, or
 * to nobody, and either way he is off the wire afterwards.
 */
export function clearsAt(droppedAt: Date, settings: LeagueSettings = DEFAULT_SETTINGS): Date {
  const earliest = new Date(droppedAt.getTime() + settings.waiverDays * 86_400_000);
  return nextWaiverRun(earliest, settings);
}

// ---------------------------------------------------------------------------
// Reading the wire
// ---------------------------------------------------------------------------

interface LeagueContext {
  leagueId: number;
  season: number;
  configId: number;
  settings: LeagueSettings;
}

async function leagueContext(
  q: Queryable, leagueId: number, { forUpdate = false } = {},
): Promise<LeagueContext> {
  const { rows } = await q.query<{ season: number; config_id: string; settings: LeagueSettings | null }>(
    `SELECT season, config_id, settings FROM league WHERE id = $1` + (forUpdate ? " FOR UPDATE" : ""),
    [leagueId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no league ${leagueId}`);
  return {
    leagueId,
    season: row.season,
    configId: Number(row.config_id),
    settings: { ...DEFAULT_SETTINGS, ...(row.settings ?? {}) },
  };
}

export interface WirePlayer {
  playerId: number;
  name: string;
  teamName: string | null;
  droppedBy: number | null;
  droppedByName: string | null;
  droppedAt: string;
  clearsAt: string;
  /** How many teams have a live bid in. The count is public; the bids are not. */
  bids: number;
}

/** Everyone currently claimable by bid, soonest to clear first. */
export async function waiverWire(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<WirePlayer[]> {
  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null;
    dropped_by: string | null; dropped_by_name: string | null;
    dropped_at: Date; clears_at: Date; bids: string;
  }>(
    `SELECT w.player_id, p.name, t.name AS team_name, w.dropped_by,
            ft.name AS dropped_by_name, w.dropped_at, w.clears_at,
            (SELECT count(*) FROM waiver_claim c
              WHERE c.league_id = w.league_id AND c.player_id = w.player_id
                AND c.status = 'pending') AS bids
       FROM waiver_wire w
       JOIN player p ON p.id = w.player_id
       LEFT JOIN team t ON t.id = p.team_id
       LEFT JOIN fantasy_team ft ON ft.id = w.dropped_by
      WHERE w.league_id = $1 AND w.clears_at > $2
      ORDER BY w.clears_at, p.name`,
    [leagueId, now],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    name: r.name,
    teamName: r.team_name,
    droppedBy: r.dropped_by === null ? null : Number(r.dropped_by),
    droppedByName: r.dropped_by_name,
    droppedAt: r.dropped_at.toISOString(),
    clearsAt: r.clears_at.toISOString(),
    bids: Number(r.bids),
  }));
}

/** Whether a player has to be bid for, and until when. */
async function wireEntry(
  q: Queryable, leagueId: number, playerId: number, now: Date,
): Promise<Date | null> {
  const { rows } = await q.query<{ clears_at: Date }>(
    "SELECT clears_at FROM waiver_wire WHERE league_id = $1 AND player_id = $2 AND clears_at > $3",
    [leagueId, playerId, now],
  );
  return rows[0]?.clears_at ?? null;
}

export interface TeamBudget {
  fantasyTeamId: number;
  teamName: string;
  spent: number;
  remaining: number;
  priority: number;
}

export interface WaiverState {
  /** ISO 8601 — when the next batch of sealed bids is opened. */
  nextRunAt: string;
  budget: number;
  teams: TeamBudget[];
  wire: WirePlayer[];
}

/**
 * Budgets, priority and the wire, for the waivers screen.
 *
 * Spend is summed from won claims rather than stored on the team, for the same
 * reason matchup totals are recomputed from player scores: the ledger and the
 * balance cannot disagree if there is only a ledger.
 */
export async function waiverState(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<WaiverState> {
  const { settings } = await leagueContext(db, leagueId);
  const { rows } = await db.query<{
    id: string; name: string; waiver_priority: number; spent: string;
  }>(
    `SELECT t.id, t.name, t.waiver_priority,
            COALESCE((SELECT sum(c.bid) FROM waiver_claim c
                       WHERE c.fantasy_team_id = t.id AND c.status = 'won'), 0) AS spent
       FROM fantasy_team t
      WHERE t.league_id = $1
      ORDER BY t.waiver_priority NULLS LAST, t.id`,
    [leagueId],
  );

  return {
    nextRunAt: nextWaiverRun(now, settings).toISOString(),
    budget: settings.faabBudget,
    teams: rows.map((r) => ({
      fantasyTeamId: Number(r.id),
      teamName: r.name,
      spent: Number(r.spent),
      remaining: settings.faabBudget - Number(r.spent),
      priority: r.waiver_priority,
    })),
    wire: await waiverWire(db, { leagueId, now }),
  };
}

async function spentBy(q: Queryable, fantasyTeamId: number): Promise<number> {
  const { rows } = await q.query<{ spent: string }>(
    "SELECT COALESCE(sum(bid), 0) AS spent FROM waiver_claim WHERE fantasy_team_id = $1 AND status = 'won'",
    [fantasyTeamId],
  );
  return Number(rows[0]!.spent);
}

// ---------------------------------------------------------------------------
// Making a claim
// ---------------------------------------------------------------------------

export interface Claim {
  id: number;
  fantasyTeamId: number;
  teamName: string;
  playerId: number;
  playerName: string;
  dropPlayerId: number | null;
  dropPlayerName: string | null;
  bid: number;
  sequence: number;
  status: ClaimStatus;
  reason: string | null;
  runsAt: string;
  settledAt: string | null;
}

const CLAIM_SELECT = `
  SELECT c.id, c.fantasy_team_id, ft.name AS team_name, c.player_id, p.name AS player_name,
         c.drop_player_id, dp.name AS drop_player_name, c.bid, c.sequence, c.status,
         c.reason, c.runs_at, c.settled_at
    FROM waiver_claim c
    JOIN fantasy_team ft ON ft.id = c.fantasy_team_id
    JOIN player p ON p.id = c.player_id
    LEFT JOIN player dp ON dp.id = c.drop_player_id`;

interface ClaimRow {
  id: string; fantasy_team_id: string; team_name: string; player_id: string; player_name: string;
  drop_player_id: string | null; drop_player_name: string | null; bid: number; sequence: number;
  status: ClaimStatus; reason: string | null; runs_at: Date; settled_at: Date | null;
}

function toClaim(r: ClaimRow): Claim {
  return {
    id: Number(r.id),
    fantasyTeamId: Number(r.fantasy_team_id),
    teamName: r.team_name,
    playerId: Number(r.player_id),
    playerName: r.player_name,
    dropPlayerId: r.drop_player_id === null ? null : Number(r.drop_player_id),
    dropPlayerName: r.drop_player_name,
    bid: r.bid,
    sequence: r.sequence,
    status: r.status,
    reason: r.reason,
    runsAt: r.runs_at.toISOString(),
    settledAt: r.settled_at === null ? null : r.settled_at.toISOString(),
  };
}

/**
 * Puts a sealed bid in, or raises one already in.
 *
 * A raise is an update rather than a second row — a team holding two prices for
 * one player is a state nobody meant to create, and the partial unique index
 * says so in the schema rather than only here.
 *
 * The budget is checked against what has actually been *won*, not against
 * outstanding bids. A manager may bid on five players hoping to land one; what
 * they may not do is spend money they have already spent.
 */
export async function submitClaim(
  db: Db,
  { leagueId, fantasyTeamId, playerId, bid, dropPlayerId, byUserId, now = new Date() }: {
    leagueId: number; fantasyTeamId: number; playerId: number; bid: number;
    dropPlayerId?: number | null; byUserId?: number; now?: Date;
  },
): Promise<Claim> {
  await requireDraftComplete(db, leagueId);
  const { settings } = await leagueContext(db, leagueId);
  if (!Number.isInteger(bid) || bid < 0) throw new Error("a bid must be a whole number of dollars");

  const remaining = settings.faabBudget - await spentBy(db, fantasyTeamId);
  if (bid > remaining) throw new BudgetExceededError(bid, remaining);

  const clears = await wireEntry(db, leagueId, playerId, now);
  if (clears === null) throw new NotOnWaiversError(playerId);

  const { rows: owners } = await db.query<{ name: string }>(
    `SELECT t.name FROM roster_slot r JOIN fantasy_team t ON t.id = r.fantasy_team_id
      WHERE r.league_id = $1 AND r.player_id = $2 AND r.released_on IS NULL`,
    [leagueId, playerId],
  );
  if (owners[0]) throw new AlreadyRosteredError(playerId, 0, owners[0].name);

  if (dropPlayerId != null) await requireOnRoster(db, fantasyTeamId, dropPlayerId, isoDay(now));

  // The batch this bid belongs to: the run at which he clears. That moment is
  // both things at once — the last instant a bid can be in, and the instant
  // every bid is opened — which is what "waivers clear Thursday at 4am" has
  // always meant. A player therefore goes to exactly one auction rather than to
  // one per morning of his waiver period.
  const runsAt = clears;

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO waiver_claim
       (league_id, fantasy_team_id, player_id, drop_player_id, bid, sequence, runs_at, created_by)
     VALUES ($1, $2, $3, $4, $5,
             COALESCE((SELECT max(sequence) FROM waiver_claim
                        WHERE fantasy_team_id = $2 AND status = 'pending'), 0) + 1,
             $6, $7)
     ON CONFLICT (fantasy_team_id, player_id) WHERE status = 'pending'
       DO UPDATE SET bid = EXCLUDED.bid, drop_player_id = EXCLUDED.drop_player_id,
                     runs_at = EXCLUDED.runs_at, created_at = now()
     RETURNING id`,
    [leagueId, fantasyTeamId, playerId, dropPlayerId ?? null, bid, runsAt, byUserId ?? null],
  );

  const { rows: made } = await db.query<ClaimRow>(`${CLAIM_SELECT} WHERE c.id = $1`, [rows[0]!.id]);
  return toClaim(made[0]!);
}

async function requireOnRoster(
  q: Queryable, fantasyTeamId: number, playerId: number, on: string,
): Promise<void> {
  const { rows } = await q.query(
    `SELECT 1 FROM roster_slot
      WHERE fantasy_team_id = $1 AND player_id = $2 AND released_on IS NULL AND acquired_on <= $3`,
    [fantasyTeamId, playerId, on],
  );
  if (!rows[0]) throw new NotYourPlayerError(playerId, fantasyTeamId);
}

/** A manager's claims: what is still in, and how the last ones went. */
export async function claimsFor(
  db: Db, { leagueId, fantasyTeamId, limit = 25 }: {
    leagueId: number; fantasyTeamId?: number; limit?: number;
  },
): Promise<Claim[]> {
  const { rows } = await db.query<ClaimRow>(
    `${CLAIM_SELECT}
      WHERE c.league_id = $1 AND ($2::bigint IS NULL OR c.fantasy_team_id = $2)
      ORDER BY (c.status = 'pending') DESC, c.sequence, c.settled_at DESC, c.id DESC
      LIMIT $3`,
    [leagueId, fantasyTeamId ?? null, limit],
  );
  return rows.map(toClaim);
}

export async function cancelClaim(
  db: Db, { fantasyTeamId, claimId }: { fantasyTeamId: number; claimId: number },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE waiver_claim SET status = 'cancelled', settled_at = now()
      WHERE id = $1 AND fantasy_team_id = $2 AND status = 'pending'`,
    [claimId, fantasyTeamId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Reorders a team's own claims.
 *
 * Sequence is what a manager with four bids and room for two is really saying.
 * It never outranks another team's money — a rival's higher bid wins whatever
 * order you put yours in — but when your own claims compete for the last roster
 * spot or the last of the budget, this is the answer.
 */
export async function moveClaim(
  db: Db, { fantasyTeamId, claimId, direction }: {
    fantasyTeamId: number; claimId: number; direction: "up" | "down";
  },
): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM waiver_claim
        WHERE fantasy_team_id = $1 AND status = 'pending' ORDER BY sequence, id FOR UPDATE`,
      [fantasyTeamId],
    );
    const ids = rows.map((r) => Number(r.id));
    const at = ids.indexOf(claimId);
    const to = direction === "up" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= ids.length) { await client.query("ROLLBACK"); return false; }
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];

    for (const [i, id] of ids.entries()) {
      await client.query("UPDATE waiver_claim SET sequence = $2 WHERE id = $1", [id, i + 1]);
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Opening the bids
// ---------------------------------------------------------------------------

export interface ClaimOutcome {
  claimId: number;
  fantasyTeamId: number;
  teamName: string;
  playerId: number;
  playerName: string;
  bid: number;
  status: "won" | "lost" | "invalid";
  reason: string | null;
}

export interface WaiverRun {
  runsAt: string;
  outcomes: ClaimOutcome[];
  /** Players who stopped being claimable at this run because nobody bid. */
  cleared: number[];
}

/**
 * Resolves every batch the clock has already reached.
 *
 * There is no worker in this system. Like the draft clock, waivers are settled
 * on read: every path that looks at the wire first opens the batches that were
 * due, at the times they were due. A league nobody visited for a week comes
 * back with the same rosters it would have had if somebody had watched every
 * run, because each batch is resolved against the state the batch before it
 * left behind rather than against the moment somebody finally looked.
 *
 * Everything serialises on the league row, which is this module's equivalent of
 * the draft row: two readers arriving at 09:00:01 queue up in Postgres instead
 * of both awarding the same player.
 */
export async function settleWaivers(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<WaiverRun[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const league = await leagueContext(client, leagueId, { forUpdate: true });
    await normalisePriority(client, leagueId);
    const runs: WaiverRun[] = [];

    for (;;) {
      const { rows } = await client.query<{ runs_at: Date }>(
        `SELECT min(runs_at) AS runs_at FROM waiver_claim
          WHERE league_id = $1 AND status = 'pending' AND runs_at <= $2`,
        [leagueId, now],
      );
      const runsAt = rows[0]?.runs_at;
      if (!runsAt) break;

      const outcomes = await resolveBatch(client, league, runsAt);
      const cleared = await clearWire(client, leagueId, runsAt);
      runs.push({ runsAt: runsAt.toISOString(), outcomes, cleared });
    }

    // Runs with no bids in them still clear the wire; nobody has to have wanted
    // a player for his waiver period to end.
    const cleared = await clearWire(client, leagueId, now);
    if (cleared.length > 0) {
      runs.push({ runsAt: now.toISOString(), outcomes: [], cleared });
    }

    await client.query("COMMIT");
    return runs;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function clearWire(q: Queryable, leagueId: number, upTo: Date): Promise<number[]> {
  const { rows } = await q.query<{ player_id: string }>(
    "DELETE FROM waiver_wire WHERE league_id = $1 AND clears_at <= $2 RETURNING player_id",
    [leagueId, upTo],
  );
  return rows.map((r) => Number(r.player_id));
}

/**
 * One batch, opened all at once.
 *
 * The order is the whole rule: highest bid, then waiver priority, then the
 * team's own sequence. Priority is read once, at the top of the batch, and
 * rolled once at the bottom — a winner who moved to the back mid-batch would
 * change the order of bids that were sealed before he won, which is not a
 * contest anybody entered.
 */
async function resolveBatch(
  q: Queryable, league: LeagueContext, runsAt: Date,
): Promise<ClaimOutcome[]> {
  const { rows } = await q.query<ClaimRow>(
    `${CLAIM_SELECT}
      WHERE c.league_id = $1 AND c.status = 'pending' AND c.runs_at = $2
      ORDER BY c.bid DESC, ft.waiver_priority NULLS LAST, c.sequence, c.id`,
    [league.leagueId, runsAt],
  );
  if (rows.length === 0) return [];

  const on = isoDay(runsAt);
  const limit = rosterLimit(league.settings);
  const spent = new Map<number, number>();
  const size = new Map<number, number>();
  // What each player went for, so a losing claim can be told whether it lost on
  // money or on the tiebreak. The winning bid is public once the run is over;
  // the sealing only ever protected it beforehand.
  const went = new Map<number, { teamName: string; bid: number }>();
  const outcomes: ClaimOutcome[] = [];
  const winners: number[] = [];

  for (const row of rows) {
    const claim = toClaim(row);
    const team = claim.fantasyTeamId;
    if (!spent.has(team)) spent.set(team, await spentBy(q, team));
    if (!size.has(team)) size.set(team, (await rosterOn(q, team, on)).length);

    const settle = async (status: "won" | "lost" | "invalid", reason: string | null) => {
      await q.query(
        "UPDATE waiver_claim SET status = $2, reason = $3, settled_at = $4 WHERE id = $1",
        [claim.id, status, reason, runsAt]);
      outcomes.push({
        claimId: claim.id, fantasyTeamId: team, teamName: claim.teamName,
        playerId: claim.playerId, playerName: claim.playerName, bid: claim.bid, status, reason,
      });
    };

    // Four ways to lose, and the claim is entitled to know which. "Somebody
    // else got him" is what a black box says; a manager who was outbid by $2
    // and one who was beaten on a coin flip should not read the same sentence.
    const winner = went.get(claim.playerId);
    if (winner) {
      await settle("lost", winner.bid > claim.bid
        ? `outbid — ${winner.teamName} paid $${winner.bid}`
        : `${winner.teamName} won the tie on waiver priority`);
      continue;
    }
    const owner = await ownerOf(q, league.leagueId, claim.playerId);
    if (owner !== null) { await settle("lost", `${owner} already had him`); continue; }

    const left = league.settings.faabBudget - spent.get(team)!;
    if (claim.bid > left) {
      await settle("lost", `only $${left} left in the budget`);
      continue;
    }

    // Room is checked here rather than at submission because a roster that was
    // full on Tuesday may not be by the time the bid is opened.
    let dropping: number | null = claim.dropPlayerId;
    if (dropping !== null) {
      const { rows: held } = await q.query(
        `SELECT 1 FROM roster_slot WHERE fantasy_team_id = $1 AND player_id = $2
           AND released_on IS NULL`, [team, dropping]);
      if (!held[0]) {
        await settle("invalid", `${claim.dropPlayerName ?? "the player to drop"} is no longer on the roster`);
        continue;
      }
    }
    if (size.get(team)! - (dropping === null ? 0 : 1) >= limit) {
      await settle("invalid", `the roster is full at ${limit} and no player was named to drop`);
      continue;
    }

    if (dropping !== null) {
      await release(q, { leagueId: league.leagueId, fantasyTeamId: team, playerId: dropping, on, at: runsAt, settings: league.settings });
      size.set(team, size.get(team)! - 1);
    }
    try {
      await claimPlayer(q, {
        fantasyTeamId: team, playerId: claim.playerId, on, via: "waiver",
        settings: league.settings,
      });
    } catch (error) {
      // The unique index is the last word on ownership, here as everywhere.
      if (error instanceof AlreadyRosteredError) {
        await settle("lost", `${error.byTeamName} claimed him first`); continue;
      }
      if (error instanceof RosterFullError) {
        await settle("invalid", `the roster is full at ${error.limit}`); continue;
      }
      throw error;
    }

    spent.set(team, spent.get(team)! + claim.bid);
    size.set(team, size.get(team)! + 1);
    went.set(claim.playerId, { teamName: claim.teamName, bid: claim.bid });
    if (!winners.includes(team)) winners.push(team);
    await settle("won", null);

    // He is off the wire the moment he is claimed; the run that awarded him is
    // the run he would otherwise have cleared at anyway.
    await q.query("DELETE FROM waiver_wire WHERE league_id = $1 AND player_id = $2",
      [league.leagueId, claim.playerId]);
  }

  if (winners.length > 0) await rollPriority(q, league.leagueId, winners);
  return outcomes;
}

async function ownerOf(q: Queryable, leagueId: number, playerId: number): Promise<string | null> {
  const { rows } = await q.query<{ name: string }>(
    `SELECT t.name FROM roster_slot r JOIN fantasy_team t ON t.id = r.fantasy_team_id
      WHERE r.league_id = $1 AND r.player_id = $2 AND r.released_on IS NULL`,
    [leagueId, playerId],
  );
  return rows[0]?.name ?? null;
}

/**
 * Closes the gaps, so priority is always 1..n with nobody missing.
 *
 * A team created after this migration has no priority at all, and a league that
 * has awarded claims has gaps. Both are answered by renumbering in the order
 * that already exists rather than by a trigger on team creation — the same
 * reason the ownership rule is an index and not a trigger.
 */
async function normalisePriority(q: Queryable, leagueId: number): Promise<void> {
  await q.query(
    `UPDATE fantasy_team t SET waiver_priority = ranked.rn
       FROM (SELECT id, row_number() OVER (ORDER BY waiver_priority NULLS LAST, id) AS rn
               FROM fantasy_team WHERE league_id = $1) ranked
      WHERE ranked.id = t.id AND t.waiver_priority IS DISTINCT FROM ranked.rn::integer`,
    [leagueId],
  );
}

/** Winners go to the back, in the order they won. Everyone else moves up. */
async function rollPriority(q: Queryable, leagueId: number, winners: number[]): Promise<void> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT id FROM fantasy_team WHERE league_id = $1
      ORDER BY waiver_priority NULLS LAST, id FOR UPDATE`,
    [leagueId],
  );
  const order = rows.map((r) => Number(r.id)).filter((id) => !winners.includes(id));
  order.push(...winners);
  for (const [i, id] of order.entries()) {
    await q.query("UPDATE fantasy_team SET waiver_priority = $2 WHERE id = $1", [id, i + 1]);
  }
}

// ---------------------------------------------------------------------------
// Free agency
// ---------------------------------------------------------------------------

/**
 * Takes a player nobody has to be bid for.
 *
 * The wire is what separates this from a claim. A player on it is the scarce
 * thing — somebody just gave up on him, and the league gets a night to decide
 * what he is worth. Everyone else is first come, first served.
 */
export async function addFreeAgent(
  db: Db,
  { leagueId, fantasyTeamId, playerId, dropPlayerId, byUserId, now = new Date() }: {
    leagueId: number; fantasyTeamId: number; playerId: number;
    dropPlayerId?: number | null; byUserId?: number; now?: Date;
  },
): Promise<void> {
  await requireDraftComplete(db, leagueId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const league = await leagueContext(client, leagueId, { forUpdate: true });
    const on = isoDay(now);

    const clears = await wireEntry(client, leagueId, playerId, now);
    if (clears !== null) throw new OnWaiversError(playerId, clears.toISOString());

    if (dropPlayerId != null) {
      await requireOnRoster(client, fantasyTeamId, dropPlayerId, on);
      await release(client, {
        leagueId, fantasyTeamId, playerId: dropPlayerId, on, at: now, settings: league.settings,
      });
    }
    await claimPlayer(client, {
      fantasyTeamId, playerId, on, via: "free_agent", settings: league.settings,
      byUserId,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Drops a player, and puts him on the wire rather than back in the pool.
 *
 * Dropping straight to free agency rewards whoever happens to be awake, which
 * is the behaviour waivers exist to remove — so the drop and the waiver period
 * are one action, and there is no path that produces the other outcome.
 */
export async function dropPlayer(
  db: Db,
  { leagueId, fantasyTeamId, playerId, now = new Date() }: {
    leagueId: number; fantasyTeamId: number; playerId: number; now?: Date;
  },
): Promise<{ clearsAt: string }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const league = await leagueContext(client, leagueId, { forUpdate: true });
    const on = isoDay(now);
    await requireOnRoster(client, fantasyTeamId, playerId, on);
    const clears = await release(client, {
      leagueId, fantasyTeamId, playerId, on, at: now, settings: league.settings,
    });
    await client.query("COMMIT");
    return { clearsAt: clears.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Closes a tenure, clears the lineups it can no longer stand behind, and starts
 * the waiver period.
 *
 * The lineup part is the one that is easy to miss, and it is `clearFutureLineups`
 * rather than anything written here — every path that closes a tenure owes it,
 * so it lives next to `releasePlayer` where the next one will find it.
 */
async function release(
  q: Queryable,
  { leagueId, fantasyTeamId, playerId, on, at, settings }: {
    leagueId: number; fantasyTeamId: number; playerId: number; on: string; at: Date;
    settings: LeagueSettings;
  },
): Promise<Date> {
  await releasePlayer(q, { fantasyTeamId, playerId, on });
  await clearFutureLineups(q, { fantasyTeamId, playerId, on, at });

  const clears = clearsAt(at, settings);
  await q.query(
    `INSERT INTO waiver_wire (league_id, player_id, dropped_by, dropped_at, clears_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (league_id, player_id)
       DO UPDATE SET dropped_by = EXCLUDED.dropped_by, dropped_at = EXCLUDED.dropped_at,
                     clears_at = EXCLUDED.clears_at`,
    [leagueId, playerId, fantasyTeamId, at, clears],
  );
  return clears;
}

/** The roster date for a moment. Rosters are dated; the clock is not. */
function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
