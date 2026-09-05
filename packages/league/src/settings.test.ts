import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import { upsertUser } from "./membership.ts";
import { settleWeek, standings } from "./settle.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";
import {
  SettingsRefusedError, diffSettings, isCalendarDate, leagueSettings, settingsContext,
  settingsProblems, updateSettings,
} from "./settings.ts";

let db: Db;
let configId: number;
let commish: number;
let manager: number;

const TEAMS = [1, 2];
const PLAYERS = 8;
/** Monday to Sunday, one week, five game nights inside it. */
const WEEK = { starts: "2026-01-05", ends: "2026-01-11" };
const NIGHTS = ["2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10"];
const NOW = new Date("2026-01-12T18:00:00Z");

/** A four-man roster, so "the limit is already exceeded" is two inserts away. */
const SETTINGS: LeagueSettings = {
  ...DEFAULT_SETTINGS,
  starters: [{ slot: "G", count: 1 }, { slot: "F", count: 1 }, { slot: "B", count: 1 }],
  bench: 1,
  ir: 0,
  gamesCap: 4,
};

async function reset() {
  await db.query("DELETE FROM trade_item");
  await db.query("DELETE FROM trade");
  await db.query("DELETE FROM waiver_claim");
  await db.query("DELETE FROM waiver_wire");
  await db.query("DELETE FROM lineup_entry");
  await db.query("DELETE FROM roster_slot");
  await db.query("DELETE FROM transaction");
  await db.query("DELETE FROM matchup");
  await db.query("UPDATE league SET settings = $1 WHERE id = 1", [JSON.stringify(SETTINGS)]);
}

async function give(fantasyTeamId: number, playerId: number, on = "2026-01-01") {
  await db.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
     VALUES ($1, 1, $2, $3, 'draft')`,
    [fantasyTeamId, playerId, on]);
}

/** A settled week with five started games a side, so the cap has something to cut. */
async function playAWeek() {
  await db.query(
    `INSERT INTO matchup (id, league_id, week, starts_on, ends_on, home_team_id, away_team_id)
     VALUES (1, 1, 1, $1, $2, 1, 2)`,
    [WEEK.starts, WEEK.ends]);

  // Team 1 starts players 1..4, team 2 starts 5..8; each plays every night, so
  // both sides have more started games than any cap under five.
  for (const [team, players] of [[1, [1, 2, 3, 4]], [2, [5, 6, 7, 8]]] as const) {
    for (const playerId of players) {
      await give(team, playerId);
      for (const night of NIGHTS) {
        await db.query(
          `INSERT INTO lineup_entry (fantasy_team_id, player_id, played_on, slot)
           VALUES ($1, $2, $3, 'G')`,
          [team, playerId, night]);
      }
    }
  }

  // Settled the ordinary way, then dated to a fixed moment so a re-score has
  // something to leave alone.
  await settleWeek(db, 1, 1);
  await db.query("UPDATE matchup SET settled_at = '2026-01-12T09:00:00Z' WHERE league_id = 1");
}

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_settings_test");
  await admin.query("CREATE DATABASE illini_settings_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_settings_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));
  ({ id: commish } = await upsertUser(db, { email: "commish@illini.test", displayName: "Commish" }));
  ({ id: manager } = await upsertUser(db, { email: "manager@illini.test", displayName: "Manager" }));

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES (1,'L',2026,$1,$2,$3)`,
    [configId, JSON.stringify(SETTINGS), commish]);
  await db.query(
    `INSERT INTO league_member (league_id, user_id, role)
     VALUES (1,$1,'commissioner'), (1,$2,'manager')`, [commish, manager]);
  for (const id of TEAMS) {
    await db.query("INSERT INTO fantasy_team (id, league_id, name) VALUES ($1,1,$2)",
      [id, `Team ${id}`]);
  }

  // Every player scores his own id every night, so a cap that keeps the best
  // four games has an arithmetic somebody can check by hand.
  for (let id = 1; id <= PLAYERS; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,1)",
      [id, `Player ${id}`, `player ${id}`]);
    for (const night of NIGHTS) {
      await db.query(
        `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
         VALUES ($1,$2,2026,'Wing F',30,'{}'::jsonb,'torvik')`, [id, night]);
      await db.query(
        `INSERT INTO player_game_score
           (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
         VALUES ($1,$2,$3,'wing','{}'::jsonb,0,1,1,$4)`,
        [id, night, configId, id]);
    }
  }
});

