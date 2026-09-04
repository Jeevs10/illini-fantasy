import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import {
  BracketExistsError, BracketRefusedError, bracketShape, bracketView, createBracket,
  playoffPicture, settlePlayoffs,
} from "./playoffs.ts";
import { generateSchedule } from "./schedule.ts";
import { standings } from "./settle.ts";
import { rankedStandings } from "./outlook.ts";
import { upsertUser } from "./membership.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

let db: Db;
let configId: number;
let commish: number;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_playoffs_test");
  await admin.query("CREATE DATABASE illini_playoffs_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_playoffs_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));
  ({ id: commish } = await upsertUser(db, { email: "commish@illini.test", displayName: "Commish" }));

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')");
});

after(async () => { await db?.end(); });

// ---------------------------------------------------------------------------
// bracketShape — pure, no database
// ---------------------------------------------------------------------------

test("a 4-team bracket is a single-elimination semi-final pair", () => {
  const shape = bracketShape(4);
  assert.deepEqual(shape.rounds, ["SF", "F"]);
  assert.deepEqual(shape.matches.map((m) => [m.round, m.seq, m.homeSeed, m.awaySeed]), [
    ["SF", 1, 1, 4],
    ["SF", 2, 2, 3],
    ["F", 1, null, null],
  ]);
  const final = shape.matches.find((m) => m.round === "F")!;
  assert.deepEqual(final.homeFrom, { round: "SF", seq: 1, result: "winner" });
  assert.deepEqual(final.awayFrom, { round: "SF", seq: 2, result: "winner" });
});

test("a 6-team bracket seeds 1 and 2 straight into the semis, byes and all", () => {
  const shape = bracketShape(6);
  assert.deepEqual(shape.rounds, ["QF", "SF", "F"]);
  const qf = shape.matches.filter((m) => m.round === "QF");
  assert.deepEqual(qf.map((m) => [m.seq, m.homeSeed, m.awaySeed]), [[1, 4, 5], [2, 3, 6]]);

  const sf = shape.matches.filter((m) => m.round === "SF");
  assert.equal(sf.length, 2);
  assert.deepEqual(sf[0], { round: "SF", seq: 1, homeSeed: 1, awaySeed: null,
    homeFrom: null, awayFrom: { round: "QF", seq: 1, result: "winner" } });
  assert.deepEqual(sf[1], { round: "SF", seq: 2, homeSeed: 2, awaySeed: null,
    homeFrom: null, awayFrom: { round: "QF", seq: 2, result: "winner" } });
});

test("an 8-team bracket keeps 1 and 2 apart until the final", () => {
  const shape = bracketShape(8);
  assert.deepEqual(shape.rounds, ["QF", "SF", "F"]);
  const qf = shape.matches.filter((m) => m.round === "QF");
  assert.deepEqual(qf.map((m) => [m.homeSeed, m.awaySeed]), [[1, 8], [4, 5], [2, 7], [3, 6]]);
  // Seed 1's quarter (QF1) and seed 2's quarter (QF3) feed different semis.
  const sf = shape.matches.filter((m) => m.round === "SF");
  assert.deepEqual(sf[0]!.homeFrom, { round: "QF", seq: 1, result: "winner" });
  assert.deepEqual(sf[0]!.awayFrom, { round: "QF", seq: 2, result: "winner" });
  assert.deepEqual(sf[1]!.homeFrom, { round: "QF", seq: 3, result: "winner" });
  assert.deepEqual(sf[1]!.awayFrom, { round: "QF", seq: 4, result: "winner" });
});

test("third place plays the two semi-final losers, and only when both semis were real", () => {
  const withThird = bracketShape(4, { thirdPlace: true });
  const third = withThird.matches.find((m) => m.round === "3rd");
  assert.deepEqual(third, {
    round: "3rd", seq: 1, homeSeed: null, awaySeed: null,
    homeFrom: { round: "SF", seq: 1, result: "loser" },
    awayFrom: { round: "SF", seq: 2, result: "loser" },
  });

  // 3 teams: seed 1 byes straight to the final, so there is only one real
  // semi-final and nobody for its loser to play.
  const threeTeam = bracketShape(3, { thirdPlace: true });
  assert.equal(threeTeam.matches.some((m) => m.round === "3rd"), false);
});

// ---------------------------------------------------------------------------
// Database fixtures
// ---------------------------------------------------------------------------

