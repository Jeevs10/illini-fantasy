import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, scoreLine, type PlayerLine } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, writeScores, type Db, type StoredScore } from "@illini/db";
import { scorePeriod, settleWeek, standings } from "./settle.ts";
import { generateSchedule } from "./schedule.ts";
import { DEFAULT_SETTINGS } from "./slots.ts";

let db: Db;
let configId: number;

const line = (id: number, points: number): PlayerLine => ({
  playerId: String(id), name: `Player ${id}`, team: "Illinois", conference: "B10", role: "Combo G",
  minutes: 30, points, rebounds: 5, assists: 3,
  effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.36, freeThrowPct: 0.78,
  usage: 22, assistPct: 15, turnoverPct: 14, stealPct: 2, blockPct: 3,
  defensiveRating: 98, offensiveReboundPct: 6, defensiveReboundPct: 16,
  bpm: 4, obpm: 2, dbpm: 2, porpag: 2.5,
  attempts: { three: 5, freeThrow: 4, fieldGoal: 13 },
});
const scoreOf = (points: number) => scoreLine(line(1, points), GAME_CONFIG, 1).score;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_league_test");
  await admin.query("CREATE DATABASE illini_league_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_league_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')");
  await db.query("INSERT INTO app_user (id, email, display_name, username) VALUES (1,'a@b.c','A','abc')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings) VALUES (1,'L',2026,$1,$2)`,
    [configId, JSON.stringify(DEFAULT_SETTINGS)]);
  for (let t = 1; t <= 4; t += 1) {
    await db.query("INSERT INTO fantasy_team (id, league_id, owner_id, name) VALUES ($1,1,1,$2)",
      [t, `Team ${t}`]);
  }

  // 12 players, each playing one game a day across a Mon-Sun period.
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
                "2026-11-06", "2026-11-07", "2026-11-08"];
  for (let id = 1; id <= 12; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,1)",
      [id, `Player ${id}`, `player ${id}`]);
  }
  for (const day of days) {
    const scores: StoredScore[] = [];
    for (let id = 1; id <= 12; id += 1) {
      await db.query(
        `INSERT INTO player_game_stat (player_id, played_on, season, minutes, stats, source)
         VALUES ($1,$2,2026,30,'{}'::jsonb,'torvik')`, [id, day]);
      scores.push({ ...scoreLine(line(id, 10 + id), GAME_CONFIG, 1), playedOn: day });
    }
    await writeScores(db, configId, day, scores);
  }
});

after(async () => { await db?.end(); });

test("only started players count, and the bench never does", async () => {
  // Two starters and one benched, all on the same day.
  for (const [player, slot] of [[1, "G"], [2, "FLEX"], [3, "BENCH"]] as const) {
    await db.query(
      `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot)
       VALUES (1,'2026-11-02',$1,$2)`, [player, slot]);
  }
  const period = await scorePeriod(db, {
    fantasyTeamId: 1, configId, from: "2026-11-02", to: "2026-11-08",
  });
  assert.equal(period.gamesPlayed, 2);
  const expected = scoreOf(11) + scoreOf(12);
  assert.ok(Math.abs(period.total - expected) < 1e-9,
    `bench leaked in: ${period.total} vs ${expected}`);
});

test("the games cap keeps the best games, not the earliest", async () => {
  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 2");
  // 12 started games across the week, worth more than the 9-game cap allows.
  const days = ["2026-11-02", "2026-11-03", "2026-11-04"];
  let player = 1;
  for (const day of days) {
    for (let i = 0; i < 4; i += 1) {
      await db.query(
        `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot)
         VALUES (2,$1,$2,'FLEX')`, [day, player]);
      player = (player % 12) + 1;
    }
  }
  const period = await scorePeriod(db, {
    fantasyTeamId: 2, configId, from: "2026-11-02", to: "2026-11-08",
  });
  assert.equal(period.gamesPlayed, 12);
  assert.equal(period.gamesCounted, DEFAULT_SETTINGS.gamesCap);

  const counted = period.games.filter((g) => g.counted).map((g) => g.score);
  const dropped = period.games.filter((g) => !g.counted).map((g) => g.score);
  assert.ok(Math.min(...counted) >= Math.max(...dropped),
    "a dropped game outscored a counted one — the cap is taking the wrong games");
});

test("settling a week is re-runnable and does not double-count", async () => {
  await generateSchedule(db, 1, "2026-11-02", 3);
  const first = await settleWeek(db, 1, 1);
  const second = await settleWeek(db, 1, 1);
  assert.ok(first.length > 0);
  assert.equal(first.length, second.length);
  assert.deepEqual(
    first.map((m) => [m.home.total, m.away.total]),
    second.map((m) => [m.home.total, m.away.total]),
    "totals must be recomputed, not accumulated",
  );
});

test("standings count only settled weeks", async () => {
  const table = await standings(db, 1);
  assert.equal(table.length, 4);
  const played = table.reduce((a, r) => a + r.wins + r.losses + r.ties, 0);
  // Week 1 settled two matchups, so four team-results; weeks 2 and 3 are not.
  assert.equal(played, 4, `unsettled weeks leaked into the standings: ${played}`);
});

test("a re-scored night flows through to the standings", async () => {
  const before = (await settleWeek(db, 1, 1)).map((m) => m.home.total);
  // A stat correction: player 1 actually scored far more that night.
  await writeScores(db, configId, "2026-11-02", [
    { ...scoreLine(line(1, 34), GAME_CONFIG, 1), playedOn: "2026-11-02" },
  ]);
  const after = (await settleWeek(db, 1, 1)).map((m) => m.home.total);
  assert.notDeepEqual(before, after, "a corrected score must move the matchup");
});