beforeEach(reset);
after(async () => { await db?.end(); });

// --- the shape, judged on its own ------------------------------------------

test("bounds and whole numbers, all of them at once", () => {
  const problems = settingsProblems({
    ...SETTINGS, waiverHour: 24, bench: 1.5, tradeOfferDays: 3,
  });
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes("Waiver hour")));
  assert.ok(problems.some((p) => p.includes("Bench") && p.includes("whole number")));
});

test("a lineup with no starting slot is a league where nobody scores", () => {
  assert.deepEqual(settingsProblems({ ...SETTINGS, starters: [] }),
    ["A lineup needs at least one starting slot, or nobody ever scores."]);
  assert.deepEqual(settingsProblems({
    ...SETTINGS, starters: [{ slot: "G", count: 0 }, { slot: "F", count: 0 }],
  }), ["A lineup needs at least one starting slot, or nobody ever scores."]);
});

test("a slot listed twice, and a slot that is not one", () => {
  const problems = settingsProblems({
    ...SETTINGS,
    starters: [{ slot: "G", count: 1 }, { slot: "G", count: 1 },
      { slot: "BENCH" as "G", count: 1 }],
  });
  assert.ok(problems.some((p) => p.includes("listed twice")));
  assert.ok(problems.some((p) => p.includes("not a starting slot")));
});

test("the deadline has to be a date that exists", () => {
  assert.equal(isCalendarDate("2026-03-01"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("March 1"), false);
  assert.deepEqual(settingsProblems({ ...SETTINGS, tradeDeadline: "2026-02-30" }),
    ["The trade deadline has to be a date, as YYYY-MM-DD."]);
  assert.deepEqual(settingsProblems({ ...SETTINGS, tradeDeadline: null }), []);
});

test("a diff names what moved and nothing else", () => {
  const changed = diffSettings(SETTINGS, { ...SETTINGS, bench: 3, tradeDeadline: "2026-03-01" });
  assert.deepEqual(changed, [
    { key: "bench", from: "1", to: "3" },
    { key: "tradeDeadline", from: "none", to: "2026-03-01" },
  ]);
  assert.deepEqual(diffSettings(SETTINGS, { ...SETTINGS }), []);
  assert.deepEqual(
    diffSettings(SETTINGS, { ...SETTINGS, starters: [{ slot: "G", count: 2 }] }),
    [{ key: "starters", from: "G1 F1 B1", to: "G2" }]);
});

// --- who may change them ---------------------------------------------------

test("only the commissioner", async () => {
  await assert.rejects(
    updateSettings(db, { leagueId: 1, byUserId: manager, patch: { bench: 3 }, now: NOW }),
    /not a commissioner/);
  assert.equal((await leagueSettings(db, 1)).bench, 1);
});

test("a patch changes one number and leaves the rest alone", async () => {
  const result = await updateSettings(db, {
    leagueId: 1, byUserId: commish, patch: { faabBudget: 250 }, now: NOW });

  assert.deepEqual(result.changed, [{ key: "faabBudget", from: "100", to: "250" }]);
  const saved = await leagueSettings(db, 1);
  assert.equal(saved.faabBudget, 250);
  assert.equal(saved.bench, 1);
  assert.deepEqual(saved.starters, SETTINGS.starters);
});

test("submitting the same numbers changes nothing and logs nothing", async () => {
  const result = await updateSettings(db, {
    leagueId: 1, byUserId: commish, patch: { bench: 1, gamesCap: 4 }, now: NOW });
  assert.deepEqual(result.changed, []);
  const { rows } = await db.query("SELECT * FROM transaction WHERE kind = 'settings'");
  assert.equal(rows.length, 0);
});

test("every change is written to the transaction log", async () => {
  await updateSettings(db, {
    leagueId: 1, byUserId: commish, patch: { waiverHour: 11, tradeReviewHours: 0 }, now: NOW });
  const { rows } = await db.query<{ payload: { changed: { key: string }[] }; created_by: string }>(
    "SELECT payload, created_by FROM transaction WHERE kind = 'settings'");
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0]!.created_by), commish);
  assert.deepEqual(rows[0]!.payload.changed.map((c) => c.key), ["waiverHour", "tradeReviewHours"]);
});