/** Ascending team id always wins — a cheap, deterministic regular season. */
async function settleChalk(leagueId: number, week: number, now = new Date()): Promise<void> {
  const { rows } = await db.query<{ id: string; home_team_id: string; away_team_id: string }>(
    "SELECT id, home_team_id, away_team_id FROM matchup WHERE league_id = $1 AND week = $2 AND round IS NULL",
    [leagueId, week]);
  for (const r of rows) {
    const home = Number(r.home_team_id);
    const away = Number(r.away_team_id);
    const [hp, ap] = home < away ? [200 - home, 10] : [10, 200 - away];
    await db.query("UPDATE matchup SET home_points = $2, away_points = $3, settled_at = $4 WHERE id = $1",
      [r.id, hp, ap, now]);
  }
}

/** One dedicated player per team (player id === fantasy team id) scores a day. */
async function playoffScore(teamId: number, day: string, score: number): Promise<void> {
  await db.query(
    `INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,1)
     ON CONFLICT (id) DO NOTHING`,
    [teamId, `Player ${teamId}`, `player ${teamId}`]);
  await db.query(
    `INSERT INTO player_game_stat (player_id, played_on, season, minutes, stats, source)
     VALUES ($1,$2,2026,30,'{}'::jsonb,'torvik')`,
    [teamId, day]);
  await db.query(
    `INSERT INTO player_game_score
       (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
     VALUES ($1,$2,$3,'wing','{}'::jsonb,0,1,1,$4)`,
    [teamId, day, configId, score]);
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot) VALUES ($1,$2,$1,'FLEX')`,
    [teamId, day]);
}

async function makeLeague(
  id: number, teamIds: number[], settings: Partial<LeagueSettings>, weeks = 6,
): Promise<void> {
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES ($1,$2,2026,$3,$4,$5)`,
    [id, `League ${id}`, configId, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }), commish]);
  await db.query(
    "INSERT INTO league_member (league_id, user_id, role) VALUES ($1,$2,'commissioner')", [id, commish]);
  for (const teamId of teamIds) {
    await db.query("INSERT INTO fantasy_team (id, league_id, name) VALUES ($1,$2,$3)",
      [teamId, id, `Team ${teamId}`]);
  }
  await generateSchedule(db, id, "2026-11-02", weeks);
}

// ---------------------------------------------------------------------------
// Creating and settling a bracket
// ---------------------------------------------------------------------------

const LEAGUE1 = 1;
const TEAMS1 = [11, 12, 13, 14, 15, 16];

test("a bracket refuses a league that does not have enough teams for it", async () => {
  await makeLeague(6, [61, 62, 63], {});
  await assert.rejects(
    createBracket(db, { leagueId: 6, by: commish }),
    (error: unknown) => error instanceof BracketRefusedError
      && error.reasons.some((r) => r.includes("3 teams") && r.includes("wants 4")),
  );
});

test("a bracket refuses to start on a week that is already settled", async () => {
  await makeLeague(4, [41, 42, 43, 44], { playoffTeams: 4, playoffStartWeek: 2 }, 3);
  await settleChalk(4, 1);
  await settleChalk(4, 2);
  await assert.rejects(
    createBracket(db, { leagueId: 4, by: commish }),
    (error: unknown) => error instanceof BracketRefusedError
      && error.reasons.some((r) => r.includes("week 2") && r.includes("settled")),
  );
});

test("a league cannot be given a second bracket", async () => {
  await makeLeague(5, [51, 52, 53, 54], { playoffTeams: 4, playoffStartWeek: 2 }, 3);
  await createBracket(db, { leagueId: 5, by: commish });
  await assert.rejects(
    createBracket(db, { leagueId: 5, by: commish }),
    (error: unknown) => error instanceof BracketExistsError,
  );
});

test("the six-team bracket seeds straight off the regular-season table", async () => {
  await makeLeague(LEAGUE1, TEAMS1, { playoffTeams: 6, playoffStartWeek: 2, thirdPlace: true });
  await settleChalk(LEAGUE1, 1); // ascending team id wins => standings rank 11..16

  const table = await standings(db, LEAGUE1);
  assert.deepEqual(table.map((t) => t.fantasyTeamId), TEAMS1);

  const created = await createBracket(db, { leagueId: LEAGUE1, by: commish });
  assert.deepEqual(created.winners.rounds, ["QF", "SF", "F"]);
  assert.equal(created.consolation, null);

  const { rows } = await db.query<{
    round: string; seq: number; week: number; home_team_id: string | null; away_team_id: string | null;
  }>(
    `SELECT round, seq, week, home_team_id, away_team_id FROM matchup
      WHERE league_id = $1 AND round IS NOT NULL ORDER BY week, round, seq`,
    [LEAGUE1]);
  const qf = rows.filter((r) => r.round === "QF");
  // Seed 4 (team 14) vs seed 5 (team 15), seed 3 (13) vs seed 6 (16).
  assert.deepEqual(qf.map((r) => [Number(r.home_team_id), Number(r.away_team_id)]), [[14, 15], [13, 16]]);
  const sf = rows.filter((r) => r.round === "SF");
  // Seeds 1 and 2 (11, 12) are seeded straight in; their opponents are TBD.
  assert.deepEqual(sf.map((r) => [Number(r.home_team_id), r.away_team_id]), [[11, null], [12, null]]);
  assert.equal(rows.every((r) => r.week >= 2 && r.week <= 4), true);
});

