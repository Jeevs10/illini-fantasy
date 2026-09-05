import type { Db } from "@illini/db";
import { insertMany } from "@illini/db";
import { requireCommissioner, type Queryable } from "./membership.ts";
import { AlreadyRosteredError, claimPlayer } from "./roster.ts";
import { DEFAULT_SETTINGS, autoFill, eligibleSlots, type LeagueSettings, type Slot } from "./slots.ts";

export type DraftStatus = "scheduled" | "live" | "paused" | "complete";

/** 90 seconds is long enough to read a board and short enough to finish in a night. */
const DEFAULT_PICK_SECONDS = 90;

/** How deep the auto-picker looks. Twelve rounds of ten never reaches 300. */
const CANDIDATE_DEPTH = 300;

export interface Draft {
  id: number;
  leagueId: number;
  season: number;
  configId: number;
  settings: LeagueSettings;
  rounds: number;
  teams: number;
  totalPicks: number;
  /** Seconds on the clock per pick. Zero means no clock — an offline draft. */
  pickSeconds: number;
  status: DraftStatus;
  /** The overall pick number on the clock, 1-based. */
  onTheClock: number;
  /** ISO 8601, or null when the draft is not running against a clock. */
  deadline: string | null;
  /** The date drafted tenures begin. */
  opensOn: string;
  startedAt: string | null;
  completedAt: string | null;
}

export class DraftNotLiveError extends Error {
  constructor(readonly status: DraftStatus) {
    super(`the draft is ${status}, not live`);
    this.name = "DraftNotLiveError";
  }
}

/** No roster move exists before the draft that fills the rosters does. */
export class DraftNotCompleteError extends Error {
  constructor(readonly status: DraftStatus | "none") {
    super(
      status === "none"
        ? "this league has not drafted yet"
        : `the draft is ${status}, not complete`,
    );
    this.name = "DraftNotCompleteError";
  }
}

export class NotOnTheClockError extends Error {
  constructor(readonly fantasyTeamId: number, readonly onTheClockTeamId: number,
              readonly onTheClockTeamName: string) {
    super(`team ${fantasyTeamId} is not on the clock — ${onTheClockTeamName} is`);
    this.name = "NotOnTheClockError";
  }
}

export class PlayerUnavailableError extends Error {
  constructor(readonly playerId: number, readonly byTeamName: string) {
    super(`player ${playerId} is already drafted by ${byTeamName}`);
    this.name = "PlayerUnavailableError";
  }
}

export class DraftInProgressError extends Error {
  constructor(readonly leagueId: number) {
    super(`league ${leagueId} already has a draft`);
    this.name = "DraftInProgressError";
  }
}

// ---------------------------------------------------------------------------
// Reading the draft
// ---------------------------------------------------------------------------

interface DraftRow {
  id: string; league_id: string; rounds: number; pick_seconds: number;
  status: DraftStatus; on_the_clock: number; deadline: Date | null; opens_on: string;
  started_at: Date | null; completed_at: Date | null;
  season: number; config_id: string; settings: LeagueSettings | null;
}

/**
 * Loads the draft, optionally taking the row lock everything else serialises on.
 *
 * One draft row per league is the mutex for the whole board: picking, expiring
 * the clock and starting or pausing all take it first, so two managers who
 * click at the same instant queue up in Postgres rather than both being told
 * they are on the clock.
 */
async function loadDraft(
  q: Queryable, leagueId: number, { forUpdate = false } = {},
): Promise<Draft | null> {
  const { rows } = await q.query<DraftRow>(
    `SELECT d.id, d.league_id, d.rounds, d.pick_seconds, d.status, d.on_the_clock,
            d.deadline, to_char(d.opens_on, 'YYYY-MM-DD') AS opens_on,
            d.started_at, d.completed_at,
            l.season, l.config_id, l.settings
       FROM draft d JOIN league l ON l.id = d.league_id
      WHERE d.league_id = $1` + (forUpdate ? " FOR UPDATE OF d" : ""),
    [leagueId],
  );
  const row = rows[0];
  if (!row) return null;

  const { rows: counts } = await q.query<{ teams: string; total: string }>(
    `SELECT count(DISTINCT fantasy_team_id) AS teams, count(*) AS total
       FROM draft_pick WHERE draft_id = $1`,
    [row.id],
  );
  return hydrate(row, Number(counts[0]!.teams), Number(counts[0]!.total));
}

