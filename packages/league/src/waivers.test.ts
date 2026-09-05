import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, type Archetype } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import { upsertUser } from "./membership.ts";
import { rosterOn } from "./roster.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";
import {
  BudgetExceededError, NotOnWaiversError, NotYourPlayerError, OnWaiversError,
  addFreeAgent, cancelClaim, claimsFor, clearsAt, dropPlayer, moveClaim, nextWaiverRun,
  settleWaivers, submitClaim, waiverState, waiverWire,
} from "./waivers.ts";

let db: Db;
let configId: number;
let commish: number;

const TEAMS = [1, 2, 3, 4];
const PLAYERS = 20;
const STAT_DAY = "2026-01-05";

/**
 * A four-man roster, so "full" is reachable in a test rather than after
 * thirteen inserts. Everything else is the default.
 */
const SETTINGS: LeagueSettings = {
  ...DEFAULT_SETTINGS,
  starters: [{ slot: "G", count: 1 }, { slot: "F", count: 1 }, { slot: "B", count: 1 }],
  bench: 1,
  ir: 0,
};
const LIMIT = 4;

const archetypeOf = (id: number): Archetype => (id <= 10 ? "lead" : id <= 15 ? "wing" : "big");

/** Runs are 09:00Z. Tuesday the 6th, mid-afternoon, is the reference moment. */
const TUE = new Date("2026-01-06T18:00:00Z");
const WED_RUN = new Date("2026-01-07T09:00:00Z");
const THU_RUN = new Date("2026-01-08T09:00:00Z");

async function reset() {
  await db.query("DELETE FROM waiver_claim");
  await db.query("DELETE FROM waiver_wire");
  await db.query("DELETE FROM lineup_entry");
  await db.query("DELETE FROM roster_slot");
  await db.query("DELETE FROM transaction");
  for (const [i, id] of TEAMS.entries()) {
    await db.query("UPDATE fantasy_team SET waiver_priority = $2 WHERE id = $1", [id, i + 1]);
  }
}

/** Puts a player on a roster directly, so a test can arrange without bidding. */
async function give(fantasyTeamId: number, playerId: number, on = "2026-01-01") {
  await db.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
     VALUES ($1, 1, $2, $3, 'draft')`,
    [fantasyTeamId, playerId, on]);
}

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_waivers_test");
  await admin.query("CREATE DATABASE illini_waivers_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_waivers_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));
  ({ id: commish } = await upsertUser(db, { email: "commish@illini.test", displayName: "Commish" }));

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES (1,'L',2026,$1,$2,$3)`,
    [configId, JSON.stringify(SETTINGS), commish]);
  for (const id of TEAMS) {
    await db.query("INSERT INTO fantasy_team (id, league_id, name, waiver_priority) VALUES ($1,1,$2,$3)",
      [id, `Team ${id}`, id]);
  }
  // Free agency and waivers both presuppose a finished draft.
  await db.query(
    `INSERT INTO draft (league_id, rounds, pick_seconds, status, opens_on, completed_at)
     VALUES (1, 1, 0, 'complete', '2026-01-01', now())`,
  );

  // Score descends with id, so "the best available" is the lowest free id.
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
      [id, STAT_DAY, configId, archetypeOf(id), 100 - id]);
  }
});

beforeEach(reset);
after(async () => { await db?.end(); });

// --- the schedule ----------------------------------------------------------

test("the next run is strictly after now, so a sealed batch cannot be answered", () => {
  assert.equal(nextWaiverRun(new Date("2026-01-06T08:59:59Z"), SETTINGS).toISOString(),
    "2026-01-06T09:00:00.000Z");
  // Submitted at the exact instant the envelopes are opened: too late for it.
  assert.equal(nextWaiverRun(new Date("2026-01-06T09:00:00Z"), SETTINGS).toISOString(),
    "2026-01-07T09:00:00.000Z");
  assert.equal(nextWaiverRun(new Date("2026-01-06T23:30:00Z"), SETTINGS).toISOString(),
    "2026-01-07T09:00:00.000Z");
});

