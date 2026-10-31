import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, migrate, type Db } from "@illini/db";
import { forwardConfigId, ingestForwardFeed, type ForwardFeed, type ForwardLine } from "@illini/ingest";
import { scorePeriod, settleWeek } from "./settle.ts";
import { generateSchedule } from "./schedule.ts";
import { EVERYONE_SETTINGS, type LeagueSettings } from "./slots.ts";
import { AddLimitError, PlaysTonightError, addFreeAgent, addWindow, dropPlayer, weeklyAdds } from "./waivers.ts";
import { claimPlayer, rosterOn, RosterFullError } from "./roster.ts";
import { activateFromReserve, moveToReserve, NotInjuredError } from "./reserve.ts";
import { NoLineupError } from "./lineups.ts";
import { setPeriodLineup } from "./periodlineup.ts";
import { playerPool } from "./roster.ts";
import { weekRoster } from "./weekroster.ts";
import { playerWeekProjection } from "./leaders.ts";
import { NotYourTeamError, renameTeam, TeamNameTaken } from "./teamname.ts";

/**
 * The 2026-27 league end to end, on a two-team, two-seat miniature of it:
 * forward-feed scores, every rostered player counting, a game counting for
 * whoever held the player at its tip-off, and three adds a week.
 *
 *   week 1  Sun Nov 1 - Sat Nov 7      week 2  Sun Nov 8 - Sat Nov 14
 */

const URL = "postgresql://postgres:dev@localhost:55432/illini_everyone_test";
let db: Db;
let configId: number;
const settings: LeagueSettings = { ...EVERYONE_SETTINGS, starters: [{ slot: "FLEX", count: 2 }] };
const pid = new Map<string, number>();

const teams = [[1, "Illinois", "illinois", 1], [2, "Purdue", "purdue", 2],
               [3, "Iowa", "iowa", 3], [4, "Indiana", "indiana", 4]] as const;
// cbbd id, date, tip-off, home cbbd team, away cbbd team
const games = [
  [100, "2026-11-02", "2026-11-03T00:00:00Z", 1, 2],
  [101, "2026-11-02", "2026-11-03T01:00:00Z", 3, 4],
  [102, "2026-11-05", "2026-11-06T00:00:00Z", 1, 3],
  [103, "2026-11-09", "2026-11-10T00:00:00Z", 2, 4],
  [104, "2026-11-10", "2026-11-11T00:00:00Z", 1, 4],
] as const;
// key, name, cbbd team, position, projection
const players = [
  ["1", "Ill One", 1, "G", 80], ["2", "Ill Two", 1, "F", 50],
  ["3", "Pur One", 2, "G", 70], ["4", "Pur Two", 2, "C", 40],
  ["5", "Iowa One", 3, "F", 75], ["6", "Iowa Two", 3, "G", 45],
  ["7", "Ind One", 4, "C", 65], ["8", "Ind Two", 4, "F", 30],
] as const;

const line = (gameId: number, key: string, valAdj: number): ForwardLine => {
  const p = players.find((x) => x[0] === key)!;
  return {
    gameId, date: "", key, name: p[1], slug: null, cbbdTeamId: p[2], valAdj, val: valAdj - 0.5, gs: 10, oppDef: 1,
    min: 30, pts: 12, reb: 5, orb: 1, drb: 4, ast: 3, stl: 1, blk: 0, tov: 2, pf: 2,
    fgm: 5, fga: 10, tpm: 1, tpa: 3, ftm: 1, fta: 2,
  };
};

const feed = (asof: string, lines: ForwardLine[]): ForwardFeed => ({
  season: 2027, asof, since: asof, generated: `${asof}T12:00:00Z`,
  players: players.map(([key, name, cbbd, pos, score]) => ({
    key, name, slug: name.split(" ")[0]!.toLowerCase(), team: name.split(" ")[0]!, cbbdTeamId: cbbd,
    pos, yr: "Jr", ht: "6-5", status: "returner", score, scoreLo: null, scoreHi: null, mpg: 30,
    valueRank: null, espn: null,
  })),
  lines,
});

