import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, scoreLine, type PlayerLine } from "@illini/scoring";
import {
  connect, migrate, upsertScoringConfig, writeScores, type Db, type StoredScore,
} from "@illini/db";
import {
  InvalidLineupError, LineupLockedError, NotOnRosterError,
  autoFillDay, autoFillLeague, setLineup, startableOn,
} from "./lineups.ts";
import { claimPlayer } from "./roster.ts";
import { DEFAULT_SETTINGS } from "./slots.ts";

let db: Db;
let configId: number;

const DAY = "2026-11-10";
const EARLY = "2026-11-10T00:00:00Z";   // 7pm ET
const LATE = "2026-11-10T03:30:00Z";    // 10:30pm ET
const BEFORE_TIP = new Date("2026-11-09T18:00:00Z");
const BETWEEN_TIPS = new Date("2026-11-10T01:00:00Z");

// Illinois (1) plays early, Purdue (2) plays late. Roster is drawn from both so
// half the lineup locks before the other half.
const ROLES = ["Pure PG", "Combo G", "Wing F", "Wing F", "Stretch 4", "C",
               "Scoring PG", "Wing G", "PF/C", "C"];

const line = (id: number, points: number, role: string): PlayerLine => ({
  playerId: String(id), name: `Player ${id}`, team: "Illinois", conference: "B10", role,
  minutes: 30, points, rebounds: 5, assists: 3,
  effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.36, freeThrowPct: 0.78,
  usage: 22, assistPct: 15, turnoverPct: 14, stealPct: 2, blockPct: 3,
  defensiveRating: 98, offensiveReboundPct: 6, defensiveReboundPct: 16,
  bpm: 4, obpm: 2, dbpm: 2, porpag: 2.5,
  attempts: { three: 5, freeThrow: 4, fieldGoal: 13 },
});

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_lineup_test");
  await admin.query("CREATE DATABASE illini_lineup_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_lineup_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));

  await db.query(`INSERT INTO team (id, name, normalised) VALUES
    (1,'Illinois','illinois'), (2,'Purdue','purdue'), (3,'Iowa','iowa'), (4,'Ohio State','ohio state')`);
  await db.query("INSERT INTO app_user (id, email, display_name) VALUES (1,'c@i.test','C')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES (1,'L',2026,$1,$2,1)`, [configId, JSON.stringify(DEFAULT_SETTINGS)]);
  await db.query(`INSERT INTO fantasy_team (id, league_id, owner_id, name) VALUES
    (1,1,1,'Alpha'), (2,1,1,'Beta')`);

  // The schedule, with tip-off times and no box scores — the state the world is
  // actually in when a manager sets a lineup.
  await db.query(
    `INSERT INTO game (id, played_on, season, home_team_id, away_team_id, tipoff) VALUES
       (1, $1, 2026, 1, 3, $2), (2, $1, 2026, 2, 4, $3)`, [DAY, EARLY, LATE]);
  await db.query(
    `INSERT INTO team_rating (team_id, season, as_of, strength) VALUES
       (3, 2026, '2026-11-01', 0.9), (4, 2026, '2026-11-01', 0.2)`);

  for (let id = 1; id <= 10; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,$4)",
      [id, `Player ${id}`, `player ${id}`, id <= 5 ? 1 : 2]);
    await claimPlayer(db, { fantasyTeamId: 1, playerId: id, on: "2026-11-01", via: "draft" });
  }

  // Prior form, so auto-fill has something to rank on. Higher ids score more.
  const prior = "2026-11-05";
  const scores: StoredScore[] = [];
  for (let id = 1; id <= 10; id += 1) {
    await db.query(
      `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
       VALUES ($1,$2,2026,$3,30,'{}'::jsonb,'torvik')`, [id, prior, ROLES[id - 1]]);
    scores.push({ ...scoreLine(line(id, 8 + id, ROLES[id - 1]!), GAME_CONFIG, 1), playedOn: prior });
  }
  await writeScores(db, configId, prior, scores);
});

after(async () => { await db?.end(); });

test("startability comes from the schedule, not from a box score that does not exist yet", async () => {
  const { rows } = await db.query("SELECT count(*) c FROM player_game_stat WHERE played_on = $1", [DAY]);
  assert.equal(Number((rows[0] as { c: string }).c), 0, "no stats for the night in question");

  const startable = await startableOn(db,
    { fantasyTeamId: 1, day: DAY, configId, now: BEFORE_TIP });
  assert.equal(startable.length, 10, "everyone whose real team plays tonight");
  assert.ok(startable.every((s) => !s.locked), "nothing has tipped off");

  const illini = startable.find((s) => s.playerId === 1)!;
  assert.equal(illini.opponent, "Iowa");
  assert.equal(illini.opponentStrength, 0.9, "opponent strength rides along for the multiplier");
  assert.equal(illini.archetype, "lead", "archetype comes from what actually scored him");
});