test("settling the bracket propagates winners round by round, and re-running it changes nothing", async () => {
  // QF: 2026-11-09..15. Lower id wins throughout, matching the seeding.
  await playoffScore(14, "2026-11-09", 100);
  await playoffScore(15, "2026-11-09", 10);
  await playoffScore(13, "2026-11-09", 100);
  await playoffScore(16, "2026-11-09", 10);

  const afterQF = await settlePlayoffs(db, { leagueId: LEAGUE1, now: new Date("2026-11-16T12:00:00Z") });
  assert.equal(afterQF.length, 2);
  assert.ok(afterQF.every((m) => m.round === "QF" && m.winner === "home"));

  const rerun = await settlePlayoffs(db, { leagueId: LEAGUE1, now: new Date("2026-11-16T12:00:00Z") });
  assert.equal(rerun.length, 0, "an already-settled round must not be re-decided");

  const { rows: sfAfterQF } = await db.query<{ home_team_id: string; away_team_id: string }>(
    "SELECT home_team_id, away_team_id FROM matchup WHERE league_id = $1 AND round = 'SF' ORDER BY seq",
    [LEAGUE1]);
  assert.deepEqual(sfAfterQF.map((r) => [Number(r.home_team_id), Number(r.away_team_id)]), [[11, 14], [12, 13]]);

  // SF: 2026-11-16..22. Chalk again.
  await playoffScore(11, "2026-11-17", 100);
  await playoffScore(14, "2026-11-17", 10);
  await playoffScore(12, "2026-11-17", 100);
  await playoffScore(13, "2026-11-17", 10);

  const afterSF = await settlePlayoffs(db, { leagueId: LEAGUE1, now: new Date("2026-11-23T12:00:00Z") });
  assert.equal(afterSF.filter((m) => m.round === "SF").length, 2);

  const { rows: fAndThird } = await db.query<{
    round: string; bracket: string; home_team_id: string | null; away_team_id: string | null;
  }>(
    "SELECT round, bracket, home_team_id, away_team_id FROM matchup WHERE league_id = $1 AND round IN ('F','3rd')",
    [LEAGUE1]);
  const finalRow = fAndThird.find((r) => r.round === "F")!;
  const thirdRow = fAndThird.find((r) => r.round === "3rd")!;
  assert.equal(finalRow.bracket, "winners");
  // The third-place game is its own bracket value — neither a step toward
  // the championship nor a consolation-pool placement game.
  assert.equal(thirdRow.bracket, "third");
  assert.deepEqual([Number(finalRow.home_team_id), Number(finalRow.away_team_id)], [11, 12]);
  // Third place is the two semi-final losers.
  assert.deepEqual(
    [Number(thirdRow.home_team_id), Number(thirdRow.away_team_id)].sort(),
    [13, 14]);

  // F + 3rd: 2026-11-23..29.
  await playoffScore(11, "2026-11-24", 100);
  await playoffScore(12, "2026-11-24", 10);
  await playoffScore(14, "2026-11-24", 100);
  await playoffScore(13, "2026-11-24", 10);

  const final = await settlePlayoffs(db, { leagueId: LEAGUE1, now: new Date("2026-11-30T12:00:00Z") });
  assert.equal(final.length, 2);
  const champ = final.find((m) => m.round === "F")!;
  assert.equal(champ.homeTeamId === 11 ? champ.winner : null, "home");

  const view = await bracketView(db, { leagueId: LEAGUE1, now: new Date("2026-11-30T12:00:00Z") });
  assert.ok(view);
  assert.equal(view!.hasThird, true);
  assert.ok(view!.matches.every((m) => m.round !== "F" || m.settled));
});