const at = (iso: string) => new Date(iso);

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_everyone_test");
  await admin.query("CREATE DATABASE illini_everyone_test");
  await admin.end();
  db = connect(URL);
  await migrate(db);

  for (const [id, name, normalised, cbbd] of teams) {
    await db.query("INSERT INTO team (id, name, normalised, cbbd_id) VALUES ($1,$2,$3,$4)", [id, name, normalised, cbbd]);
  }
  await db.query("SELECT setval('team_id_seq', 100)");
  for (const [cbbd, day, tip, home, away] of games) {
    await db.query(
      `INSERT INTO game (played_on, season, home_team_id, away_team_id, cbbd_id, tipoff)
       VALUES ($1, 2027, $2, $3, $4, $5)`, [day, home, away, cbbd, tip]);
  }
  configId = await forwardConfigId(db);
  // The preseason feed: players and projections, no lines yet.
  const r = await ingestForwardFeed(db, feed("2026-10-30", []));
  assert.equal(r.created, 8);
  for (const { source_id, player_id } of (await db.query<{ source_id: string; player_id: string }>(
    "SELECT source_id, player_id FROM player_source_id WHERE source = 'forward'")).rows) {
    pid.set(source_id, Number(player_id));
  }

  await db.query("INSERT INTO app_user (id, email, display_name, username) VALUES (1,'a@b.c','A','abc')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id) VALUES (1,'L',2027,$1,$2,1)`,
    [configId, JSON.stringify(settings)]);
  for (const t of [1, 2]) {
    await db.query("INSERT INTO fantasy_team (id, league_id, owner_id, name, waiver_priority) VALUES ($1,1,1,$2,$3)",
      [t, `Team ${t}`, t]);
  }
  await generateSchedule(db, 1, "2026-11-01", 2);
  await db.query(
    `INSERT INTO draft (league_id, rounds, pick_seconds, status, opens_on, completed_at)
     VALUES (1, 2, 0, 'complete', '2026-10-31', '2026-10-31T20:00:00Z')`);

  // Draft night, Saturday: before the first lock.
  const draftNight = at("2026-10-31T20:00:00Z");
  for (const [team, key] of [[1, "1"], [1, "3"], [2, "5"], [2, "7"]] as const) {
    await claimPlayer(db, { fantasyTeamId: team, playerId: pid.get(key)!, on: "2026-10-31", via: "draft", settings, at: draftNight });
  }
});

after(async () => { await db?.end(); });

test("the pool and the draft rank by projection before anyone has played", async () => {
  const pool = await playerPool(db, { leagueId: 1, season: 2027, configId, sort: "proj" });
  assert.deepEqual(pool.map((p) => p.name), ["Ill One", "Iowa One", "Pur One", "Ind One", "Ill Two", "Iowa Two", "Pur Two", "Ind Two"]);
  assert.equal(pool[0]!.projected, 80);
  assert.equal(pool[0]!.games, 0);
  assert.equal(pool[0]!.role, "G");
  const free = await playerPool(db, { leagueId: 1, season: 2027, configId, sort: "proj", availableOnly: true, roles: ["B"] });
  assert.deepEqual(free.map((p) => p.name), ["Pur Two"]);
});

test("there is no lineup to set", async () => {
  await assert.rejects(setPeriodLineup(db, {
    fantasyTeamId: 1, from: "2026-11-01", to: "2026-11-07", entries: [], configId, settings,
  }), (e: Error) => e instanceof NoLineupError);
});

test("adds are counted from one Sunday 09:00 UTC lock to the next", () => {
  const w = (iso: string) => {
    const { from, to } = addWindow(at(iso), "2026-11-01", settings);
    return [from.toISOString(), to.toISOString()];
  };
  assert.deepEqual(w("2026-11-03T15:00:00Z"), ["2026-11-01T09:00:00.000Z", "2026-11-08T09:00:00.000Z"]);
  assert.deepEqual(w("2026-11-08T08:59:00Z"), ["2026-11-01T09:00:00.000Z", "2026-11-08T09:00:00.000Z"]);
  assert.deepEqual(w("2026-11-08T09:00:00Z"), ["2026-11-08T09:00:00.000Z", "2026-11-15T09:00:00.000Z"]);
  // Draft night is the week before the first one.
  assert.deepEqual(w("2026-10-31T20:00:00Z"), ["2026-10-25T09:00:00.000Z", "2026-11-01T09:00:00.000Z"]);
  // No schedule yet: Sunday.
  assert.equal(addWindow(at("2026-11-04T12:00:00Z"), null, settings).from.toISOString(), "2026-11-01T09:00:00.000Z");
});

