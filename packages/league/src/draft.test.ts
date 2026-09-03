import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, type Archetype } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import {
  DraftNotLiveError, NotOnTheClockError, PlayerUnavailableError,
  advanceExpired, autoDraft, createDraft, draftFor, draftQueue, draftRoom, dequeue,
  enqueue, makePick, moveInQueue, pauseDraft, snakeBoard, startDraft, unfilledSlots,
} from "./draft.ts";
import { upsertUser } from "./membership.ts";
import { rosterOn } from "./roster.ts";
import { DEFAULT_SETTINGS, autoFill, validateLineup } from "./slots.ts";

let db: Db;
let configId: number;
let commish: number;

const TEAMS = [1, 2, 3, 4];
const ROUNDS = 3;
const CLOCK = 60;
const T0 = new Date("2025-11-01T01:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/**
 * Eighty players, best first, and deliberately top-heavy with guards: ids 1–40
 * are leads, 41–60 wings, 61–80 bigs. A board sorted by score alone hands every
 * team a dozen guards, which is the case the auto-picker has to survive.
 */
const PLAYERS = 80;
const archetypeOf = (id: number): Archetype => (id <= 40 ? "lead" : id <= 60 ? "wing" : "big");
const STAT_DAY = "2026-01-05";

/** Resets the draft between tests without rebuilding the whole fixture. */
async function freshDraft(options: {
  rounds?: number; pickSeconds?: number; order?: number[];
} = {}) {
  await db.query("DELETE FROM draft WHERE league_id = 1");
  await db.query("DELETE FROM roster_slot WHERE league_id = 1");
  await db.query("DELETE FROM transaction WHERE league_id = 1");
  return createDraft(db, {
    leagueId: 1, by: commish, rounds: options.rounds ?? ROUNDS,
    pickSeconds: options.pickSeconds ?? CLOCK, order: options.order ?? TEAMS,
  });
}

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_draft_test");
  await admin.query("CREATE DATABASE illini_draft_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_draft_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));
  ({ id: commish } = await upsertUser(db, { email: "commish@illini.test", displayName: "Commish" }));

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES (1,'L',2026,$1,$2,$3)`,
    [configId, JSON.stringify(DEFAULT_SETTINGS), commish]);
  await db.query(
    "INSERT INTO league_member (league_id, user_id, role) VALUES (1,$1,'commissioner')", [commish]);
  for (const id of TEAMS) {
    await db.query("INSERT INTO fantasy_team (id, league_id, name) VALUES ($1,1,$2)",
      [id, `Team ${id}`]);
  }

  // Score descends with id, so "best available" is simply the lowest free id.
  for (let id = 1; id <= PLAYERS; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,1)",
      [id, `Player ${id}`, `player ${id}`]);
    await db.query(
      `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
       VALUES ($1,$2,2026,'Wing F',30,'{}'::jsonb,'torvik')`, [id, STAT_DAY]);
    await db.query(
      `INSERT INTO player_game_score
         (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,0,1,1,$5)`,
      [id, STAT_DAY, configId, archetypeOf(id), 200 - id]);
  }
});

after(async () => { await db?.end(); });

// --- the board -------------------------------------------------------------

test("the snake reverses every round, and the numbering is continuous", () => {
  const board = snakeBoard([1, 2, 3, 4], 3);
  assert.equal(board.length, 12);
  assert.deepEqual(board.slice(0, 4).map((p) => p.fantasyTeamId), [1, 2, 3, 4]);
  assert.deepEqual(board.slice(4, 8).map((p) => p.fantasyTeamId), [4, 3, 2, 1]);
  assert.deepEqual(board.slice(8).map((p) => p.fantasyTeamId), [1, 2, 3, 4]);

  // The turn is the point of a snake: last of round one is first of round two.
  assert.equal(board[3]!.fantasyTeamId, board[4]!.fantasyTeamId);
  assert.deepEqual(board.map((p) => p.overall), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(board[7]!.round, 2);
  assert.equal(board[7]!.inRound, 4);
});

test("unfilled slots are the ones a roster genuinely cannot cover", () => {
  assert.deepEqual(unfilledSlots([]), ["G", "F", "C", "FLEX"]);
  // Two guards close G; nothing else moves.
  assert.deepEqual(unfilledSlots(["lead", "combo"]), ["F", "C", "FLEX"]);
  // A pile of guards is still a team with no centre, which is the whole reason
  // the auto-picker asks this question.
  assert.ok(unfilledSlots(["lead", "combo", "lead", "combo"]).includes("C"));
  // A swing covers both forward and centre, so one closes C.
  assert.ok(!unfilledSlots(["lead", "combo", "wing", "wing", "swing"]).includes("C"));
});

test("creating a draft materialises every pick, unclaimed", async () => {
  const draft = await freshDraft();
  assert.equal(draft.status, "scheduled");
  assert.equal(draft.totalPicks, TEAMS.length * ROUNDS);
  assert.equal(draft.onTheClock, 1);
  assert.equal(draft.deadline, null, "a scheduled draft has no deadline");

  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*) n FROM draft_pick WHERE player_id IS NULL");
  assert.equal(Number(rows[0]!.n), 12, "the whole board exists before anyone picks");
});

test("a second draft, and a draft over an existing roster, are both refused", async () => {
  await freshDraft();
  await assert.rejects(() => createDraft(db, { leagueId: 1, by: commish }), /already has a draft/);

  const outsider = await upsertUser(db, { email: "nobody@illini.test" });
  await db.query("DELETE FROM draft WHERE league_id = 1");
  await assert.rejects(
    () => createDraft(db, { leagueId: 1, by: outsider.id }), /not a commissioner/);

  await db.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
     VALUES (1, 1, 1, '2025-11-01', 'free_agent')`);
  await assert.rejects(
    () => createDraft(db, { leagueId: 1, by: commish }), /already has rostered players/);
  await db.query("DELETE FROM roster_slot WHERE league_id = 1");
});