test("a dropped player waits the waiver period, then clears at a run", () => {
  // Dropped Tuesday afternoon: one day later is Wednesday afternoon, and the
  // next run after that is Thursday morning.
  assert.equal(clearsAt(TUE, SETTINGS).toISOString(), THU_RUN.toISOString());
  // A drop just before a run still waits a full day, never less.
  assert.equal(clearsAt(new Date("2026-01-06T08:00:00Z"), SETTINGS).toISOString(),
    "2026-01-07T09:00:00.000Z");
  assert.equal(clearsAt(TUE, { ...SETTINGS, waiverDays: 0 }).toISOString(),
    WED_RUN.toISOString());
});

// --- dropping --------------------------------------------------------------

test("a drop puts the player on the wire, not back in the pool", async () => {
  await give(1, 5);
  const { clearsAt: clears } = await dropPlayer(db, {
    leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  assert.equal(clears, THU_RUN.toISOString());

  const wire = await waiverWire(db, { leagueId: 1, now: TUE });
  assert.equal(wire.length, 1);
  assert.equal(wire[0]!.playerId, 5);
  assert.equal(wire[0]!.droppedByName, "Team 1");

  // And nobody can simply take him in the meantime.
  await assert.rejects(
    addFreeAgent(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, now: TUE }),
    OnWaiversError);
});

test("dropping someone else's player is refused", async () => {
  await give(1, 5);
  await assert.rejects(
    dropPlayer(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, now: TUE }),
    NotYourPlayerError);
});

