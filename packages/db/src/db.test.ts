import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, SEASON_CONFIG, scoreLine, type PlayerLine } from "@illini/scoring";
import { connect, migrate, digestConfig, upsertScoringConfig, type Db } from "./client.ts";
import { writeScores, compareConfigs, matchupTotal, type StoredScore } from "./score-store.ts";

const URL = process.env.TEST_DATABASE_URL
  ?? "postgresql://postgres:dev@localhost:55432/illini_test";
let db: Db;

const line = (id: string, points: number): PlayerLine => ({
  playerId: id, name: `Player ${id}`, team: "Illinois", conference: "B10", role: "Combo G",
  minutes: 30, points, rebounds: 5, assists: 3,
  effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.36, freeThrowPct: 0.78,
  usage: 22, assistPct: 15, turnoverPct: 14, stealPct: 2, blockPct: 3,
  defensiveRating: 98, offensiveReboundPct: 6, defensiveReboundPct: 16,
  bpm: 4, obpm: 2, dbpm: 2, porpag: 2.5,
  attempts: { three: 5, freeThrow: 4, fieldGoal: 13 },
});

const store = (l: PlayerLine, cfg = GAME_CONFIG): StoredScore => ({
  ...scoreLine(l, cfg, 1), playedOn: "2026-02-14",
});

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_test");
  await admin.query("CREATE DATABASE illini_test");
  await admin.end();

  db = connect(URL);
  const applied = await migrate(db);
  assert.ok(applied.length >= 3, `expected migrations to apply, got ${applied.join(",")}`);

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1, 'Illinois', 'illinois')");
  for (let i = 1; i <= 3; i += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,1)",
      [i, `Player ${i}`, `player ${i}`]);
    await db.query(
      `INSERT INTO player_game_stat (player_id, played_on, season, minutes, stats, source)
       VALUES ($1, '2026-02-14', 2026, 30, '{}'::jsonb, 'torvik')`, [i]);
  }
});

after(async () => { await db?.end(); });

test("migrations are idempotent — a second run applies nothing", async () => {
  assert.deepEqual(await migrate(db), []);
});

test("an identical config is stored once, a changed one gets its own version", async () => {
  const a = await upsertScoringConfig(db, "game", GAME_CONFIG);
  const b = await upsertScoringConfig(db, "game again", GAME_CONFIG);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.id, b.id, "same config must not create a second version");

  const c = await upsertScoringConfig(db, "season", SEASON_CONFIG);
  assert.equal(c.created, true);
  assert.notEqual(c.id, a.id);
});

test("the digest ignores key order", () => {
  const reordered = JSON.parse(JSON.stringify({
    ...GAME_CONFIG, weights: { ...GAME_CONFIG.weights },
  })) as typeof GAME_CONFIG;
  assert.equal(digestConfig(reordered), digestConfig(GAME_CONFIG));
});

test("re-scoring a night is idempotent, not additive", async () => {
  const { id } = await upsertScoringConfig(db, "game", GAME_CONFIG);
  const scores = [1, 2, 3].map((i) => store(line(String(i), 10 + i)));

  await writeScores(db, id, "2026-02-14", scores);
  const first = await db.query("SELECT count(*) c FROM player_game_score WHERE config_id = $1", [id]);
  await writeScores(db, id, "2026-02-14", scores);
  const second = await db.query("SELECT count(*) c FROM player_game_score WHERE config_id = $1", [id]);

  assert.equal(first.rows[0]!.c, "3");
  assert.equal(second.rows[0]!.c, "3", "replaying a night must not duplicate rows");
});

test("a stat correction overwrites the score in place", async () => {
  const { id } = await upsertScoringConfig(db, "game", GAME_CONFIG);
  const before = scoreLine(line("1", 11), GAME_CONFIG, 1).score;
  await writeScores(db, id, "2026-02-14", [store(line("1", 31))]);
  const { rows } = await db.query<{ score: number }>(
    "SELECT score FROM player_game_score WHERE player_id = 1 AND config_id = $1", [id]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.score > before, "a corrected 31-point line must outscore the original 11");
});

test("a new config version leaves the old scores intact", async () => {
  const base = await upsertScoringConfig(db, "game", GAME_CONFIG);
  const tweaked = { ...GAME_CONFIG, normaliseWeights: true };
  const candidate = await upsertScoringConfig(db, "normalised", tweaked);

  const lines = [1, 2, 3].map((i) => line(String(i), 10 + i));
  await writeScores(db, base.id, "2026-02-14", lines.map((l) => store(l)));
  await writeScores(db, candidate.id, "2026-02-14", lines.map((l) => store(l, tweaked)));

  const { rows } = await db.query<{ config_id: string; n: string }>(
    "SELECT config_id, count(*) n FROM player_game_score GROUP BY config_id ORDER BY config_id");
  assert.ok(rows.length >= 2, "both config versions must retain their own scores");

  const diff = await compareConfigs(db, base.id, candidate.id, 2026);
  assert.equal(diff.players, 3);
});

test("a matchup total counts only started players", async () => {
  const { id } = await upsertScoringConfig(db, "game", GAME_CONFIG);
  await writeScores(db, id, "2026-02-14", [1, 2, 3].map((i) => store(line(String(i), 10 + i))));

  await db.query("INSERT INTO app_user (id, email, display_name, username) VALUES (1,'a@b.c','A','abc')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings) VALUES (1,'L',2026,$1,'{}'::jsonb)`, [id]);
  await db.query("INSERT INTO fantasy_team (id, league_id, owner_id, name) VALUES (1,1,1,'T')");
  // Start two of the three rostered players.
  for (const p of [1, 2]) {
    await db.query(
      `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot)
       VALUES (1, '2026-02-14', $1, 'G')`, [p]);
  }

  const total = await matchupTotal(db, 1, id, "2026-02-01", "2026-02-28");
  const expected = [1, 2]
    .map((i) => scoreLine(line(String(i), 10 + i), GAME_CONFIG, 1).score)
    .reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - expected) < 1e-6, `benched player leaked into the total: ${total} vs ${expected}`);
});