test("a dropped player keeps what he scored, and his replacement counts from his next game", async () => {
  // Tuesday of week 1: team 1 drops Pur One (who played Monday) and adds Ill Two.
  const dropped = await dropPlayer(db, { leagueId: 1, fantasyTeamId: 1, playerId: pid.get("3")!, now: at("2026-11-03T15:00:00Z") });
  assert.equal(dropped.clearsAt, null, "no waivers: he is a free agent at once");
  await addFreeAgent(db, { leagueId: 1, fantasyTeamId: 1, playerId: pid.get("2")!, now: at("2026-11-03T15:05:00Z") });

  // Week 1 and 2's lines arrive over two mornings; the second resends Monday's
  // with a different value, which must not replace the first.
  await ingestForwardFeed(db, feed("2026-11-03", [
    line(100, "1", 5), line(100, "3", 2), line(101, "5", 4), line(101, "7", 1),
  ]));
  const r = await ingestForwardFeed(db, feed("2026-11-11", [
    line(100, "1", 99), line(102, "1", 3), line(102, "2", 7), line(102, "5", -1),
    line(103, "3", 4), line(103, "7", 5), line(104, "1", 1), line(104, "2", 2), line(104, "8", 3),
  ]));
  assert.equal(r.written, 8, "the resent Monday line was written again");
  assert.equal(r.unscheduled, 0);

  const w1 = await scorePeriod(db, { fantasyTeamId: 1, configId, from: "2026-11-01", to: "2026-11-07", settings });
  // Ill One 5 + 3, Pur One's Monday 2 kept, Ill Two's Thursday 7.
  assert.equal(w1.total, 17);
  assert.deepEqual(w1.players.map((p) => [p.playerName, p.total]).sort(),
    [["Ill One", 8], ["Ill Two", 7], ["Pur One", 2]]);

  const w2 = await scorePeriod(db, { fantasyTeamId: 1, configId, from: "2026-11-08", to: "2026-11-14", settings });
  assert.equal(w2.total, 3, "week 2 is Ill One 1 + Ill Two 2, and nothing of Pur One");
});

test("a player cannot be dropped on a night his school plays, until the next morning", async () => {
  // Thursday the 5th: Iowa plays Illinois tonight. Before tip-off and after it
  // (11pm Eastern is 04:00 UTC on the 6th), Iowa One stays.
  for (const when of ["2026-11-05T12:00:00Z", "2026-11-06T04:00:00Z"]) {
    await assert.rejects(addFreeAgent(db, {
      leagueId: 1, fantasyTeamId: 2, playerId: pid.get("3")!, dropPlayerId: pid.get("5")!, now: at(when),
    }), (e: Error) => e instanceof PlaysTonightError && e.playedOn === "2026-11-05");
  }
  await assert.rejects(dropPlayer(db, { leagueId: 1, fantasyTeamId: 2, playerId: pid.get("5")!, now: at("2026-11-05T12:00:00Z") }),
    (e: Error) => e instanceof PlaysTonightError);

  // Friday morning he can go, and Pur One, dropped by team 1, is simply added.
  await addFreeAgent(db, {
    leagueId: 1, fantasyTeamId: 2, playerId: pid.get("3")!, dropPlayerId: pid.get("5")!, now: at("2026-11-06T12:00:00Z"),
  });

  const w1 = await scorePeriod(db, { fantasyTeamId: 2, configId, from: "2026-11-01", to: "2026-11-07", settings });
  assert.equal(w1.total, 4 + 1 + -1, "week 1 is Iowa One 4 and -1 (Thursday, still held), Ind One 1");
  const w2 = await scorePeriod(db, { fantasyTeamId: 2, configId, from: "2026-11-08", to: "2026-11-14", settings });
  assert.equal(w2.total, 4 + 5, "week 2 is Pur One 4 and Ind One 5");

  const settled = await settleWeek(db, 1, 2);
  assert.equal(settled.length, 1);
  assert.deepEqual([settled[0]!.home.total, settled[0]!.away.total].sort(), [3, 9]);
});

test("a team gets three adds a week, and the count starts again at Sunday's lock", async () => {
  // Team 1 has used one (Ill Two, Tuesday). Friday, with nobody playing, two more.
  await addFreeAgent(db, { leagueId: 1, fantasyTeamId: 1, playerId: pid.get("4")!, dropPlayerId: pid.get("2")!, now: at("2026-11-06T13:00:00Z") });
  await addFreeAgent(db, { leagueId: 1, fantasyTeamId: 1, playerId: pid.get("2")!, dropPlayerId: pid.get("4")!, now: at("2026-11-06T14:00:00Z") });
  assert.deepEqual(await weeklyAdds(db, { leagueId: 1, fantasyTeamId: 1, now: at("2026-11-06T14:30:00Z") }),
    { used: 3, limit: 3, resetsAt: "2026-11-08T09:00:00.000Z" });

  await assert.rejects(addFreeAgent(db, {
    leagueId: 1, fantasyTeamId: 1, playerId: pid.get("6")!, dropPlayerId: pid.get("2")!, now: at("2026-11-06T15:00:00Z"),
  }), (e: Error) => e instanceof AddLimitError && e.used === 3);
  assert.deepEqual((await rosterOn(db, 1, "2026-11-06")).map((p) => p.name), ["Ill One", "Ill Two"],
    "the refused add dropped nobody");

  assert.equal((await weeklyAdds(db, { leagueId: 1, fantasyTeamId: 1, now: at("2026-11-08T09:00:00Z") }))!.used, 0);

  // Ill Two's Thursday counted under the tenure he had then; the week is unchanged.
  const w1 = await scorePeriod(db, { fantasyTeamId: 1, configId, from: "2026-11-01", to: "2026-11-07", settings });
  assert.equal(w1.total, 17);
});

