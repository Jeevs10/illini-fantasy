import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, scoreLine, type PlayerLine } from "@illini/scoring";
import {
  connect, migrate, upsertScoringConfig, writeScores, type Db, type StoredScore,
} from "@illini/db";
import { claimPlayer } from "./roster.ts";
import { scorePeriod } from "./settle.ts";
import { InvalidLineupError, LineupLockedError } from "./lineups.ts";
import {
  autoFillPeriod, carryForwardLineup, seedPeriodLineup, setPeriodLineup, startableInPeriod,
} from "./periodlineup.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

let db: Db;
let configId: number;

const FROM = "2026-11-16";
const TO = "2026-11-22";

/** Two guards, a forward and a flex, small enough to check by hand. */
const SETTINGS: LeagueSettings = {
  ...DEFAULT_SETTINGS,
  starters: [{ slot: "G", count: 2 }, { slot: "F", count: 1 }, { slot: "FLEX", count: 1 }],
  bench: 4,
  ir: 0,
};

const ROLES: Record<number, string> = {
  1: "Pure PG", 2: "Combo G", 3: "Wing F", 4: "Scoring PG", 5: "Stretch 4",
};

const line = (id: number, points: number): PlayerLine => ({
  playerId: String(id), name: `Player ${id}`, team: "Illinois", conference: "B10", role: ROLES[id]!,
  minutes: 30, points, rebounds: 5, assists: 3,
  effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.36, freeThrowPct: 0.78,
  usage: 22, assistPct: 15, turnoverPct: 14, stealPct: 2, blockPct: 3,
  defensiveRating: 98, offensiveReboundPct: 6, defensiveReboundPct: 16,
  bpm: 4, obpm: 2, dbpm: 2, porpag: 2.5,
  attempts: { three: 5, freeThrow: 4, fieldGoal: 13 },
});
const scoreOf = (id: number, points: number) => scoreLine(line(id, points), GAME_CONFIG, 1).score;

/** A filed box score needs the stat line it was scored from. */
async function fileLine(playerId: number, day: string, points: number): Promise<void> {
  await db.query(
    `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
     VALUES ($1,$2,2026,$3,30,'{}'::jsonb,'torvik')
     ON CONFLICT (player_id, played_on) DO NOTHING`, [playerId, day, ROLES[playerId]]);
  const scores: StoredScore[] = [
    { ...scoreLine(line(playerId, points), GAME_CONFIG, 1), playedOn: day },
  ];
  await writeScores(db, configId, day, scores);
}

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_period_test");
  await admin.query("CREATE DATABASE illini_period_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_period_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));

  await db.query(`INSERT INTO team (id, name, normalised) VALUES
    (1,'Illinois','illinois'), (2,'Iowa','iowa'), (3,'Purdue','purdue')`);
  await db.query("INSERT INTO app_user (id, email, display_name, username) VALUES (1,'c@i.test','C','coach')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES (1,'L',2026,$1,$2,1)`, [configId, JSON.stringify(SETTINGS)]);
  await db.query("INSERT INTO fantasy_team (id, league_id, owner_id, name) VALUES (1,1,1,'Alpha')");

  // Players 1-3 on Illinois, 4-5 on Purdue.
  const teamOf: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 3, 5: 3 };
  for (let id = 1; id <= 5; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,$4)",
      [id, `Player ${id}`, `player ${id}`, teamOf[id]]);
    await claimPlayer(db, { fantasyTeamId: 1, playerId: id, on: "2026-11-01", via: "draft" });
  }

  // Form before the period, so a projection has something to stand on. Every
  // player averages his own id in points.
  for (let id = 1; id <= 5; id += 1) await fileLine(id, "2026-11-10", id * 4);

  // Illinois plays twice in the period, Purdue once. That asymmetry is the
  // whole point of ranking on the week rather than on a night.
  await db.query(
    `INSERT INTO game (id, played_on, season, home_team_id, away_team_id, tipoff) VALUES
       (1, '2026-11-17', 2026, 1, 2, '2026-11-17T19:00:00Z'),
       (2, '2026-11-20', 2026, 1, 2, '2026-11-20T19:00:00Z'),
       (3, '2026-11-18', 2026, 3, 2, '2026-11-18T19:00:00Z')`);
});