// --- what a league in progress refuses -------------------------------------

test("the roster cannot shrink below a roster somebody already holds", async () => {
  for (const id of [1, 2, 3, 4]) await give(1, id);

  await assert.rejects(
    updateSettings(db, { leagueId: 1, byUserId: commish, patch: { bench: 0 }, now: NOW }),
    (error: SettingsRefusedError) => {
      assert.equal(error.name, "SettingsRefusedError");
      assert.equal(error.reasons.length, 1);
      assert.match(error.reasons[0]!, /Team 1 holds 4 players and that shape leaves room for 3/);
      return true;
    });

  // Growing it is never a contradiction, and the same submission goes through.
  await updateSettings(db, { leagueId: 1, byUserId: commish, patch: { bench: 4 }, now: NOW });
  assert.equal((await leagueSettings(db, 1)).bench, 4);
});

test("a roster the change does not touch is not consulted", async () => {
  for (const id of [1, 2, 3, 4]) await give(1, id);
  // The budget has nothing to do with the roster limit, so a full roster does
  // not stand in the way of it.
  const result = await updateSettings(db, {
    leagueId: 1, byUserId: commish, patch: { faabBudget: 50 }, now: NOW });
  assert.deepEqual(result.changed, [{ key: "faabBudget", from: "100", to: "50" }]);
});

test("the budget cannot drop below what somebody has already spent", async () => {
  await db.query(
    `INSERT INTO waiver_claim
       (league_id, fantasy_team_id, player_id, bid, sequence, status, runs_at)
     VALUES (1, 2, 5, 60, 1, 'won', '2026-01-08T09:00:00Z')`);

  await assert.rejects(
    updateSettings(db, { leagueId: 1, byUserId: commish, patch: { faabBudget: 40 }, now: NOW }),
    (error: SettingsRefusedError) => {
      assert.match(error.reasons[0]!, /Team 2 has already spent \$60/);
      return true;
    });

  await updateSettings(db, { leagueId: 1, byUserId: commish, patch: { faabBudget: 60 }, now: NOW });
  assert.equal((await leagueSettings(db, 1)).faabBudget, 60);
});

test("the scoring period is frozen once the schedule is drawn", async () => {
  await updateSettings(db, { leagueId: 1, byUserId: commish, patch: { periodDays: 3 }, now: NOW });
  assert.equal((await leagueSettings(db, 1)).periodDays, 3);

  await playAWeek();
  await assert.rejects(
    updateSettings(db, { leagueId: 1, byUserId: commish, patch: { periodDays: 7 }, now: NOW }),
    (error: SettingsRefusedError) => {
      assert.match(error.reasons[0]!, /schedule is already drawn/);
      return true;
    });
});

test("every reason at once, so the form is filled in once", async () => {
  for (const id of [1, 2, 3, 4]) await give(1, id);
  await db.query(
    `INSERT INTO waiver_claim
       (league_id, fantasy_team_id, player_id, bid, sequence, status, runs_at)
     VALUES (1, 2, 5, 60, 1, 'won', '2026-01-08T09:00:00Z')`);

  await assert.rejects(
    updateSettings(db, {
      leagueId: 1, byUserId: commish,
      patch: { bench: 0, faabBudget: 40, waiverHour: 99 }, now: NOW,
    }),
    (error: SettingsRefusedError) => {
      assert.equal(error.reasons.length, 3);
      return true;
    });
  // And nothing was saved on the way to refusing.
  assert.equal((await leagueSettings(db, 1)).waiverHour, DEFAULT_SETTINGS.waiverHour);
});