test("IR holds a player listed out outside the twelve, at once, and is not an add", async () => {
  const ind = pid.get("7")!;
  await assert.rejects(moveToReserve(db, { fantasyTeamId: 2, playerId: ind, now: at("2026-11-11T12:00:00Z") }),
    (e: Error) => e instanceof NotInjuredError);
  await db.query("INSERT INTO player_availability (player_id, as_of, status) VALUES ($1, '2026-11-11T11:00:00Z', 'out')", [ind]);
  await moveToReserve(db, { fantasyTeamId: 2, playerId: ind, now: at("2026-11-11T12:00:00Z") });

  // His Monday game already counted, and is not reopened.
  const w2 = await scorePeriod(db, { fantasyTeamId: 2, configId, from: "2026-11-08", to: "2026-11-14", settings });
  assert.equal(w2.total, 9);

  // The seat he left is open: a third player fits beside him. Ind Two's
  // Tuesday game tipped before he was added, so it is not team 2's.
  await addFreeAgent(db, { leagueId: 1, fantasyTeamId: 2, playerId: pid.get("8")!, now: at("2026-11-11T13:00:00Z") });
  assert.equal((await scorePeriod(db, { fantasyTeamId: 2, configId, from: "2026-11-08", to: "2026-11-14", settings })).total, 9);
  assert.equal((await weeklyAdds(db, { leagueId: 1, fantasyTeamId: 2, now: at("2026-11-11T13:00:00Z") }))!.used, 1,
    "the IR move was not an add");
  const held = await rosterOn(db, 2, "2026-11-11");
  assert.deepEqual(held.map((p) => [p.name, p.reserve]).sort(),
    [["Ind One", true], ["Ind Two", false], ["Pur One", false]]);

  // And coming back needs a seat among the two.
  await assert.rejects(activateFromReserve(db, { fantasyTeamId: 2, playerId: ind, now: at("2026-11-12T12:00:00Z") }),
    (e: Error) => e instanceof RosterFullError);
});

test("the team page's week counts each game for whoever held him at tip-off", async () => {
  const week = await weekRoster(db, {
    fantasyTeamId: 2, from: "2026-11-08", to: "2026-11-14", configId, season: 2027, settings,
    now: at("2026-11-12T12:00:00Z"), today: "2026-11-12",
  });
  const by = new Map(week.map((p) => [p.name, p]));
  assert.equal(by.get("Pur One")!.counting, true);
  // Put on IR Wednesday: held, not counting from now, Monday's 5 still banked.
  assert.deepEqual([by.get("Ind One")!.counting, by.get("Ind One")!.reserve, by.get("Ind One")!.scored], [false, true, 5]);
  // Picked up Wednesday after his Tuesday game: on the roster, nothing banked.
  assert.equal(by.get("Ind Two")!.counting, true);
  assert.equal(by.get("Ind Two")!.scored, 0);
  assert.equal(by.get("Ind Two")!.games[0]!.counted, false);
  // Dropped the week before: not in this week at all.
  assert.equal(by.has("Iowa One"), false);

  const w1 = await weekRoster(db, {
    fantasyTeamId: 1, from: "2026-11-01", to: "2026-11-07", configId, season: 2027, settings,
    now: at("2026-11-04T12:00:00Z"), today: "2026-11-04",
  });
  const pur = w1.find((p) => p.name === "Pur One")!;
  assert.deepEqual([pur.counting, pur.held, pur.scored], [false, false, 2], "dropped Tuesday, Monday kept");
  const two = w1.find((p) => p.name === "Ill Two")!;
  assert.deepEqual(two.games.map((g) => [g.playedOn, g.counted]), [["2026-11-02", false], ["2026-11-05", true]],
    "added Tuesday: Monday is not his, Thursday is");
  assert.equal(two.counting, true);
  // Thursday's score is the future from Wednesday.
  assert.equal(w1.find((p) => p.name === "Ill One")!.scored, 5);
});