test("a lineup can be set the night before, and must be legal", async () => {
  const result = await setLineup(db, {
    fantasyTeamId: 1, day: DAY, configId, now: BEFORE_TIP,
    entries: [
      { playerId: 7, slot: "G" }, { playerId: 8, slot: "G" },
      { playerId: 3, slot: "F" }, { playerId: 4, slot: "F" },
      { playerId: 10, slot: "C" },
      { playerId: 9, slot: "FLEX" }, { playerId: 5, slot: "FLEX" },
    ],
  });
  assert.equal(result.entries.filter((e) => e.slot !== "BENCH").length, 7);
  assert.deepEqual(result.locked, []);

  await assert.rejects(
    () => setLineup(db, {
      fantasyTeamId: 1, day: DAY, configId, now: BEFORE_TIP,
      entries: [{ playerId: 1, slot: "C" }],
    }),
    (error: Error) => error instanceof InvalidLineupError && /cannot start at C/.test(error.message));

  await assert.rejects(
    () => setLineup(db, {
      fantasyTeamId: 1, day: DAY, configId, now: BEFORE_TIP,
      entries: [{ playerId: 99, slot: "G" }],
    }),
    (error: Error) => error instanceof NotOnRosterError);
});

test("the lock is per game, so the late slate is still editable", async () => {
  // Player 3 (Illinois) tipped off at 7pm; player 9 (Purdue) has not.
  await assert.rejects(
    () => setLineup(db, {
      fantasyTeamId: 1, day: DAY, configId, now: BETWEEN_TIPS,
      entries: [{ playerId: 3, slot: "BENCH" }],
    }),
    (error: Error) => error instanceof LineupLockedError && error.playerId === 3);

  // Sliding someone into a slot a locked player holds is the same violation
  // seen from the other side, and is caught as an overfilled slot.
  await assert.rejects(
    () => setLineup(db, {
      fantasyTeamId: 1, day: DAY, configId, now: BETWEEN_TIPS,
      entries: [{ playerId: 6, slot: "F" }],
    }),
    (error: Error) => error instanceof InvalidLineupError && /room for 2/.test(error.message));

  // The late game is untouched by any of that.
  const swapped = await setLineup(db, {
    fantasyTeamId: 1, day: DAY, configId, now: BETWEEN_TIPS,
    entries: [{ playerId: 9, slot: "BENCH" }, { playerId: 6, slot: "FLEX" }],
  });
  assert.equal(swapped.entries.find((e) => e.playerId === 6)?.slot, "FLEX");
  assert.equal(swapped.entries.find((e) => e.playerId === 9)?.slot, "BENCH");
  assert.deepEqual(swapped.locked.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("auto-fill cannot undo a decision the clock already made", async () => {
  // Bench everyone eligible before tip-off, then let auto-fill run mid-slate.
  await setLineup(db, {
    fantasyTeamId: 2, day: DAY, configId, now: BEFORE_TIP, entries: [],
  }).catch(() => undefined);

  const filled = await autoFillDay(db,
    { fantasyTeamId: 1, day: DAY, configId, now: BETWEEN_TIPS });

  for (const id of [1, 2, 3, 4, 5]) {
    const before = (await startableOn(db, { fantasyTeamId: 1, day: DAY, configId, now: BETWEEN_TIPS }))
      .find((s) => s.playerId === id)!;
    assert.equal(filled.entries.find((e) => e.playerId === id)?.slot, before.slot,
      `locked player ${id} keeps the slot he tipped off in`);
  }

  const starters = filled.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR");
  assert.ok(starters.length <= 7, "auto-fill never exceeds the starting slots");
});

test("auto-filling a league covers every team", async () => {
  const result = await autoFillLeague(db, 1, DAY, BEFORE_TIP);
  assert.equal(result.teams, 2);
  assert.ok(result.started > 0);

  // Beta rosters nobody, so it starts nobody rather than erroring.
  const { rows } = await db.query(
    "SELECT count(*) c FROM lineup_entry WHERE fantasy_team_id = 2 AND played_on = $1", [DAY]);
  assert.equal(Number((rows[0] as { c: string }).c), 0);
});

test("a started player carries the game he was started for", async () => {
  const { rows } = await db.query<{ player_id: string; game_id: string | null }>(
    `SELECT player_id, game_id FROM lineup_entry
      WHERE fantasy_team_id = 1 AND played_on = $1 ORDER BY player_id`, [DAY]);
  assert.equal(rows.length, 10);
  for (const row of rows) {
    // Illinois players to game 1, Purdue to game 2 — the lock's anchor.
    assert.equal(Number(row.game_id), Number(row.player_id) <= 5 ? 1 : 2);
  }
});