// --- the one that is scoring -----------------------------------------------

test("a settled week is the sum of its starters' games", async () => {
  await playAWeek();

  // Every started game counts, so each starter's week is his id five times
  // over: team 1 keeps (1+2+3+4)*5 = 50, team 2 (5+6+7+8)*5 = 130. There is
  // no cap left to move, which is why nothing here tries to move one.
  const table = await standings(db, 1);
  assert.equal(table.find((r) => r.name === "Team 1")!.pointsFor, 50);
  assert.equal(table.find((r) => r.name === "Team 2")!.pointsFor, 130);
});

test("a settled matchup records the config and settings it was scored under", async () => {
  await playAWeek();
  const { rows } = await db.query<{ config_id: string; settings: LeagueSettings }>(
    "SELECT config_id, settings FROM matchup WHERE id = 1");
  assert.equal(Number(rows[0]!.config_id), configId);
  assert.equal(rows[0]!.settings.gamesCap, 4);
});

test("an unsettled week is left alone by a cap change", async () => {
  await playAWeek();
  await db.query(
    "UPDATE matchup SET settled_at = NULL, home_points = NULL, away_points = NULL, " +
    "config_id = NULL, settings = NULL");
  await updateSettings(db, { leagueId: 1, byUserId: commish, patch: { gamesCap: 2 }, now: NOW });
  const { rows } = await db.query<{ home_points: number | null }>(
    "SELECT home_points FROM matchup");
  assert.equal(rows[0]!.home_points, null);
});

// --- what is already in flight ---------------------------------------------

test("a sealed bid keeps the hour it was filed for, and is said so", async () => {
  await db.query(
    `INSERT INTO waiver_claim
       (league_id, fantasy_team_id, player_id, bid, sequence, status, runs_at)
     VALUES (1, 2, 5, 3, 1, 'pending', '2026-01-13T09:00:00Z')`);

  const result = await updateSettings(db, {
    leagueId: 1, byUserId: commish, patch: { waiverHour: 14 }, now: NOW });
  assert.match(result.notes[0]!, /1 sealed bid will still open at the hour they were filed for/);

  const { rows } = await db.query<{ runs_at: Date }>("SELECT runs_at FROM waiver_claim");
  assert.equal(rows[0]!.runs_at.toISOString(), "2026-01-13T09:00:00.000Z");
});

test("a deadline already in the past says what it will do to standing offers", async () => {
  await db.query(
    `INSERT INTO trade (league_id, from_team_id, to_team_id, status, expires_at)
     VALUES (1, 1, 2, 'proposed', '2026-01-20T00:00:00Z')`);

  const result = await updateSettings(db, {
    leagueId: 1, byUserId: commish, patch: { tradeDeadline: "2026-01-10" }, now: NOW });
  assert.equal(result.settings.tradeDeadline, "2026-01-10");
  assert.ok(result.notes.some((n) => /1 standing offer will expire on the next read/.test(n)));
});

// --- the context the screen explains itself with ----------------------------

test("the context is the league's own state, not a guess", async () => {
  await playAWeek();
  await db.query(
    `INSERT INTO waiver_claim
       (league_id, fantasy_team_id, player_id, bid, sequence, status, runs_at)
     VALUES (1, 2, 5, 12, 1, 'won', '2026-01-08T09:00:00Z')`);

  const context = await settingsContext(db, { leagueId: 1, on: "2026-01-12" });
  assert.equal(context.largestRoster?.teamName, "Team 1");
  assert.equal(context.largestRoster?.size, 4);
  assert.equal(context.mostSpent?.teamName, "Team 2");
  assert.equal(context.mostSpent?.spent, 12);
  assert.equal(context.settledWeeks, 1);
  assert.equal(context.scheduleDrawn, true);
  assert.equal(context.pendingClaims, 0);
});