function hydrate(row: DraftRow, teams: number, totalPicks: number): Draft {
  return {
    id: Number(row.id),
    leagueId: Number(row.league_id),
    season: row.season,
    configId: Number(row.config_id),
    settings: { ...DEFAULT_SETTINGS, ...(row.settings ?? {}) },
    rounds: row.rounds,
    teams,
    totalPicks,
    pickSeconds: row.pick_seconds,
    status: row.status,
    onTheClock: row.on_the_clock,
    deadline: row.deadline === null ? null : row.deadline.toISOString(),
    opensOn: row.opens_on,
    startedAt: row.started_at === null ? null : row.started_at.toISOString(),
    completedAt: row.completed_at === null ? null : row.completed_at.toISOString(),
  };
}

export async function draftFor(db: Queryable, leagueId: number): Promise<Draft | null> {
  return loadDraft(db, leagueId);
}

/**
 * Whether a league can be drafted, and why not if it cannot.
 *
 * The setup screen asks before it offers the button. Same principle as the
 * invite form: an action that will be refused should be refused visibly, not
 * after somebody commits to it — a commissioner finding out mid-draft-night
 * that the league is not empty is finding out too late.
 */
export async function draftReadiness(
  db: Db, leagueId: number,
): Promise<{ teams: number; rostered: number; ready: boolean }> {
  const { rows } = await db.query<{ teams: string; rostered: string }>(
    `SELECT (SELECT count(*) FROM fantasy_team WHERE league_id = $1) AS teams,
            (SELECT count(*) FROM roster_slot
              WHERE league_id = $1 AND released_on IS NULL) AS rostered`,
    [leagueId],
  );
  const teams = Number(rows[0]!.teams);
  const rostered = Number(rows[0]!.rostered);
  return { teams, rostered, ready: teams >= 2 && rostered === 0 };
}

// ---------------------------------------------------------------------------
// Creating the board
// ---------------------------------------------------------------------------

/** Fisher-Yates. The order is drawn once and stored, so it can be pointed at. */
function shuffled<T>(input: T[]): T[] {
  const items = [...input];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * The snake board: order forward on odd rounds, reversed on even ones.
 *
 * Exported because it is the one rule in the draft that is pure arithmetic, and
 * arithmetic deserves a test that does not need a database.
 */
export function snakeBoard(
  order: number[], rounds: number,
): { overall: number; round: number; inRound: number; fantasyTeamId: number }[] {
  const board = [];
  let overall = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const turn = round % 2 === 1 ? order : [...order].reverse();
    for (let i = 0; i < turn.length; i += 1) {
      overall += 1;
      board.push({ overall, round, inRound: i + 1, fantasyTeamId: turn[i]! });
    }
  }
  return board;
}

/**
 * Creates a draft and materialises every pick on the board.
 *
 * Each pick is a row from the start — the team that owns it, and no player yet.
 * "Who picks 47th" is then a fact to read rather than a snake calculation
 * repeated in the engine, the auto-picker and the screen, three places that
 * would each have to agree about the same off-by-one.
 */
