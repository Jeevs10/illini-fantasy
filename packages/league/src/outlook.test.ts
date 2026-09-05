import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, scoreLine, type PlayerLine } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, writeScores, type Db, type StoredScore } from "@illini/db";
import { claimPlayer } from "./roster.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";
import { periodOutlook } from "./outlook.ts";

let db: Db;
let configId: number;

// A tiny roster so the games cap never trims anything — every game a
// simulated night starts should show up in the total.
const SETTINGS: LeagueSettings = {
  ...DEFAULT_SETTINGS,
  starters: [{ slot: "G", count: 1 }, { slot: "F", count: 1 }],
  bench: 3,
  ir: 0,
  gamesCap: 20,
};

// Two guards competing for the one G slot (ranked by projected average), one
// forward with the F slot to himself, and a fourth guard — on a different
// real team, so he has a night of his own — who never outscores the frozen
// starter and so should never be projected at all.
const ROLES: Record<number, string> = {
  1: "Scoring PG", 2: "Combo G", 3: "Wing F", 4: "Scoring PG",
};

const line = (id: number, points: number, role: string): PlayerLine => ({
  playerId: String(id), name: `Player ${id}`, team: "Illinois", conference: "B10", role,
  minutes: 30, points, rebounds: 5, assists: 3,
  effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.36, freeThrowPct: 0.78,
  usage: 22, assistPct: 15, turnoverPct: 14, stealPct: 2, blockPct: 3,
  defensiveRating: 98, offensiveReboundPct: 6, defensiveReboundPct: 16,
  bpm: 4, obpm: 2, dbpm: 2, porpag: 2.5,
  attempts: { three: 5, freeThrow: 4, fieldGoal: 13 },
});
const scoreOf = (id: number, points: number) => scoreLine(line(id, points, ROLES[id]!), GAME_CONFIG, 1).score;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_outlook_test");
  await admin.query("CREATE DATABASE illini_outlook_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_outlook_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));

  await db.query(
    `INSERT INTO team (id, name, normalised) VALUES
       (1,'Illinois','illinois'), (2,'Iowa','iowa'), (3,'Purdue','purdue'), (4,'Michigan','michigan')`);
  await db.query("INSERT INTO app_user (id, email, display_name, username) VALUES (1,'c@i.test','C','coach')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES (1,'L',2026,$1,$2,1)`, [configId, JSON.stringify(SETTINGS)]);
  await db.query("INSERT INTO fantasy_team (id, league_id, owner_id, name) VALUES (1,1,1,'Alpha')");

  // Players 1-3 on Illinois; player 4 on Purdue, so he has a game night of
  // his own that the other three do not play.
  const teamOf: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 3 };
  for (let id = 1; id <= 4; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,$4)",
      [id, `Player ${id}`, `player ${id}`, teamOf[id]]);
    await claimPlayer(db, { fantasyTeamId: 1, playerId: id, on: "2026-11-01", via: "draft" });
  }

  // Prior form so a projection has something to rank on. Higher ids score
  // more, except player 4, who is kept well below player 2 so he never
  // displaces him as the roster's G starter.
  const prior = "2026-11-05";
  const points: Record<number, number> = { 1: 9, 2: 10, 3: 11, 4: 1 };
  const scores: StoredScore[] = [];
  for (let id = 1; id <= 4; id += 1) {
    await db.query(
      `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
       VALUES ($1,$2,2026,$3,30,'{}'::jsonb,'torvik')`, [id, prior, ROLES[id]]);
    scores.push({ ...scoreLine(line(id, points[id]!, ROLES[id]!), GAME_CONFIG, 1), playedOn: prior });
  }
  await writeScores(db, configId, prior, scores);

  // A game next week for Illinois (players 1-3) — the week nobody has set a
  // lineup for yet, because the season has not reached it — and a separate
  // game two days later for Purdue alone (player 4), who plays that night
  // with nobody else on this roster.
  await db.query(
    `INSERT INTO game (id, played_on, season, home_team_id, away_team_id, tipoff) VALUES
       (1, '2026-11-16', 2026, 1, 2, '2026-11-16T19:00:00Z'),
       (2, '2026-11-18', 2026, 3, 4, '2026-11-18T19:00:00Z')`);
});