test("a manager renames their own team, and only their own", async () => {
  assert.deepEqual(await renameTeam(db, { fantasyTeamId: 1, byUserId: 1, name: "  The   Orange Krush " }),
    { from: "Team 1", to: "The Orange Krush" });
  const { rows } = await db.query<{ name: string }>("SELECT name FROM fantasy_team WHERE id = 1");
  assert.equal(rows[0]!.name, "The Orange Krush");
  await assert.rejects(renameTeam(db, { fantasyTeamId: 2, byUserId: 99, name: "Mine now" }),
    (e: Error) => e instanceof NotYourTeamError);
  await assert.rejects(renameTeam(db, { fantasyTeamId: 2, byUserId: 1, name: "The Orange Krush" }),
    (e: Error) => e instanceof TeamNameTaken);
  await assert.rejects(renameTeam(db, { fantasyTeamId: 1, byUserId: 1, name: "   " }), /needs a name/);
});

test("a game ahead is projected from the model's number for it, a game played from its score", async () => {
  const f = feed("2026-11-09", []);
  f.projections = [
    { gameId: 104, date: "2026-11-10", key: "1", cbbdTeamId: 1, proj: 3.5, mpg: 30, poss: 70, oppDef: 2 },
    { gameId: 104, date: "2026-11-10", key: "2", cbbdTeamId: 1, proj: 1.25, mpg: 20, poss: 70, oppDef: 2 },
  ];
  const r = await ingestForwardFeed(db, f);
  assert.equal(r.gameProjections, 2);

  // Monday the 9th: Tuesday's game is still ahead.
  const before = await weekRoster(db, {
    fantasyTeamId: 1, from: "2026-11-08", to: "2026-11-14", configId, season: 2027, settings,
    now: at("2026-11-09T12:00:00Z"), today: "2026-11-09",
  });
  const ill = before.find((p) => p.name === "Ill One")!;
  assert.equal(ill.games[0]!.projected, 3.5);
  assert.equal(ill.projectedWeek, 3.5);
  assert.equal(before.reduce((a, p) => a + p.projectedWeek, 0), 4.75);

  // Wednesday: the line (1) has replaced the projection.
  const after = await weekRoster(db, {
    fantasyTeamId: 1, from: "2026-11-08", to: "2026-11-14", configId, season: 2027, settings,
    now: at("2026-11-11T12:00:00Z"), today: "2026-11-11",
  });
  assert.equal(after.find((p) => p.name === "Ill One")!.projectedWeek, 1);

  const week = await playerWeekProjection(db, { playerId: pid.get("2")!, configId, from: "2026-11-08", to: "2026-11-14" });
  assert.deepEqual([week.gamesScheduled, week.projectedTotal], [1, 1.25]);
});

test("a player's season in points is what he has scored plus his projection for the games left", async () => {
  const f = feed("2026-11-12", []);
  for (const p of f.players) { p.restPoints = p.key === "1" ? 40 : 10; p.restGames = 20; }
  await ingestForwardFeed(db, f);
  const pool = await playerPool(db, { leagueId: 1, season: 2027, configId, sort: "season" });
  const ill = pool.find((p) => p.name === "Ill One")!;
  // Ill One scored 5 + 3 + 1 (the resent 99 never replaced Monday's 5).
  assert.equal(ill.totalScore, 9);
  assert.equal(ill.seasonPoints, 49);
  assert.equal(pool[0]!.name, "Ill One");
});

test("the feed's schedule adds a game published after the first load, and its lines then land", async () => {
  const f = feed("2026-11-13", [line(105, "1", 6)]);
  f.games = [{ gameId: 105, start: "2026-11-14T01:00:00.000Z", homeId: 1, awayId: 99,
               homeName: "Illinois", awayName: "Chicago State", neutral: false }];
  const r = await ingestForwardFeed(db, f);
  assert.equal(r.scheduled, 1);
  assert.equal(r.unscheduled, 0, "the line found the game the same feed brought");
  const { rows } = await db.query<{ played_on: string; name: string }>(
    `SELECT to_char(g.played_on, 'YYYY-MM-DD') AS played_on, t.name FROM game g JOIN team t ON t.id = g.away_team_id
      WHERE g.cbbd_id = 105`);
  // 8pm Eastern on the 13th is the 14th in UTC; it is filed under the night it was played.
  assert.deepEqual(rows[0], { played_on: "2026-11-13", name: "Chicago State" });
  // Resending the same schedule changes nothing.
  assert.equal((await ingestForwardFeed(db, f)).scheduled, 0);
});