export async function createDraft(
  db: Db,
  { leagueId, by, rounds, pickSeconds = DEFAULT_PICK_SECONDS, order, opensOn }: {
    leagueId: number; by: number; rounds?: number; pickSeconds?: number;
    /** Team ids in first-round order. Drawn at random when omitted. */
    order?: number[]; opensOn?: string;
  },
): Promise<Draft> {
  await requireCommissioner(db, leagueId, by);

  const existing = await loadDraft(db, leagueId);
  if (existing) throw new DraftInProgressError(leagueId);

  const { rows: league } = await db.query<{ season: number; settings: LeagueSettings | null }>(
    "SELECT season, settings FROM league WHERE id = $1", [leagueId],
  );
  if (!league[0]) throw new Error(`no league ${leagueId}`);
  const settings = { ...DEFAULT_SETTINGS, ...(league[0].settings ?? {}) };

  const { rows: teamRows } = await db.query<{ id: string }>(
    "SELECT id FROM fantasy_team WHERE league_id = $1 ORDER BY id", [leagueId],
  );
  const teamIds = teamRows.map((r) => Number(r.id));
  if (teamIds.length < 2) throw new Error("a draft needs at least two teams");

  // A draft deals out an empty league. Refusing here rather than letting the
  // ownership index refuse pick by pick means the commissioner finds out before
  // ten people are sitting in the room.
  const { rows: owned } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM roster_slot WHERE league_id = $1 AND released_on IS NULL",
    [leagueId],
  );
  if (Number(owned[0]!.n) > 0) {
    throw new Error(`league ${leagueId} already has rostered players — release them first`);
  }

  let first = order ?? shuffled(teamIds);
  if (order) {
    const given = new Set(order);
    if (order.length !== teamIds.length || teamIds.some((id) => !given.has(id))) {
      throw new Error("a draft order must name every team in the league exactly once");
    }
    first = order;
  }

  // IR is not drafted into — it is where an injury puts someone later.
  const roundCount = rounds ??
    settings.starters.reduce((a, s) => a + s.count, 0) + settings.bench;

  const opens = opensOn ?? (await firstMatchupDay(db, leagueId)) ?? `${league[0].season - 1}-11-01`;

  const { rows: created } = await db.query<{ id: string }>(
    `INSERT INTO draft (league_id, rounds, pick_seconds, opens_on)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [leagueId, roundCount, pickSeconds, opens],
  );
  const draftId = Number(created[0]!.id);

  await insertMany(db, {
    table: "draft_pick",
    columns: ["draft_id", "overall", "round", "in_round", "fantasy_team_id"],
    rows: snakeBoard(first, roundCount)
      .map((p) => [draftId, p.overall, p.round, p.inRound, p.fantasyTeamId]),
  });

  return (await loadDraft(db, leagueId))!;
}

async function firstMatchupDay(db: Db, leagueId: number): Promise<string | null> {
  const { rows } = await db.query<{ day: string }>(
    "SELECT to_char(min(starts_on), 'YYYY-MM-DD') AS day FROM matchup WHERE league_id = $1",
    [leagueId],
  );
  return rows[0]?.day ?? null;
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Puts the draft on the clock. Also how a paused draft resumes.
 *
 * Resuming hands the team on the clock a full pick's worth of time rather than
 * the remainder they had when the commissioner stopped it. A pause is called
 * because something went wrong; charging the person on the clock for it is the
 * wrong reading of why it was called.
 */
export async function startDraft(
  db: Db, { leagueId, by, now = new Date() }: { leagueId: number; by: number; now?: Date },
): Promise<Draft> {
  await requireCommissioner(db, leagueId, by);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const draft = await loadDraft(client, leagueId, { forUpdate: true });
    if (!draft) throw new Error(`league ${leagueId} has no draft`);
    if (draft.status === "complete") throw new Error("the draft is already complete");
    if (draft.status === "live") { await client.query("COMMIT"); return draft; }

    await client.query(
      `UPDATE draft SET status = 'live', deadline = $2,
              started_at = COALESCE(started_at, $3)
        WHERE id = $1`,
      [draft.id, deadlineFrom(now, draft.pickSeconds), now],
    );
    const updated = (await loadDraft(client, leagueId))!;
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Stops the clock. A paused draft has no deadline, which is what paused means. */
export async function pauseDraft(
  db: Db, { leagueId, by }: { leagueId: number; by: number },
): Promise<Draft> {
  await requireCommissioner(db, leagueId, by);
  await db.query(
    "UPDATE draft SET status = 'paused', deadline = NULL WHERE league_id = $1 AND status = 'live'",
    [leagueId],
  );
  const draft = await loadDraft(db, leagueId);
  if (!draft) throw new Error(`league ${leagueId} has no draft`);
  return draft;
}

function deadlineFrom(base: Date, pickSeconds: number): Date | null {
  return pickSeconds > 0 ? new Date(base.getTime() + pickSeconds * 1000) : null;
}

/**
 * Makes every pick the clock has already run out on.
 *
 * There is no daemon in this system, and a draft with a 90-second clock has to
 * advance whether or not anyone is watching. So the clock is settled on read:
 * every path that looks at the draft first makes the picks that were due, at
 * the times they were due. Two properties fall out of that. The board is the
 * same whether one person refreshed all night or nobody did, because each
 * deadline advances from the last deadline rather than from the moment somebody
 * finally looked. And the whole thing is testable by passing a different `now`.
 */
export async function advanceExpired(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const draft = await loadDraft(client, leagueId, { forUpdate: true });
    if (!draft) { await client.query("ROLLBACK"); return 0; }
    const made = await settleClock(client, draft, now);
    await client.query("COMMIT");
    return made;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs inside the caller's transaction, which already holds the draft row lock. */
async function settleClock(q: Queryable, draft: Draft, now: Date): Promise<number> {
  let made = 0;
  let status = draft.status;
  let onTheClock = draft.onTheClock;
  let deadline = draft.deadline === null ? null : new Date(draft.deadline);

  while (status === "live" && deadline !== null && deadline <= now && onTheClock <= draft.totalPicks) {
    const pick = await pickRow(q, draft.id, onTheClock);
    if (!pick) break;

    const playerId = await chooseAutoPick(q, draft, pick.fantasyTeamId);
    if (playerId === null) {
      // Nothing left to draft. Ending the draft is the honest outcome; leaving
      // it live would spin this loop against an empty pool forever.
      await q.query(
        "UPDATE draft SET status = 'complete', deadline = NULL, completed_at = $2 WHERE id = $1",
        [draft.id, deadline],
      );
      return made;
    }

    await recordPick(q, draft, {
      overall: onTheClock, fantasyTeamId: pick.fantasyTeamId, playerId,
      at: deadline, auto: true, byUserId: null,
    });
    made += 1;

    // The next deadline runs from this one, not from `now`. A draft nobody
    // watched for an hour rebuilds pick by pick at the times those picks were
    // actually due.
    const next = await advanceClock(q, draft, onTheClock, deadline);
    status = next.status;
    onTheClock = next.onTheClock;
    deadline = next.deadline;
  }
  return made;
}

async function pickRow(
  q: Queryable, draftId: number, overall: number,
): Promise<{ fantasyTeamId: number; round: number; inRound: number; playerId: number | null } | null> {
  const { rows } = await q.query<{
    fantasy_team_id: string; round: number; in_round: number; player_id: string | null;
  }>(
    "SELECT fantasy_team_id, round, in_round, player_id FROM draft_pick WHERE draft_id = $1 AND overall = $2",
    [draftId, overall],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    fantasyTeamId: Number(row.fantasy_team_id),
    round: row.round,
    inRound: row.in_round,
    playerId: row.player_id === null ? null : Number(row.player_id),
  };
}

/** Moves the clock to the next pick, or ends the draft if there is not one. */
async function advanceClock(
  q: Queryable, draft: Draft, overall: number, base: Date,
  { live = true }: { live?: boolean } = {},
): Promise<{ status: DraftStatus; onTheClock: number; deadline: Date | null }> {
  const next = overall + 1;
  if (next > draft.totalPicks) {
    await q.query(
      `UPDATE draft SET on_the_clock = $2, status = 'complete', deadline = NULL,
              completed_at = $3 WHERE id = $1`,
      [draft.id, next, base],
    );
    return { status: "complete", onTheClock: next, deadline: null };
  }
  // A paused draft being run out by the commissioner stays without a deadline:
  // "paused" and "has a countdown" must not both be true of one row.
  const deadline = live ? deadlineFrom(base, draft.pickSeconds) : null;
  await q.query("UPDATE draft SET on_the_clock = $2, deadline = $3 WHERE id = $1",
    [draft.id, next, deadline]);
  return { status: live ? "live" : "paused", onTheClock: next, deadline };
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

export interface MadePick {
  overall: number;
  round: number;
  inRound: number;
  fantasyTeamId: number;
  playerId: number;
  playerName: string;
  auto: boolean;
}

/**
 * Writes one pick and hands the player over.
 *
 * The claim goes through `claimPlayer`, so a drafted player is owned by exactly
 * the same unique index that a waiver claim answers to. The draft does not get
 * its own notion of ownership to drift from the league's.
 */
async function recordPick(
  q: Queryable, draft: Draft,
  { overall, fantasyTeamId, playerId, at, auto, byUserId }: {
    overall: number; fantasyTeamId: number; playerId: number; at: Date;
    auto: boolean; byUserId: number | null;
  },
): Promise<void> {
  try {
    await claimPlayer(q, {
      fantasyTeamId, playerId, on: draft.opensOn, via: "draft", settings: draft.settings,
    });
  } catch (error) {
    if (error instanceof AlreadyRosteredError) {
      throw new PlayerUnavailableError(playerId, error.byTeamName);
    }
    throw error;
  }

  const { rowCount } = await q.query(
    `UPDATE draft_pick SET player_id = $3, made_at = $4, auto = $5, made_by = $6
      WHERE draft_id = $1 AND overall = $2 AND player_id IS NULL`,
    [draft.id, overall, playerId, at, auto, byUserId],
  );
  if ((rowCount ?? 0) === 0) throw new Error(`pick ${overall} has already been made`);

  // The queue's job is done for this player, on every team that wanted him.
  await q.query("DELETE FROM draft_queue WHERE draft_id = $1 AND player_id = $2",
    [draft.id, playerId]);
}

/**
 * A manager takes a player.
 *
 * The clock is settled first, inside the same lock: a pick submitted a second
 * after the buzzer loses to the autopick that the buzzer already made, and is
 * told so, rather than quietly overwriting it.
 */
export async function makePick(
  db: Db,
  { leagueId, fantasyTeamId, playerId, byUserId, now = new Date() }: {
    leagueId: number; fantasyTeamId: number; playerId: number;
    byUserId?: number; now?: Date;
  },
): Promise<MadePick> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let draft = await loadDraft(client, leagueId, { forUpdate: true });
    if (!draft) throw new Error(`league ${leagueId} has no draft`);

    await settleClock(client, draft, now);
    draft = (await loadDraft(client, leagueId))!;
    if (draft.status !== "live") throw new DraftNotLiveError(draft.status);

    const pick = await pickRow(client, draft.id, draft.onTheClock);
    if (!pick) throw new DraftNotLiveError("complete");
    if (pick.fantasyTeamId !== fantasyTeamId) {
      const { rows } = await client.query<{ name: string }>(
        "SELECT name FROM fantasy_team WHERE id = $1", [pick.fantasyTeamId]);
      throw new NotOnTheClockError(fantasyTeamId, pick.fantasyTeamId, rows[0]?.name ?? "another team");
    }

    await recordPick(client, draft, {
      overall: draft.onTheClock, fantasyTeamId, playerId,
      at: now, auto: false, byUserId: byUserId ?? null,
    });
    await advanceClock(client, draft, draft.onTheClock, now);

    const { rows: named } = await client.query<{ name: string }>(
      "SELECT name FROM player WHERE id = $1", [playerId]);

    await client.query("COMMIT");
    return {
      overall: draft.onTheClock,
      round: pick.round,
      inRound: pick.inRound,
      fantasyTeamId,
      playerId,
      playerName: named[0]?.name ?? `player ${playerId}`,
      auto: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs the draft to completion with autopicks.
 *
 * The commissioner's escape hatch and the way an empty league is filled for
 * testing — the Phase 2 seeding script, except that every pick it makes is a
 * real pick on a real board.
 */
export async function autoDraft(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<number> {
  let made = 0;
  for (;;) {
    const client = await db.connect();
    let progressed = false;
    try {
      await client.query("BEGIN");
      const draft = await loadDraft(client, leagueId, { forUpdate: true });
      if (!draft) throw new Error(`league ${leagueId} has no draft`);
      if (draft.status === "complete") { await client.query("ROLLBACK"); break; }
      if (draft.status === "scheduled") throw new DraftNotLiveError(draft.status);

      const pick = await pickRow(client, draft.id, draft.onTheClock);
      if (!pick) { await client.query("ROLLBACK"); break; }

      const playerId = await chooseAutoPick(client, draft, pick.fantasyTeamId);
      if (playerId === null) {
        await client.query(
          "UPDATE draft SET status = 'complete', deadline = NULL, completed_at = $2 WHERE id = $1",
          [draft.id, now]);
        await client.query("COMMIT");
        break;
      }

      await recordPick(client, draft, {
        overall: draft.onTheClock, fantasyTeamId: pick.fantasyTeamId, playerId,
        at: now, auto: true, byUserId: null,
      });
      await advanceClock(client, draft, draft.onTheClock, now,
        { live: draft.status === "live" });
      await client.query("COMMIT");
      progressed = true;
      made += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!progressed) break;
  }
  return made;
}

// ---------------------------------------------------------------------------
// Choosing for a manager who is not there
// ---------------------------------------------------------------------------

interface Candidate { playerId: number; role: string | null; total: number }

/** Undrafted players, best season Player-Score first. */
async function availableRanked(q: Queryable, draft: Draft): Promise<Candidate[]> {
  const { rows } = await q.query<{ player_id: string; role: string | null; total: number }>(
    `WITH totals AS (
       SELECT s.player_id, sum(s.score) AS total
         FROM player_game_score s
         JOIN player_game_stat st
           ON st.player_id = s.player_id AND st.played_on = s.played_on
        WHERE s.config_id = $2 AND st.season = $3
        GROUP BY s.player_id
     )
     SELECT t.player_id, t.total,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = t.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role
       FROM totals t
      WHERE NOT EXISTS (
        SELECT 1 FROM roster_slot r
         WHERE r.league_id = $1 AND r.player_id = t.player_id AND r.released_on IS NULL)
      ORDER BY t.total DESC
      LIMIT $4`,
    [draft.leagueId, draft.configId, draft.season, CANDIDATE_DEPTH],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    role: r.role,
    total: Number(r.total),
  }));
}

/** The starting slots a roster still cannot fill. */
export function unfilledSlots(
  roles: (string | null)[], settings: LeagueSettings = DEFAULT_SETTINGS,
): Slot[] {
  const lineup = autoFill(
    roles.map((role, i) => ({ playerId: i, role, projected: 0 })), settings);
  const filled = new Map<Slot, number>();
  for (const entry of lineup) filled.set(entry.slot, (filled.get(entry.slot) ?? 0) + 1);
  return settings.starters
    .filter(({ slot, count }) => (filled.get(slot) ?? 0) < count)
    .map(({ slot }) => slot);
}

/**
 * What the clock takes when the manager is not there.
 *
 * In order: their queue, then the best available player who fills a starting
 * slot they cannot yet fill, then the best available player.
 *
 * The middle rule is the one that matters. A board sorted by season total is
 * guards at the top, and a team that takes the top of it twelve times finishes
 * the draft unable to field a centre — legal at every individual pick and
 * broken as a roster. Reusing `autoFill` to ask the question means the
 * auto-picker's idea of a complete team is the same one the lineup screen
 * enforces on a Tuesday night.
 */
async function chooseAutoPick(
  q: Queryable, draft: Draft, fantasyTeamId: number,
): Promise<number | null> {
  const available = await availableRanked(q, draft);
  if (available.length === 0) return null;
  const free = new Set(available.map((c) => c.playerId));

  const { rows: queued } = await q.query<{ player_id: string }>(
    `SELECT player_id FROM draft_queue
      WHERE draft_id = $1 AND fantasy_team_id = $2 ORDER BY rank`,
    [draft.id, fantasyTeamId],
  );
  for (const row of queued) {
    const id = Number(row.player_id);
    if (free.has(id)) return id;
  }

  const { rows: held } = await q.query<{ role: string | null }>(
    `SELECT (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = dp.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role
       FROM draft_pick dp
      WHERE dp.draft_id = $1 AND dp.fantasy_team_id = $2 AND dp.player_id IS NOT NULL`,
    [draft.id, fantasyTeamId],
  );
  const roster = held.map((r) => r.role);

  // FLEX is dropped: it takes anyone, so an unfilled FLEX is never a reason to
  // pass over the best player on the board. Only the slots that actually
  // exclude somebody — G, F, B — can steer a pick.
  const needed = new Set<Slot>(
    unfilledSlots(roster, draft.settings).filter((slot) => slot !== "FLEX"));
  if (needed.size > 0) {
    const fits = available.find((c) => eligibleSlots(c.role).some((s) => needed.has(s)));
    if (fits) return fits.playerId;
  }
  return available[0]!.playerId;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface QueuedPlayer {
  playerId: number;
  name: string;
  teamName: string | null;
  role: string | null;
  averageScore: number;
  rank: number;
  /** False once somebody else has taken him — the queue keeps him until then. */
  available: boolean;
}

export async function draftQueue(
  db: Db, { leagueId, fantasyTeamId }: { leagueId: number; fantasyTeamId: number },
): Promise<QueuedPlayer[]> {
  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null; role: string | null;
    average: number | null; rank: number; owner: string | null;
  }>(
    `SELECT q.player_id, p.name, t.name AS team_name, q.rank, s.average,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = q.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role,
            (SELECT ft.name FROM roster_slot r JOIN fantasy_team ft ON ft.id = r.fantasy_team_id
              WHERE r.league_id = $1 AND r.player_id = q.player_id AND r.released_on IS NULL
              LIMIT 1) AS owner
       FROM draft_queue q
       JOIN draft d ON d.id = q.draft_id
       JOIN league l ON l.id = d.league_id
       JOIN player p ON p.id = q.player_id
       LEFT JOIN team t ON t.id = p.team_id
       LEFT JOIN LATERAL (
         SELECT avg(sc.score) AS average
           FROM player_game_score sc
          WHERE sc.player_id = q.player_id AND sc.config_id = l.config_id
       ) s ON true
      WHERE d.league_id = $1 AND q.fantasy_team_id = $2
      ORDER BY q.rank`,
    [leagueId, fantasyTeamId],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    name: r.name,
    teamName: r.team_name,
    role: r.role,
    averageScore: r.average === null ? 0 : Number(r.average),
    rank: r.rank,
    available: r.owner === null,
  }));
}

export async function enqueue(
  db: Db, { leagueId, fantasyTeamId, playerId }: {
    leagueId: number; fantasyTeamId: number; playerId: number;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO draft_queue (draft_id, fantasy_team_id, player_id, rank)
     SELECT d.id, $2, $3,
            COALESCE((SELECT max(rank) FROM draft_queue
                       WHERE draft_id = d.id AND fantasy_team_id = $2), 0) + 1
       FROM draft d WHERE d.league_id = $1
     ON CONFLICT (draft_id, fantasy_team_id, player_id) DO NOTHING`,
    [leagueId, fantasyTeamId, playerId],
  );
  return (rowCount ?? 0) > 0;
}