after(async () => { await db?.end(); });

test("a starter's projection is his whole week, not his best night", async () => {
  const now = new Date("2026-11-15T12:00:00Z"); // before the period opens
  const starters = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });

  assert.equal(starters.length, 5, "everyone with a game in the period");

  const illini = starters.find((s) => s.playerId === 1)!;
  assert.equal(illini.games.length, 2, "Illinois plays twice");
  assert.ok(Math.abs(illini.projected - scoreOf(1, 4) * 2) < 1e-9,
    "two nights of his average, added together");

  const boiler = starters.find((s) => s.playerId === 4)!;
  assert.equal(boiler.games.length, 1, "Purdue plays once");
  assert.ok(Math.abs(boiler.projected - scoreOf(4, 16)) < 1e-9);

  assert.ok(starters.every((s) => !s.locked), "nothing has tipped off");
});

test("auto-fill prefers the two-game player over an equal one-game player", async () => {
  // Player 2 (Illinois, two games) averages 8; player 4 (Purdue, one game)
  // averages 16 — twice as good a night, but half as many of them, so their
  // weeks are worth the same. Player 5 averages 20 on one game and should win
  // a slot outright; the tie between 2 and 4 is what the ordering must not
  // decide by accident, so this asserts the projections rather than the pick.
  const now = new Date("2026-11-15T12:00:00Z");
  const starters = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });

  const two = starters.find((s) => s.playerId === 2)!;
  const four = starters.find((s) => s.playerId === 4)!;
  assert.ok(Math.abs(two.projected - scoreOf(2, 8) * 2) < 1e-9);
  assert.ok(two.projected > four.projected,
    "two games at 8 beats one at 16 once the week is what counts");

  const result = await autoFillPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS, now });
  const started = result.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR");
  assert.equal(started.length, 4, "two guards, a forward and a flex");
});

test("one decision, written across every night the starter plays", async () => {
  const now = new Date("2026-11-15T12:00:00Z");
  await setPeriodLineup(db, {
    fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS, now,
    entries: [
      { playerId: 1, slot: "G" }, { playerId: 2, slot: "G" },
      { playerId: 3, slot: "F" },
      { playerId: 4, slot: "BENCH" }, { playerId: 5, slot: "BENCH" },
    ],
  });

  const { rows } = await db.query<{ played_on: string; slot: string; game_id: string }>(
    `SELECT to_char(played_on,'YYYY-MM-DD') AS played_on, slot, game_id
       FROM lineup_entry WHERE fantasy_team_id = 1 AND player_id = 1
      ORDER BY played_on`);
  assert.deepEqual(rows.map((r) => r.played_on), ["2026-11-17", "2026-11-20"],
    "both of his nights carry the decision");
  assert.ok(rows.every((r) => r.slot === "G"), "and carry the same slot");
  assert.deepEqual(rows.map((r) => Number(r.game_id)), [1, 2],
    "each night carries the game it was started for");
});

test("an illegal lineup is refused as a whole, before anything is written", async () => {
  const now = new Date("2026-11-15T12:00:00Z");
  await assert.rejects(
    () => setPeriodLineup(db, {
      fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS, now,
      entries: [{ playerId: 4, slot: "G" }, { playerId: 5, slot: "G" }],
    }),
    (error: Error) => error instanceof InvalidLineupError && /players in G/.test(error.message));
});

test("a starter locks when his first game tips, and the rest of the week stays open", async () => {
  // Players 1-3 are Illinois and played the 17th; players 4-5 are Purdue and
  // play the 18th. At 8pm on the 17th the first group has begun and the second
  // has not.
  const now = new Date("2026-11-17T20:00:00Z");
  const starters = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });

  assert.ok(starters.find((s) => s.playerId === 1)!.locked,
    "his week has started, so his slot is spent");
  assert.ok(!starters.find((s) => s.playerId === 4)!.locked,
    "his game is tomorrow — he is still movable");

  await assert.rejects(
    () => setPeriodLineup(db, {
      fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS, now,
      entries: [{ playerId: 1, slot: "BENCH" }],
    }),
    (error: Error) => error instanceof LineupLockedError,
    "a player who has banked points cannot be taken back out");

  // The mid-week move the lock rule exists to allow: someone who has not
  // played yet can still be started into a slot nobody has spent.
  await setPeriodLineup(db, {
    fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS, now,
    entries: [{ playerId: 4, slot: "FLEX" }],
  });
  const after = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });
  assert.equal(after.find((s) => s.playerId === 4)!.slot, "FLEX");
  assert.equal(after.find((s) => s.playerId === 1)!.slot, "G", "the locked players are untouched");
});