test("a settled playoff round never leaks into the regular-season table", async () => {
  const regular = await standings(db, LEAGUE1);
  // Only week 1 was ever a regular-season result — every playoff game played
  // since must be invisible here.
  for (const row of regular) {
    assert.ok(row.wins + row.losses + row.ties <= 1,
      `team ${row.fantasyTeamId} shows ${row.wins + row.losses + row.ties} regular-season games`);
  }
  const ranked = await rankedStandings(db, LEAGUE1);
  assert.deepEqual(ranked.map((r) => r.fantasyTeamId), TEAMS1);
});

// ---------------------------------------------------------------------------
// Reseeding
// ---------------------------------------------------------------------------

test("reseed pairs the best surviving seed against the worst after an upset", async () => {
  const teams = [21, 22, 23, 24];
  await makeLeague(2, teams, { playoffTeams: 4, playoffStartWeek: 2, reseed: true });
  await settleChalk(2, 1); // standings rank: 21, 22, 23, 24
  await createBracket(db, { leagueId: 2, by: commish });

  // SF1: 21 (seed 1) vs 24 (seed 4) — 24 upsets 21. SF2: 22 (seed 2) vs 23
  // (seed 3) — chalk. Winners are seed 4 and seed 2.
  await playoffScore(24, "2026-11-10", 100);
  await playoffScore(21, "2026-11-10", 10);
  await playoffScore(22, "2026-11-10", 100);
  await playoffScore(23, "2026-11-10", 10);

  await settlePlayoffs(db, { leagueId: 2, now: new Date("2026-11-16T12:00:00Z") });

  const { rows } = await db.query<{ home_team_id: string; home_seed: number; away_team_id: string; away_seed: number }>(
    "SELECT home_team_id, home_seed, away_team_id, away_seed FROM matchup WHERE league_id = 2 AND round = 'F'");
  const final = rows[0]!;
  // Without reseeding the final would be the SF1 winner (24) at home against
  // the SF2 winner (22). Reseeding puts the better surviving seed (22) home
  // instead.
  assert.equal(Number(final.home_team_id), 22);
  assert.equal(final.home_seed, 2);
  assert.equal(Number(final.away_team_id), 24);
  assert.equal(final.away_seed, 4);
});

// ---------------------------------------------------------------------------
// Consolation bracket
// ---------------------------------------------------------------------------

test("a consolation bracket plays the teams that missed the cut, finishing the same week as the final", async () => {
  const teams = [31, 32, 33, 34, 35, 36];
  await makeLeague(3, teams, { playoffTeams: 4, playoffStartWeek: 2, consolation: true });
  await settleChalk(3, 1); // standings rank: 31..36

  const created = await createBracket(db, { leagueId: 3, by: commish });
  assert.ok(created.consolation);
  assert.deepEqual(created.consolation!.rounds, ["F"]);

  const { rows: winnersF } = await db.query<{ week: number }>(
    "SELECT week FROM matchup WHERE league_id = 3 AND round = 'F' AND bracket = 'winners'");
  const { rows: consolationF } = await db.query<{
    week: number; home_team_id: string; away_team_id: string;
  }>(
    "SELECT week, home_team_id, away_team_id FROM matchup WHERE league_id = 3 AND bracket = 'consolation'");
  assert.equal(consolationF.length, 1);
  assert.equal(consolationF[0]!.week, winnersF[0]!.week);
  // Seeds 5 and 6 — the two teams that missed the four-team cut.
  assert.deepEqual([Number(consolationF[0]!.home_team_id), Number(consolationF[0]!.away_team_id)], [35, 36]);
});

// ---------------------------------------------------------------------------
// The playoff picture
// ---------------------------------------------------------------------------

test("the picture separates clinched, alive and eliminated correctly", async () => {
  const teams = [71, 72, 73, 74, 75, 76];
  await makeLeague(7, teams, { playoffTeams: 4 });
  // The whole round robin (5 rounds for 6 teams) settled — one week left.
  for (let week = 1; week <= 5; week += 1) await settleChalk(7, week);

  const picture = await playoffPicture(db, 7);
  assert.equal(picture.remainingWeeks, 1);
  const status = new Map(picture.teams.map((t) => [t.fantasyTeamId, t.status]));
  assert.equal(status.get(71), "clinched");
  assert.equal(status.get(72), "clinched");
  assert.equal(status.get(73), "clinched");
  assert.equal(status.get(74), "alive");
  assert.equal(status.get(75), "alive");
  assert.equal(status.get(76), "eliminated");
});