export async function dequeue(
  db: Db, { leagueId, fantasyTeamId, playerId }: {
    leagueId: number; fantasyTeamId: number; playerId: number;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM draft_queue q USING draft d
      WHERE q.draft_id = d.id AND d.league_id = $1
        AND q.fantasy_team_id = $2 AND q.player_id = $3`,
    [leagueId, fantasyTeamId, playerId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Moves one player up or down the queue.
 *
 * Ranks are rewritten contiguously rather than swapped in place. A queue edited
 * for an hour by a manager who keeps changing their mind should not end up with
 * ranks that only sort correctly by accident.
 */
export async function moveInQueue(
  db: Db, { leagueId, fantasyTeamId, playerId, direction }: {
    leagueId: number; fantasyTeamId: number; playerId: number; direction: "up" | "down";
  },
): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ player_id: string }>(
      `SELECT q.player_id FROM draft_queue q JOIN draft d ON d.id = q.draft_id
        WHERE d.league_id = $1 AND q.fantasy_team_id = $2 ORDER BY q.rank FOR UPDATE OF q`,
      [leagueId, fantasyTeamId],
    );
    const ids = rows.map((r) => Number(r.player_id));
    const at = ids.indexOf(playerId);
    const to = direction === "up" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= ids.length) { await client.query("ROLLBACK"); return false; }
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];

    for (const [i, id] of ids.entries()) {
      await client.query(
        `UPDATE draft_queue q SET rank = $4 FROM draft d
          WHERE q.draft_id = d.id AND d.league_id = $1
            AND q.fantasy_team_id = $2 AND q.player_id = $3`,
        [leagueId, fantasyTeamId, id, i + 1],
      );
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
// The room
// ---------------------------------------------------------------------------

export interface BoardPick {
  overall: number;
  round: number;
  inRound: number;
  fantasyTeamId: number;
  teamName: string;
  playerId: number | null;
  playerName: string | null;
  school: string | null;
  role: string | null;
  auto: boolean;
  madeAt: string | null;
}

export interface DraftRoom {
  draft: Draft;
  picksMade: number;
  order: { fantasyTeamId: number; teamName: string; position: number }[];
  board: BoardPick[];
  onTheClock: BoardPick | null;
  /** Seconds left on the current pick, floored at zero. Null with no clock. */
  secondsLeft: number | null;
  /** The viewer's next pick, as an overall number, or null if they have none left. */
  yourNextPick: number | null;
  yourTurn: boolean;
}

/**
 * Everything the draft room renders, as of a moment.
 *
 * Settles the clock first, so opening the page is itself what makes the
 * overdue picks. That is deliberate: with no background worker, the alternative
 * is a room that shows a deadline three minutes in the past.
 */
export async function draftRoom(
  db: Db, { leagueId, fantasyTeamId, now = new Date() }: {
    leagueId: number; fantasyTeamId?: number | null; now?: Date;
  },
): Promise<DraftRoom | null> {
  await advanceExpired(db, { leagueId, now });
  const draft = await loadDraft(db, leagueId);
  if (!draft) return null;

  const { rows } = await db.query<{
    overall: number; round: number; in_round: number; fantasy_team_id: string;
    team_name: string; player_id: string | null; player_name: string | null;
    school: string | null; role: string | null; auto: boolean; made_at: Date | null;
  }>(
    `SELECT dp.overall, dp.round, dp.in_round, dp.fantasy_team_id, ft.name AS team_name,
            dp.player_id, p.name AS player_name, t.name AS school, dp.auto, dp.made_at,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = dp.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role
       FROM draft_pick dp
       JOIN fantasy_team ft ON ft.id = dp.fantasy_team_id
       LEFT JOIN player p ON p.id = dp.player_id
       LEFT JOIN team t ON t.id = p.team_id
      WHERE dp.draft_id = $1
      ORDER BY dp.overall`,
    [draft.id],
  );

  const board: BoardPick[] = rows.map((r) => ({
    overall: r.overall,
    round: r.round,
    inRound: r.in_round,
    fantasyTeamId: Number(r.fantasy_team_id),
    teamName: r.team_name,
    playerId: r.player_id === null ? null : Number(r.player_id),
    playerName: r.player_name,
    school: r.school,
    role: r.role,
    auto: r.auto,
    madeAt: r.made_at === null ? null : r.made_at.toISOString(),
  }));

  const onTheClock = draft.status === "complete"
    ? null
    : board.find((p) => p.overall === draft.onTheClock) ?? null;

  const secondsLeft = draft.deadline === null || draft.status !== "live"
    ? null
    : Math.max(0, Math.round((new Date(draft.deadline).getTime() - now.getTime()) / 1000));

  const mine = fantasyTeamId ?? null;
  return {
    draft,
    picksMade: board.filter((p) => p.playerId !== null).length,
    order: board.filter((p) => p.round === 1)
      .map((p) => ({ fantasyTeamId: p.fantasyTeamId, teamName: p.teamName, position: p.inRound })),
    board,
    onTheClock,
    secondsLeft,
    yourNextPick: mine === null ? null
      : board.find((p) => p.fantasyTeamId === mine && p.playerId === null)?.overall ?? null,
    yourTurn: mine !== null && onTheClock?.fantasyTeamId === mine && draft.status === "live",
  };
}