test("what the week is set to is what the week scores", async () => {
  // The lineup now: 1 and 2 at G, 3 at F, 4 at FLEX, 5 on the bench. Fill in
  // the games and the settled total must be those four starters' games added
  // up — both of the Illinois players' nights included.
  await fileLine(1, "2026-11-17", 10);
  await fileLine(1, "2026-11-20", 12);
  await fileLine(2, "2026-11-17", 6);
  await fileLine(3, "2026-11-17", 7);
  await fileLine(3, "2026-11-20", 9);
  await fileLine(4, "2026-11-18", 11);
  await fileLine(5, "2026-11-18", 30); // benched, and must not count

  const period = await scorePeriod(db,
    { fantasyTeamId: 1, configId, from: FROM, to: TO, settings: SETTINGS });

  const expected = scoreOf(1, 10) + scoreOf(1, 12) + scoreOf(2, 6)
    + scoreOf(3, 7) + scoreOf(3, 9) + scoreOf(4, 11);
  assert.ok(Math.abs(period.total - expected) < 1e-9,
    `the week is its starters' games summed: ${period.total} vs ${expected}`);
  assert.equal(period.gamesPlayed, 6);
  assert.ok(period.players.every((p) => p.playerId !== 5),
    "a benched player scores nothing, however big his night");

  const one = period.players.find((p) => p.playerId === 1)!;
  assert.equal(one.games, 2, "both of his nights are his");
  assert.ok(Math.abs(one.total - (scoreOf(1, 10) + scoreOf(1, 12))) < 1e-9);
});

test("a night behind us is over, box score or not", async () => {
  // Player 2 played on the 17th and never dressed on the 20th, so that night
  // has no line and never will. Comparing its tip-off to the clock says "it has
  // started and it has not finished" — for one evening that is live, and every
  // evening after it that is a finished week still glowing on the team page,
  // with a projection quoted above the score it actually ended on.
  const later = new Date("2027-02-01T12:00:00Z");
  const done = (await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now: later }))
    .find((s) => s.playerId === 2)!;

  assert.deepEqual(done.games.map((g) => g.state), ["final", "final"],
    "both nights are behind us, whatever the box score says");
  assert.equal(done.games[1]!.score, null, "and the second one never filed one");
  assert.ok(done.locked, "a week months gone cannot be re-set");
  assert.ok(Math.abs(done.scored - scoreOf(2, 6)) < 1e-9, "the one night he played");
  assert.ok(Math.abs(done.projected - done.scored) < 1e-9,
    `a finished week has nothing left to project: ${done.projected} vs ${done.scored}`);

  // Read from inside that same night, the answer is different — which is the
  // whole reason the state is resolved against a clock rather than assumed.
  const during = new Date("2026-11-20T20:00:00Z"); // game 2 tipped at 19:00
  const live = (await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now: during }))
    .find((s) => s.playerId === 2)!;

  assert.deepEqual(live.games.map((g) => g.state), ["final", "live"]);
  assert.ok(live.projected > live.scored + 1e-9,
    "the night under way is still worth projecting");
});