test("an order that is not a permutation of the league is refused", async () => {
  await db.query("DELETE FROM draft WHERE league_id = 1");
  await assert.rejects(
    () => createDraft(db, { leagueId: 1, by: commish, order: [1, 2, 3] }),
    /every team in the league exactly once/);
  await assert.rejects(
    () => createDraft(db, { leagueId: 1, by: commish, order: [1, 2, 3, 3] }),
    /every team in the league exactly once/);
});

// --- picking ---------------------------------------------------------------

test("only the team on the clock may pick, and the pick advances it", async () => {
  await freshDraft();
  await assert.rejects(
    () => makePick(db, { leagueId: 1, fantasyTeamId: 1, playerId: 1, now: T0 }),
    (error: Error) => error instanceof DraftNotLiveError && /scheduled/.test(error.message));

  await startDraft(db, { leagueId: 1, by: commish, now: T0 });

  await assert.rejects(
    () => makePick(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, now: at(1) }),
    (error: Error) => error instanceof NotOnTheClockError && /Team 1 is/.test(error.message));

  const pick = await makePick(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: at(1) });
  assert.equal(pick.overall, 1);
  assert.equal(pick.playerName, "Player 5");

  const draft = (await draftFor(db, 1))!;
  assert.equal(draft.onTheClock, 2);
  // The clock restarts from the pick, not from the deadline it beat.
  assert.equal(draft.deadline, at(1 + CLOCK).toISOString());

  const roster = await rosterOn(db, 1, draft.opensOn);
  assert.deepEqual(roster.map((r) => r.acquiredVia), ["draft"]);
});

test("a drafted player is gone from the board for everyone", async () => {
  await freshDraft();
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });
  await makePick(db, { leagueId: 1, fantasyTeamId: 1, playerId: 7, now: at(1) });

  await assert.rejects(
    () => makePick(db, { leagueId: 1, fantasyTeamId: 2, playerId: 7, now: at(2) }),
    (error: Error) => error instanceof PlayerUnavailableError && /Team 1/.test(error.message));

  // And the failed pick did not burn team 2's turn.
  const draft = (await draftFor(db, 1))!;
  assert.equal(draft.onTheClock, 2);
});

// --- the clock -------------------------------------------------------------

