import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import {
  topPerformances, trendingPlayers, playerRankTrend, playerWeekProjection, statPercentiles,
} from "./leaders.ts";

let db: Db;
let configId: number;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_leaders_test");
  await admin.query("CREATE DATABASE illini_leaders_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_leaders_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));

  await db.query(
    `INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois'), (2,'Rival','rival')`,
  );
  await db.query(
    `INSERT INTO player (id, name, normalised, team_id, position) VALUES
     (1, 'Guard One', 'guard one', 1, 'Pure PG'),
     (2, 'Big One', 'big one', 1, 'C'),
     (3, 'Guard Two', 'guard two', 1, 'Pure PG')`,
  );
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings) VALUES (1, 'Test League', 2026, $1, '{}')`,
    [configId],
  );
  await db.query(`INSERT INTO fantasy_team (id, league_id, name) VALUES (11, 1, 'Alpha'), (12, 1, 'Beta')`);
});

after(async () => { await db?.end(); });

async function insertStat(
  playerId: number, playedOn: string, role: string, stats: Record<string, unknown>, season = 2026,
): Promise<void> {
  await db.query(
    `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
     VALUES ($1, $2, $3, $4, 30, $5, 'torvik')`,
    [playerId, playedOn, season, role, JSON.stringify(stats)],
  );
}

async function insertScore(playerId: number, playedOn: string, score: number, archetype = "lead"): Promise<void> {
  await db.query(
    `INSERT INTO player_game_score
       (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
     VALUES ($1, $2, $3, $4, '{}', $5, 1, 1, $5)`,
    [playerId, playedOn, configId, archetype, score],
  );
}

// ---------------------------------------------------------------------------
// topPerformances
// ---------------------------------------------------------------------------

test("topPerformances orders by score and attributes ownership", async () => {
  await insertStat(1, "2026-01-01", "Pure PG", { points: 20, rebounds: 5, assists: 8 });
  await insertScore(1, "2026-01-01", 40);
  await insertStat(2, "2026-01-01", "C", { points: 10, rebounds: 12, assists: 1 });
  await insertScore(2, "2026-01-01", 30);
  await insertStat(3, "2026-01-02", "Pure PG", { points: 25, rebounds: 3, assists: 10 });
  await insertScore(3, "2026-01-02", 50);

  await db.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
     VALUES (11, 1, 1, '2025-12-01', 'draft')`,
  );

  const top = await topPerformances(db, { leagueId: 1, configId, from: "2026-01-01", to: "2026-01-02" });
  assert.deepEqual(top.map((t) => [t.playerId, t.score]), [[3, 50], [1, 40], [2, 30]]);
  assert.equal(top.find((t) => t.playerId === 1)!.ownedBy, "Alpha");
  assert.equal(top.find((t) => t.playerId === 2)!.ownedBy, null);
});

test("topPerformances' role filter expands to Torvik's own role strings", async () => {
  const bigs = await topPerformances(db, {
    leagueId: 1, configId, from: "2026-01-01", to: "2026-01-02", roles: ["B"],
  });
  assert.deepEqual(bigs.map((t) => t.playerId), [2]);

  const guards = await topPerformances(db, {
    leagueId: 1, configId, from: "2026-01-01", to: "2026-01-02", roles: ["G"],
  });
  assert.deepEqual(guards.map((t) => t.playerId), [3, 1]);
});

// ---------------------------------------------------------------------------
// trendingPlayers
// ---------------------------------------------------------------------------

test("trendingPlayers counts roster moves per player within the window", async () => {
  await db.query(
    `INSERT INTO transaction (league_id, kind, payload, created_at) VALUES
     (1, 'draft', '{"playerId": 1}', now() - interval '2 days'),
     (1, 'waiver', '{"playerId": 1}', now() - interval '1 days'),
     (1, 'release', '{"playerId": 2}', now() - interval '10 days'),
     (1, 'settings', '{}', now())`,
  );

  const trending = await trendingPlayers(db, {
    leagueId: 1, since: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  });
  assert.deepEqual(trending.map((t) => [t.playerId, t.moves]), [[1, 2]]);
});

// ---------------------------------------------------------------------------
// playerRankTrend
// ---------------------------------------------------------------------------

test("playerRankTrend reads the rank rollup in date order", async () => {
  await db.query(
    `INSERT INTO player_rank (config_id, played_on, player_id, season_total, games, rank_overall, rank_role)
     VALUES
     ($1, '2026-01-01', 1, 40, 1, 2, 1),
     ($1, '2026-01-02', 1, 40, 1, 3, 2),
     ($1, '2026-01-03', 1, 55, 2, 1, 1)`,
    [configId],
  );

  const trend = await playerRankTrend(db, { playerId: 1, configId, from: "2026-01-01", to: "2026-01-03" });
  assert.deepEqual(trend.map((p) => [p.playedOn, p.seasonTotal, p.rankOverall]), [
    ["2026-01-01", 40, 2],
    ["2026-01-02", 40, 3],
    ["2026-01-03", 55, 1],
  ]);
});

// ---------------------------------------------------------------------------
// playerWeekProjection
// ---------------------------------------------------------------------------

test("playerWeekProjection times the scheduled game count by the prior average", async () => {
  // Player 1's only score before the window is the 40 from the top-performances
  // fixture above, so the average under this config is exactly 40.
  await db.query(
    `INSERT INTO game (played_on, season, home_team_id, away_team_id) VALUES
     ('2026-01-10', 2026, 1, 2),
     ('2026-01-12', 2026, 2, 1),
     ('2026-01-14', 2026, 1, 2)`,
  );

  const projection = await playerWeekProjection(db, {
    playerId: 1, configId, from: "2026-01-10", to: "2026-01-16",
  });
  assert.equal(projection.gamesScheduled, 3);
  assert.equal(projection.average, 40);
  assert.equal(projection.projectedTotal, 120);
});

test("playerWeekProjection is zero for a player with no scored history", async () => {
  const projection = await playerWeekProjection(db, {
    playerId: 999, configId, from: "2026-01-10", to: "2026-01-16",
  });
  assert.equal(projection.average, 0);
  assert.equal(projection.projectedTotal, 0);
});

// ---------------------------------------------------------------------------
// statPercentiles
// ---------------------------------------------------------------------------

test("statPercentiles ranks a player against same-role peers, direction included", async () => {
  // Two Pure PGs already have season stat lines from the topPerformances
  // fixture: player 1 (20 pts/game) and player 3 (25 pts/game).
  const p1 = await statPercentiles(db, { playerId: 1, season: 2026, role: "Pure PG" });
  const p3 = await statPercentiles(db, { playerId: 3, season: 2026, role: "Pure PG" });

  const points1 = p1.find((s) => s.stat === "points")!;
  const points3 = p3.find((s) => s.stat === "points")!;
  assert.equal(points1.value, 20);
  assert.equal(points3.value, 25);
  assert.ok(points3.percentile > points1.percentile);
});

test("statPercentiles returns nothing for a player with no games at that role", async () => {
  const none = await statPercentiles(db, { playerId: 999, season: 2026, role: "Pure PG" });
  assert.deepEqual(none, []);
});