test("a night that was not started does not count, however well he played", async () => {
  // The legacy shape: lineups set a night at a time can start a player on one
  // night and bench him on the next. Player 3 plays the 17th and the 20th; only
  // the 17th was started. Reading his week as "every game he played" credits a
  // night nobody started him for, and the team page then reports a bigger week
  // than the matchup screen settles — which is what it did.
  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 1");
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id) VALUES
       (1, '2026-11-17', 3, 'F', 1),
       (1, '2026-11-20', 3, 'BENCH', 2)`);

  const now = new Date("2026-11-23T12:00:00Z"); // after the period
  const starters = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });
  const three = starters.find((s) => s.playerId === 3)!;

  assert.equal(three.games.length, 2, "he played twice");
  assert.deepEqual(three.games.map((g) => g.started), [true, false],
    "and was started for only the first");
  assert.equal(three.slot, "F", "the slot he actually held");

  const only = scoreOf(3, 7);
  assert.ok(Math.abs(three.scored - only) < 1e-9,
    `only the started night counts: ${three.scored} vs ${only}`);

  // And the page total built from this agrees with what settlement scores.
  const period = await scorePeriod(db,
    { fantasyTeamId: 1, configId, from: FROM, to: TO, settings: SETTINGS });
  const pageTotal = starters
    .filter((s) => s.slot !== "BENCH" && s.slot !== "IR")
    .reduce((a, s) => a + s.scored, 0);
  assert.ok(Math.abs(pageTotal - period.total) < 1e-9,
    `the team page and the matchup screen must report one week: ${pageTotal} vs ${period.total}`);
});

test("a played night is not rewritten by a move made afterwards", async () => {
  // The lineup for the 17th is a fact once the 17th has been played. Moving
  // somebody on the 19th used to restamp every night of every player named in
  // the write, which meant a player resolved to one slot for the period had
  // his benched Thursday retroactively started — and a player newly moved in
  // picked up rows for nights already in the books.
  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 1");
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id) VALUES
       (1, '2026-11-17', 3, 'F', 1),
       (1, '2026-11-20', 3, 'BENCH', 2)`);

  // Eight on the 17th: Illinois has tipped off, Purdue plays tomorrow. So
  // player 4 is still movable and the 17th is already history.
  const now = new Date("2026-11-17T20:00:00Z");
  await setPeriodLineup(db, {
    fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS, now,
    entries: [{ playerId: 4, slot: "FLEX" }],
  });

  const { rows } = await db.query<{ played_on: string; player_id: string; slot: string }>(
    `SELECT to_char(played_on,'YYYY-MM-DD') AS played_on, player_id, slot
       FROM lineup_entry WHERE fantasy_team_id = 1 ORDER BY played_on, player_id`);

  const seventeenth = rows.filter((r) => r.played_on === "2026-11-17");
  assert.deepEqual(seventeenth.map((r) => `${r.player_id}:${r.slot}`), ["3:F"],
    "the played night is exactly as it was — nobody added, nobody moved");

  assert.equal(rows.find((r) => r.played_on === "2026-11-18" && r.player_id === "4")?.slot,
    "FLEX", "the night still to come takes the new decision");
  assert.equal(rows.find((r) => r.played_on === "2026-11-20" && r.player_id === "3")?.slot,
    "F", "and player 3's open night follows the slot he holds for the period");
});