test("a drop clears the lineups it can no longer stand behind", async () => {
  await give(1, 5);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO game (played_on, season, home_team_id, tipoff)
     VALUES ('2026-01-06', 2026, 1, '2026-01-06T01:00:00Z'),
            ('2026-01-09', 2026, 1, '2026-01-10T01:00:00Z')
     RETURNING id`);
  const [played, future] = rows.map((r) => Number(r.id));
  for (const [day, gameId] of [["2026-01-06", played], ["2026-01-09", future]] as const) {
    await db.query(
      `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
       VALUES (1, $1, 5, 'G', $2)`, [day, gameId]);
  }

  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });

  const { rows: left } = await db.query<{ played_on: string }>(
    "SELECT to_char(played_on,'YYYY-MM-DD') AS played_on FROM lineup_entry WHERE player_id = 5");
  // Monday's game had tipped off — those points belong to the team that started
  // him. Friday's had not, and a team that no longer owns him must not score it.
  assert.deepEqual(left.map((r) => r.played_on), ["2026-01-06"]);
});

// --- claiming --------------------------------------------------------------

test("the highest bid wins, and the loser is told why", async () => {
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });

  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 12, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 3, playerId: 5, bid: 30, now: TUE });

  // Nothing happens before the run, however often anyone looks.
  assert.deepEqual(await settleWaivers(db, { leagueId: 1, now: WED_RUN }), []);

  const runs = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.runsAt, THU_RUN.toISOString());

  const [won, lost] = runs[0]!.outcomes;
  assert.equal(won!.fantasyTeamId, 3);
  assert.equal(won!.status, "won");
  assert.equal(lost!.fantasyTeamId, 2);
  assert.equal(lost!.status, "lost");
  assert.match(lost!.reason!, /outbid — Team 3 paid \$30/);

  const roster = await rosterOn(db, 3, "2026-01-08");
  assert.deepEqual(roster.map((p) => [p.playerId, p.acquiredVia]), [[5, "waiver"]]);
  assert.equal((await waiverWire(db, { leagueId: 1, now: THU_RUN })).length, 0);
});

test("a tie goes to priority, and the winner drops to the back of the line", async () => {
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 4, playerId: 5, bid: 10, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 10, now: TUE });

  const [run] = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  assert.equal(run!.outcomes[0]!.fantasyTeamId, 2);   // priority 2 beats priority 4
  assert.equal(run!.outcomes[0]!.status, "won");
  // Equal money, so the loser is owed the real reason rather than "too late".
  assert.match(run!.outcomes[1]!.reason!, /won the tie on waiver priority/);

  const state = await waiverState(db, { leagueId: 1, now: THU_RUN });
  assert.deepEqual(state.teams.map((t) => t.fantasyTeamId), [1, 3, 4, 2]);
  assert.equal(state.teams.at(-1)!.spent, 10);
  assert.equal(state.teams.at(-1)!.remaining, SETTINGS.faabBudget - 10);
});

test("a budget is spent once, and the claim that overdraws it loses", async () => {
  await give(1, 5);
  await give(1, 6);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 6, now: TUE });

  // Both bids are legal on their own; together they are more than the budget.
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 90, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 6, bid: 60, now: TUE });

  const [run] = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  const byPlayer = new Map(run!.outcomes.map((o) => [o.playerId, o]));
  assert.equal(byPlayer.get(5)!.status, "won");
  assert.equal(byPlayer.get(6)!.status, "lost");
  assert.match(byPlayer.get(6)!.reason!, /only \$10 left/);

  // And the next bid is refused at submission, with the same arithmetic.
  await assert.rejects(
    submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 6, bid: 11, now: THU_RUN }),
    BudgetExceededError);
});

test("a full roster with nobody named to drop is invalid, not merely unlucky", async () => {
  for (const id of [11, 12, 13, 14]) await give(2, id);
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 50, now: TUE });

  const [run] = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  assert.equal(run!.outcomes[0]!.status, "invalid");
  assert.match(run!.outcomes[0]!.reason!, new RegExp(`full at ${LIMIT}`));
  // An invalid claim costs nothing.
  const state = await waiverState(db, { leagueId: 1, now: THU_RUN });
  assert.equal(state.teams.find((t) => t.fantasyTeamId === 2)!.spent, 0);
});

test("a claim with a drop swaps one for the other, and the dropped man goes on the wire", async () => {
  for (const id of [11, 12, 13, 14]) await give(2, id);
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  await submitClaim(db, {
    leagueId: 1, fantasyTeamId: 2, playerId: 5, dropPlayerId: 14, bid: 50, now: TUE });

  const [run] = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  assert.equal(run!.outcomes[0]!.status, "won");

  const roster = await rosterOn(db, 2, "2026-01-08");
  assert.deepEqual(roster.map((p) => p.playerId).sort((a, b) => a - b), [5, 11, 12, 13]);
  const wire = await waiverWire(db, { leagueId: 1, now: THU_RUN });
  assert.deepEqual(wire.map((w) => w.playerId), [14]);
});

test("a team's own sequence decides which of its claims fits", async () => {
  for (const id of [11, 12, 13]) await give(2, id);   // one spot left
  for (const id of [5, 6]) {
    await give(1, id);
    await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: id, now: TUE });
  }
  // Equal bids, so nothing but the manager's own order can separate them.
  const first = await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 20, now: TUE });
  const second = await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 6, bid: 20, now: TUE });
  assert.deepEqual([first.sequence, second.sequence], [1, 2]);

  assert.equal(await moveClaim(db, { fantasyTeamId: 2, claimId: second.id, direction: "up" }), true);

  const [run] = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  const byPlayer = new Map(run!.outcomes.map((o) => [o.playerId, o.status]));
  assert.equal(byPlayer.get(6), "won");
  assert.equal(byPlayer.get(5), "invalid");
});

test("a claim can be withdrawn before the envelopes are opened", async () => {
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  const claim = await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 20, now: TUE });

  assert.equal(await cancelClaim(db, { fantasyTeamId: 2, claimId: claim.id }), true);
  assert.equal(await cancelClaim(db, { fantasyTeamId: 2, claimId: claim.id }), false);

  const [run] = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  assert.deepEqual(run!.outcomes, []);
  assert.deepEqual(run!.cleared, [5]);
});

test("raising a bid replaces it rather than adding a second", async () => {
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 5, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 40, now: TUE });

  const pending = await claimsFor(db, { leagueId: 1, fantasyTeamId: 2 });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.bid, 40);
});

// --- clearing, and free agency --------------------------------------------

test("a player nobody bid on clears, and is then an ordinary free agent", async () => {
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });

  // Refused while he is on the wire — the claim path is the only way in.
  await assert.rejects(
    addFreeAgent(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, now: WED_RUN }),
    OnWaiversError);

  const runs = await settleWaivers(db, { leagueId: 1, now: THU_RUN });
  assert.deepEqual(runs.flatMap((r) => r.cleared), [5]);

  await addFreeAgent(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, now: THU_RUN });
  assert.deepEqual((await rosterOn(db, 2, "2026-01-08")).map((p) => p.acquiredVia), ["free_agent"]);
});

test("a free agent is added outright, and cannot be bid for", async () => {
  await assert.rejects(
    submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 7, bid: 5, now: TUE }),
    NotOnWaiversError);
  await addFreeAgent(db, { leagueId: 1, fantasyTeamId: 2, playerId: 7, now: TUE });
  assert.deepEqual((await rosterOn(db, 2, "2026-01-06")).map((p) => p.playerId), [7]);
});

test("adding with a drop is one action: the roster never exceeds the limit", async () => {
  for (const id of [11, 12, 13, 14]) await give(2, id);
  await addFreeAgent(db, {
    leagueId: 1, fantasyTeamId: 2, playerId: 7, dropPlayerId: 11, now: TUE });

  const roster = await rosterOn(db, 2, "2026-01-06");
  assert.equal(roster.length, LIMIT);
  assert.deepEqual(roster.map((p) => p.playerId).sort((a, b) => a - b), [7, 12, 13, 14]);
});

// --- settled on read -------------------------------------------------------

test("a week nobody watched resolves batch by batch, each at its own time", async () => {
  await give(1, 5);
  await give(1, 6);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 40, now: TUE });

  // Team 3 drops someone on Thursday, and bids on him back on Friday. Both
  // batches are outstanding when the first reader finally arrives on Saturday.
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 6, now: new Date("2026-01-08T18:00:00Z") });
  await submitClaim(db, {
    leagueId: 1, fantasyTeamId: 3, playerId: 6, bid: 40, now: new Date("2026-01-09T12:00:00Z") });

  const runs = await settleWaivers(db, { leagueId: 1, now: new Date("2026-01-11T12:00:00Z") });
  assert.deepEqual(runs.filter((r) => r.outcomes.length > 0).map((r) => r.runsAt),
    ["2026-01-08T09:00:00.000Z", "2026-01-10T09:00:00.000Z"]);

  // Each award is dated to the run that made it, not to the moment somebody
  // finally looked — so the tenure starts on the right night.
  assert.deepEqual((await rosterOn(db, 2, "2026-01-08")).map((p) => p.acquiredOn), ["2026-01-08"]);
  assert.deepEqual((await rosterOn(db, 3, "2026-01-10")).map((p) => p.acquiredOn), ["2026-01-10"]);
});

test("a second reader at the same instant finds nothing left to do", async () => {
  await give(1, 5);
  await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: 5, now: TUE });
  await submitClaim(db, { leagueId: 1, fantasyTeamId: 2, playerId: 5, bid: 40, now: TUE });

  const [first, second] = await Promise.all([
    settleWaivers(db, { leagueId: 1, now: THU_RUN }),
    settleWaivers(db, { leagueId: 1, now: THU_RUN }),
  ]);
  const awarded = [...first!, ...second!].flatMap((r) => r.outcomes).filter((o) => o.status === "won");
  assert.equal(awarded.length, 1);
});