test("the clock makes the picks it ran out on, at the times they were due", async () => {
  await freshDraft();
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });

  // Nobody looks for two and a half minutes. Two deadlines have passed.
  const made = await advanceExpired(db, { leagueId: 1, now: at(150) });
  assert.equal(made, 2);

  const draft = (await draftFor(db, 1))!;
  assert.equal(draft.onTheClock, 3);
  // The third deadline runs from the second, not from the moment somebody
  // finally refreshed — otherwise a draft nobody watched drifts.
  assert.equal(draft.deadline, at(3 * CLOCK).toISOString());

  const { rows } = await db.query<{ overall: number; auto: boolean; made_at: Date }>(
    "SELECT overall, auto, made_at FROM draft_pick WHERE player_id IS NOT NULL ORDER BY overall");
  assert.deepEqual(rows.map((r) => r.auto), [true, true]);
  assert.deepEqual(rows.map((r) => r.made_at.toISOString()), [at(60).toISOString(), at(120).toISOString()]);

  // Replaying the same instant is a no-op: the picks are already made.
  assert.equal(await advanceExpired(db, { leagueId: 1, now: at(150) }), 0);
});

test("a pick submitted after the buzzer loses to the autopick that beat it", async () => {
  await freshDraft();
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });

  // Team 1 clicks at 61 seconds. The clock expired at 60.
  await assert.rejects(
    () => makePick(db, { leagueId: 1, fantasyTeamId: 1, playerId: 12, now: at(61) }),
    (error: Error) => error instanceof NotOnTheClockError);

  const room = (await draftRoom(db, { leagueId: 1, now: at(61) }))!;
  assert.equal(room.board[0]!.auto, true, "pick one was made by the clock");
  assert.equal(room.board[0]!.playerId, 1, "and it took the best player available");
  assert.equal(room.onTheClock!.fantasyTeamId, 2);
});

test("a paused draft has no clock, and resuming gives a full one", async () => {
  await freshDraft();
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });
  const paused = await pauseDraft(db, { leagueId: 1, by: commish });
  assert.equal(paused.status, "paused");
  assert.equal(paused.deadline, null);

  // An hour goes by. Nothing is picked, because nothing is on the clock.
  assert.equal(await advanceExpired(db, { leagueId: 1, now: at(3600) }), 0);
  assert.equal((await draftFor(db, 1))!.onTheClock, 1);

  const resumed = await startDraft(db, { leagueId: 1, by: commish, now: at(3600) });
  assert.equal(resumed.status, "live");
  assert.equal(resumed.deadline, at(3600 + CLOCK).toISOString());
});

// --- the queue -------------------------------------------------------------

test("the autopick takes the queue before it takes the board", async () => {
  await freshDraft();
  // Team 1 wants Player 30 — twenty-nine places down the board.
  await enqueue(db, { leagueId: 1, fantasyTeamId: 1, playerId: 30 });
  await enqueue(db, { leagueId: 1, fantasyTeamId: 1, playerId: 2 });
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });

  await advanceExpired(db, { leagueId: 1, now: at(61) });
  const { rows } = await db.query<{ player_id: string }>(
    "SELECT player_id FROM draft_pick WHERE overall = 1");
  assert.equal(Number(rows[0]!.player_id), 30, "the manager left instructions and they were followed");

  // And taking a player clears him from every queue, including his own team's.
  const queue = await draftQueue(db, { leagueId: 1, fantasyTeamId: 1 });
  assert.deepEqual(queue.map((q) => q.playerId), [2]);
});

test("a queued player somebody else took is skipped, not waited for", async () => {
  await freshDraft();
  await enqueue(db, { leagueId: 1, fantasyTeamId: 2, playerId: 9 });
  await enqueue(db, { leagueId: 1, fantasyTeamId: 2, playerId: 11 });
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });

  await makePick(db, { leagueId: 1, fantasyTeamId: 1, playerId: 9, now: at(1) });
  await advanceExpired(db, { leagueId: 1, now: at(120) });

  const { rows } = await db.query<{ player_id: string }>(
    "SELECT player_id FROM draft_pick WHERE overall = 2");
  assert.equal(Number(rows[0]!.player_id), 11);
});