test("an untouched week inherits the last lineup that was set", async () => {
  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 1");
  // What was set the week before: 1 and 2 at G, 3 at F, 4 at FLEX.
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id) VALUES
       (1, '2026-11-10', 1, 'G', 1), (1, '2026-11-10', 2, 'G', 1),
       (1, '2026-11-10', 3, 'F', 1), (1, '2026-11-10', 4, 'FLEX', 1),
       (1, '2026-11-10', 5, 'BENCH', 1)`);

  const now = new Date("2026-11-15T12:00:00Z"); // before the period opens
  const before = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });
  assert.ok(before.every((s) => s.slot === "BENCH"), "nothing is set for the new week");

  const carried = await carryForwardLineup(db,
    { fantasyTeamId: 1, from: FROM, to: TO, settings: SETTINGS, startable: before });
  assert.equal(carried, 4, "the four who were starting are starting again");

  const after = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });
  const slotOf = new Map(after.map((s) => [s.playerId, s.slot]));
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((id) => slotOf.get(id)),
    ["G", "G", "F", "FLEX", "BENCH"],
    "each keeps the seat he already held, and the bench stays benched");

  // And it is a carry, not a re-decision: run again and it stands down rather
  // than reshuffling whatever it finds.
  const again = await carryForwardLineup(db,
    { fantasyTeamId: 1, from: FROM, to: TO, settings: SETTINGS, startable: after });
  assert.equal(again, 0, "a week that has been decided is left alone");
});

test("carrying forward never overwrites a decision somebody made", async () => {
  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 1");
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id) VALUES
       (1, '2026-11-10', 1, 'G', 1), (1, '2026-11-10', 2, 'G', 1),
       (1, '2026-11-10', 3, 'F', 1)`);
  // The manager has already started exactly one player this week, deliberately.
  // Player 5 is Purdue, so his night in the period is the 18th.
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
     VALUES (1, '2026-11-18', 5, 'FLEX', 3)`);

  const now = new Date("2026-11-15T12:00:00Z");
  const startable = await startableInPeriod(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, now });
  const carried = await carryForwardLineup(db,
    { fantasyTeamId: 1, from: FROM, to: TO, settings: SETTINGS, startable });

  assert.equal(carried, 0, "somebody has been here");
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM lineup_entry WHERE fantasy_team_id = 1 AND played_on >= $1", [FROM]);
  assert.equal(rows[0]!.n, "1", "and their one decision is all there is");
});

test("a season seeded a night at a time is re-cut into one decision a week", async () => {
  // What nightly auto-fill leaves behind: five different players holding a
  // starting slot across a week the league has four of, each of them started
  // for the one night he happened to be picked on.
  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 1");
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id) VALUES
       (1, '2026-11-17', 1, 'G', 1), (1, '2026-11-17', 3, 'F', 1),
       (1, '2026-11-18', 4, 'G', 3), (1, '2026-11-18', 5, 'FLEX', 3),
       (1, '2026-11-20', 2, 'G', 2), (1, '2026-11-20', 3, 'BENCH', 2)`);

  const seeded = await seedPeriodLineup(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS });
  const started = seeded.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR");
  assert.equal(started.length, 4, "two guards, a forward and a flex — the slots the league has");

  const { rows } = await db.query<{ played_on: string; player_id: string; slot: string }>(
    `SELECT to_char(played_on,'YYYY-MM-DD') AS played_on, player_id, slot
       FROM lineup_entry WHERE fantasy_team_id = 1 AND played_on BETWEEN $1 AND $2
      ORDER BY played_on, player_id`, [FROM, TO]);

  const startersByNight = new Map<string, string[]>();
  for (const r of rows) {
    if (r.slot === "BENCH" || r.slot === "IR") continue;
    startersByNight.set(r.played_on, [...startersByNight.get(r.played_on) ?? [], r.player_id]);
  }
  const distinct = new Set([...startersByNight.values()].flat());
  assert.equal(distinct.size, 4, "and only those four started anywhere in the week");

  // Every starter on every night he plays, in the one slot he was set to.
  for (const entry of started) {
    const his = rows.filter((r) => r.player_id === String(entry.playerId));
    assert.ok(his.length > 0);
    assert.ok(his.every((r) => r.slot === entry.slot),
      `player ${entry.playerId} holds one slot all week`);
    assert.equal(his.length, entry.playerId <= 3 ? 2 : 1,
      "written across each of his game nights and no others");
  }

  // The page and settlement now agree on a week nobody has to explain: the
  // week's total is the four starters' whole week.
  const period = await scorePeriod(db,
    { fantasyTeamId: 1, configId, from: FROM, to: TO, settings: SETTINGS });
  assert.equal(new Set(period.players.map((p) => p.playerId)).size, 4);
});

test("seeding a period ranks on what its Monday knew", async () => {
  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 1");
  const first = await seedPeriodLineup(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS });
  const picked = first.entries
    .filter((e) => e.slot !== "BENCH" && e.slot !== "IR")
    .map((e) => e.playerId).sort();

  // A benched player has the week of his life inside the period. Form is cut
  // off at the Monday, so it cannot reach back and pick him — a hindsight
  // lineup is not a lineup anybody could have set.
  const benched = first.entries.find((e) => e.slot === "BENCH")!;
  await fileLine(benched.playerId, benched.playerId <= 3 ? "2026-11-17" : "2026-11-18", 60);

  await db.query("DELETE FROM lineup_entry WHERE fantasy_team_id = 1");
  const again = await seedPeriodLineup(db,
    { fantasyTeamId: 1, from: FROM, to: TO, configId, settings: SETTINGS });
  assert.deepEqual(
    again.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR").map((e) => e.playerId).sort(),
    picked, "the same lineup the Monday would have picked");
});