after(async () => { await db?.end(); });

test("a future week with no lineup set still gets a simulated projection", async () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const outlook = await periodOutlook(db, {
    fantasyTeamId: 1, configId, from: "2026-11-16", to: "2026-11-22", settings: SETTINGS, now,
  });

  assert.equal(outlook.gamesPlayed, 0, "nothing has been scored yet");
  assert.equal(outlook.pending.length, 2, "the two starter slots this roster can fill");
  assert.ok(outlook.pending.every((p) => p.playedOn === "2026-11-16"));
  assert.equal(outlook.upcoming, 2);
  assert.equal(outlook.live, 0);

  // Player 1 and 2 both play G; auto-fill ranks by projected average and
  // player 2's is higher, so he starts and player 1 sits — same as the F
  // slot going to player 3, who has it to himself.
  const started = new Set(outlook.pending.map((p) => p.playerId));
  assert.deepEqual(started, new Set([2, 3]));

  const expected = scoreOf(2, 10) + scoreOf(3, 11);
  assert.ok(Math.abs(outlook.projected - expected) < 1e-9,
    `projected should be the simulated starters' average: ${outlook.projected} vs ${expected}`);
});

test("a currently-benched player's own game night is not projected, even though his real team plays", async () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const outlook = await periodOutlook(db, {
    fantasyTeamId: 1, configId, from: "2026-11-16", to: "2026-11-19", settings: SETTINGS, now,
  });

  // Player 4 has a real game on the 18th, and nothing stops his team from
  // playing it — but he lost the roster's one G slot to player 2 on
  // projected average, and a night he does not start is not a night the
  // projection invents for him.
  assert.ok(outlook.pending.every((p) => p.playerId !== 4),
    "the bench player's own game night should not appear");
  assert.ok(outlook.pending.every((p) => p.playedOn !== "2026-11-18"),
    "no games at all should be pulled from the 18th — nobody in the frozen roster plays that night");
  assert.deepEqual(new Set(outlook.pending.map((p) => p.playerId)), new Set([2, 3]),
    "only the current starters — not the wider roster — are projected");
});

test("today's actual decision is the frozen roster, not a re-guess of it", async () => {
  // Illinois plays again on the 20th. If today is left undecided the
  // whole-roster guess would start player 2 (higher average) over player 1 —
  // but a manager has actually started player 1 today instead, and that real
  // decision is what should carry forward to the 20th too.
  await db.query(
    "INSERT INTO game (id, played_on, season, home_team_id, away_team_id, tipoff) VALUES (3, '2026-11-20', 2026, 1, 2, '2026-11-20T19:00:00Z')");
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id) VALUES
       (1, '2026-11-16', 1, 'G', 1), (1, '2026-11-16', 3, 'F', 1), (1, '2026-11-16', 2, 'BENCH', 1)`);

  const now = new Date("2026-11-16T00:00:00Z"); // today, before tip-off
  const outlook = await periodOutlook(db, {
    fantasyTeamId: 1, configId, from: "2026-11-16", to: "2026-11-22", settings: SETTINGS, now,
  });

  assert.deepEqual(new Set(outlook.pending.map((p) => p.playerId)), new Set([1, 3]),
    "player 1's real start today should carry forward, not player 2's higher average");
  assert.ok(outlook.pending.some((p) => p.playerId === 1 && p.playedOn === "2026-11-20"),
    "player 1 should be projected for the 20th too, since he is the actual current starter");
  assert.ok(outlook.pending.every((p) => p.playerId !== 2),
    "player 2 is benched today and should not be guessed back in for a later night");
});

test("a past night nobody ever set a lineup for is not retroactively simulated", async () => {
  const now = new Date("2026-11-23T00:00:00Z"); // after the whole period
  const outlook = await periodOutlook(db, {
    fantasyTeamId: 1, configId, from: "2026-11-16", to: "2026-11-22", settings: SETTINGS, now,
  });

  assert.equal(outlook.pending.length, 0, "a settled gap in the past is not invented after the fact");
  assert.equal(outlook.projected, 0);
});