test("a queue can be reordered and pruned", async () => {
  await freshDraft();
  for (const playerId of [3, 4, 5]) {
    await enqueue(db, { leagueId: 1, fantasyTeamId: 3, playerId });
  }
  assert.equal(await enqueue(db, { leagueId: 1, fantasyTeamId: 3, playerId: 3 }), false,
    "queueing the same player twice is a no-op, not a second row");

  await moveInQueue(db, { leagueId: 1, fantasyTeamId: 3, playerId: 5, direction: "up" });
  let queue = await draftQueue(db, { leagueId: 1, fantasyTeamId: 3 });
  assert.deepEqual(queue.map((q) => q.playerId), [3, 5, 4]);
  assert.deepEqual(queue.map((q) => q.rank), [1, 2, 3], "ranks stay contiguous");

  assert.equal(
    await moveInQueue(db, { leagueId: 1, fantasyTeamId: 3, playerId: 3, direction: "up" }), false,
    "the top of the queue has nowhere to go");

  await dequeue(db, { leagueId: 1, fantasyTeamId: 3, playerId: 5 });
  queue = await draftQueue(db, { leagueId: 1, fantasyTeamId: 3 });
  assert.deepEqual(queue.map((q) => q.playerId), [3, 4]);
});

// --- running it out --------------------------------------------------------

test("an auto-drafted league ends up with rosters that can field a lineup", async () => {
  // Twelve rounds is the real setting: seven starters and five on the bench.
  await freshDraft({ rounds: 12 });
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });
  const made = await autoDraft(db, { leagueId: 1, now: T0 });
  assert.equal(made, TEAMS.length * 12);

  const draft = (await draftFor(db, 1))!;
  assert.equal(draft.status, "complete");
  assert.equal(draft.deadline, null);
  assert.ok(draft.completedAt !== null);

  for (const teamId of TEAMS) {
    const roster = await rosterOn(db, teamId, draft.opensOn);
    assert.equal(roster.length, 12, `team ${teamId} drafted a full roster`);
  }

  // The board was guard-heavy on purpose. Every team should still be able to
  // put someone at centre, which is what the slot-aware autopick is for.
  const { rows } = await db.query<{ fantasy_team_id: string; archetype: Archetype }>(
    `SELECT dp.fantasy_team_id, s.archetype
       FROM draft_pick dp
       JOIN player_game_score s ON s.player_id = dp.player_id AND s.config_id = $1
      WHERE dp.draft_id = $2`,
    [configId, draft.id]);
  for (const teamId of TEAMS) {
    const archetypes = rows.filter((r) => Number(r.fantasy_team_id) === teamId)
      .map((r) => r.archetype);
    const lineup = autoFill(
      archetypes.map((archetype, i) => ({ playerId: i, archetype, projected: 0 })));
    assert.deepEqual(validateLineup(lineup), [], `team ${teamId} fields a legal lineup`);
    assert.equal(lineup.filter((l) => l.slot !== "BENCH").length, 7,
      `team ${teamId} fills all seven starting slots`);
  }

  // Nothing was drafted twice, anywhere in the league.
  const { rows: dupes } = await db.query<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT player_id FROM roster_slot WHERE league_id = 1 AND released_on IS NULL
       GROUP BY player_id HAVING count(*) > 1) x`);
  assert.equal(Number(dupes[0]!.n), 0);
});

test("the room reports whose turn it is and when the viewer picks next", async () => {
  await freshDraft();
  await startDraft(db, { leagueId: 1, by: commish, now: T0 });
  await makePick(db, { leagueId: 1, fantasyTeamId: 1, playerId: 1, now: at(1) });

  const room = (await draftRoom(db, { leagueId: 1, fantasyTeamId: 4, now: at(2) }))!;
  assert.equal(room.picksMade, 1);
  assert.equal(room.onTheClock!.teamName, "Team 2");
  assert.equal(room.yourTurn, false);
  assert.equal(room.yourNextPick, 4, "team 4 picks fourth and then fifth");
  assert.equal(room.secondsLeft, CLOCK - 1);
  assert.deepEqual(room.order.map((o) => o.teamName),
    ["Team 1", "Team 2", "Team 3", "Team 4"]);

  const mine = (await draftRoom(db, { leagueId: 1, fantasyTeamId: 2, now: at(2) }))!;
  assert.equal(mine.yourTurn, true);
});
