import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import { weeklyReport } from "./report.ts";

let db: Db;
let configId: number;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_report_test");
  await admin.query("CREATE DATABASE illini_report_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_report_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));

  await db.query(`INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')`);
  await db.query(
    `INSERT INTO player (id, name, normalised, team_id, position) VALUES
     (1, 'Starter', 'starter', 1, 'Pure PG'),
     (2, 'Benched', 'benched', 1, 'C'),
     (3, 'Wire Guy', 'wire guy', 1, 'Pure PG'),
     (4, 'Other Team', 'other team', 1, 'Wing G'),
     (5, 'Pickup', 'pickup', 1, 'Wing G'),
     (6, 'Dud', 'dud', 1, 'Wing G'),
     (7, 'Idle Add', 'idle add', 1, 'Wing G'),
     (8, 'Late Add', 'late add', 1, 'Wing G'),
     (9, 'Mid Week', 'mid week', 1, 'Wing G'),
     (10, 'Dropped', 'dropped', 1, 'Wing G')`,
  );
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings) VALUES (1, 'L', 2026, $1, '{}')`,
    [configId],
  );
  await db.query(`INSERT INTO fantasy_team (id, league_id, name) VALUES (11, 1, 'Alpha'), (12, 1, 'Beta')`);
  await db.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via) VALUES
     (11, 1, 1, '2025-12-01', 'draft'), (11, 1, 2, '2025-12-01', 'draft'), (12, 1, 4, '2025-12-01', 'draft'),
     (12, 1, 5, '2026-01-02', 'free_agent'), (11, 1, 6, '2025-12-31', 'waiver'),
     (11, 1, 7, '2026-01-03', 'free_agent'), (12, 1, 8, '2026-01-07', 'free_agent'),
     (12, 1, 9, '2026-01-03', 'trade')`,
  );
  await db.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via, released_on) VALUES
     (11, 1, 10, '2025-12-01', 'draft', '2026-01-05')`,
  );
  await db.query(
    `INSERT INTO matchup (league_id, week, starts_on, ends_on, home_team_id, away_team_id,
                          home_points, away_points, settled_at) VALUES
     (1, 1, '2026-01-01', '2026-01-07', 11, 12, 40, 25, now()),
     (1, 2, '2026-01-08', '2026-01-14', 12, 11, NULL, NULL, NULL)`,
  );

  for (const [player, on, score] of [[1, "2026-01-02", 40], [2, "2026-01-02", 99], [3, "2026-01-03", 33], [4, "2026-01-03", 25], [5, "2026-01-04", 12], [6, "2026-01-04", 2], [8, "2026-01-07", 30], [9, "2026-01-02", 20], [10, "2026-01-02", 18]] as const) {
    await db.query(
      `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
       VALUES ($1, $2, 2026, 'Pure PG', 30, '{}', 'torvik')`,
      [player, on],
    );
    await db.query(
      `INSERT INTO player_game_score
         (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
       VALUES ($1, $2, $3, 'lead', '{}', $4, 1, 1, $4)`,
      [player, on, configId, score],
    );
  }
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot) VALUES
     (11, '2026-01-02', 1, 'G'), (11, '2026-01-02', 2, 'BENCH'), (12, '2026-01-03', 4, 'G'),
     (12, '2026-01-04', 5, 'F'), (11, '2026-01-04', 6, 'F'), (12, '2026-01-07', 8, 'F')`,
  );

  // Tip-off projections: Alpha 40 projected for 42 scored (+2), Beta 90 for
  // 67 (−23). The benched 50 never counted, so it is not compared.
  await db.query(
    `INSERT INTO game (id, played_on, season, home_team_id) VALUES
     (101, '2026-01-02', 2026, 1), (102, '2026-01-03', 2026, 1),
     (103, '2026-01-04', 2026, 1), (104, '2026-01-07', 2026, 1)`,
  );
  await db.query(
    `INSERT INTO player_game_projection (player_id, game_id, played_on, projected, as_of) VALUES
     (1, 101, '2026-01-02', 30, '2026-01-02'), (2, 101, '2026-01-02', 50, '2026-01-02'),
     (6, 103, '2026-01-04', 10, '2026-01-04'), (4, 102, '2026-01-03', 20, '2026-01-03'),
     (5, 103, '2026-01-04', 20, '2026-01-04'), (8, 104, '2026-01-07', 50, '2026-01-07')`,
  );
});

after(async () => { await db?.end(); });

test("weeklyReport reads the last settled week", async () => {
  const report = await weeklyReport(db, { leagueId: 1, configId, fantasyTeamId: 11 });
  assert.ok(report);
  assert.equal(report.week, 1);
  assert.deepEqual(report.teams.map((t) => [t.name, t.points, t.rank, t.won]),
    [["Alpha", 40, 1, true], ["Beta", 25, 2, false]]);
});

test("rostered and wire split on who holds a player now, each by his whole week", async () => {
  const report = (await weeklyReport(db, { leagueId: 1, configId, fantasyTeamId: 11 }))!;
  // Benched points count — the player is rostered and he scored them — and
  // Mid Week's game before Beta got him still counts toward his week.
  assert.deepEqual(report.rostered.map((p) => [p.playerName, p.points, p.ownedBy]),
    [["Benched", 99, "Alpha"], ["Starter", 40, "Alpha"], ["Late Add", 30, "Beta"],
     ["Other Team", 25, "Beta"], ["Mid Week", 20, "Beta"]]);
  // The wire is who nobody holds now: Mid Week has been picked up, and
  // Dropped's 18 came while Alpha still had him.
  assert.deepEqual(report.unrostered.map((p) => [p.playerName, p.points]), [["Wire Guy", 33], ["Dropped", 18]]);
  // The MVP is still what counted for the viewer's team.
  assert.equal(report.mvp?.playerName, "Starter");
});

test("best and worst add are the week's pickups by what they scored for their team", async () => {
  const report = (await weeklyReport(db, { leagueId: 1, configId }))!;
  // A Saturday-before waiver claim counts for this week; an add on the
  // week's last day belongs to next week's report; an add with no game is not judged.
  assert.deepEqual([report.bestAdd?.playerName, report.bestAdd?.points, report.bestAdd?.ownedBy], ["Pickup", 12, "Beta"]);
  assert.deepEqual([report.worstAdd?.playerName, report.worstAdd?.points, report.worstAdd?.ownedBy], ["Dud", 2, "Alpha"]);
});

test("over- and underperformer compare a team's counted games with their tip-off projections", async () => {
  const report = (await weeklyReport(db, { leagueId: 1, configId }))!;
  assert.deepEqual([report.overperformer?.name, report.overperformer?.projected, report.overperformer?.actual, report.overperformer?.diff],
    ["Alpha", 40, 42, 2]);
  assert.deepEqual([report.underperformer?.name, report.underperformer?.projected, report.underperformer?.actual, report.underperformer?.diff],
    ["Beta", 90, 67, -23]);
});

test("weeklyReport is null before any week settles", async () => {
  assert.equal(await weeklyReport(db, { leagueId: 999, configId }), null);
});
