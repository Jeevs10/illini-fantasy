import { test } from "node:test";
import assert from "node:assert/strict";
import { liveValue, livePossessions, type LiveBoxLine, type LiveParams } from "./live.ts";

// schedule.live_scoring() as of 2026-10-30, and value_adj() run on the same line
// in the Data repo (python: schedule.value_adj(p, d, poss, team_min, net)).
const PARAMS: LiveParams = {
  box: {
    pts: 106.74302480114451, shots: -94.53211412068724, ast: 71.1576585865227, tov: -110.42716283613221,
    orb: 33.125673923833375, drb: 3.958302533363278, stl: 110.5890365367861, blk: 11.86140443601132,
    pf: -11.841983586193138,
  },
  oppDefK: 0.22, levelK: 0.0847, levelRef: 15, teamW: 0.1, ftPoss: 0.475, worstDef: -10,
};
const LINE: LiveBoxLine = {
  athleteId: "1", min: 34, pts: 22, fgm: 8, fga: 15, tpm: 3, tpa: 6, ftm: 3, fta: 4,
  orb: 2, drb: 6, reb: 8, ast: 4, stl: 2, blk: 1, tov: 3, pf: 2,
};

test("a live line scores what value_adj scores it, at a program above +15, below it, and at it", () => {
  for (const [ctx, expected] of [
    [{ oppDef: 4.2, poss: 68.5, teamMin: 200, net: 24.1 }, 11.234787821851986],
    [{ oppDef: -3.0, poss: 72.0, teamMin: 201, net: 8.0 }, 8.977712665135568],
    [{ oppDef: 1.1, poss: 64.0, teamMin: 200, net: 15.0 }, 10.298589321851987],
  ] as const) {
    assert.ok(Math.abs(liveValue(LINE, ctx, PARAMS) - expected) < 1e-9, `${JSON.stringify(ctx)}`);
  }
});

test("possessions are estimated from the live line the way schedule.py falls back", () => {
  const got = livePossessions([LINE, { ...LINE, fga: 5, orb: 1, tov: 0, fta: 2 }], 0.475);
  assert.ok(Math.abs(got - (15 - 2 + 3 + 1.9 + 5 - 1 + 0 + 0.95)) < 1e-9, String(got));
});

test("the clock reads as the share of the game left", async () => {
  const { remainingShare } = await import("./live.ts");
  assert.equal(remainingShare("1st - 20:00", false), 1);
  assert.equal(remainingShare("Halftime", false), 0.5);
  assert.ok(Math.abs(remainingShare("2nd - 8:30", false) - 8.5 / 40) < 1e-9);
  assert.equal(remainingShare("Final", true), 0);
  assert.equal(remainingShare("OT - 2:10", false), 0);
});

// ---------- liveLines against a database, with a stand-in for ESPN ----------

import { after, before } from "node:test";
import { connect, migrate, type Db } from "@illini/db";
import { liveLines, liveKey, type LiveSource } from "./live.ts";

let db: Db;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_live_test");
  await admin.query("CREATE DATABASE illini_live_test");
  await admin.end();
  db = connect("postgresql://postgres:dev@localhost:55432/illini_live_test");
  await migrate(db);
  await db.query(`INSERT INTO team (id, name, normalised) VALUES (1, 'Illinois', 'illinois'), (2, 'FDU', 'fairleigh dickinson'),
                                                              (3, 'Nowhere', 'nowhere')`);
  await db.query(`INSERT INTO player (id, name, normalised, team_id) VALUES
                    (10, 'Quentin Coleman', 'quentin coleman', 1), (11, 'JR Jacobs', 'jr jacobs', 2),
                    (12, 'No Espn', 'no espn', 1)`);
  await db.query(`INSERT INTO player_source_id (player_id, source, source_id, confidence) VALUES
                    (10, 'espn', '501', 'exact'), (11, 'espn', '601', 'exact')`);
  await db.query(`INSERT INTO forward_live_params (season, as_of, params) VALUES (2027, '2026-11-02', $1)`,
    [JSON.stringify(PARAMS)]);
  // FDU's defence is rated; Illinois' is not, so FDU's players face the worst defence (worstDef).
  await db.query(`INSERT INTO forward_team_rating (team_id, as_of, def, net) VALUES
                    (1, '2026-11-02', NULL, 32.5), (2, '2026-11-02', -6.0, -15.1)`);
});

after(async () => { await db?.end(); });

const line = (athleteId: string, min: number, name?: string) => ({ ...LINE, athleteId, min, name });
const source: LiveSource = {
  teamKey: (s) => s.toLowerCase(),
  pickByName: (lines, name) => lines.find((l) => l.name.toLowerCase() === name.toLowerCase())?.athleteId ?? null,
  scoreboard: async () => [
    { eventId: "e1", state: "in", detail: "2nd - 8:41", teams: [{ location: "Illinois", score: 52 }, { location: "Fairleigh Dickinson", score: 31 }] },
    { eventId: "e2", state: "pre", detail: "7:00 PM", teams: [{ location: "Nowhere", score: 0 }, { location: "Elsewhere", score: 0 }] },
  ],
  box: async () => ({
    eventId: "e1", state: "in", detail: "2nd - 8:41",
    teams: [
      { location: "Illinois", players: [line("501", 25), line("598", 20, "No Espn"), line("599", 155)] },
      { location: "Fairleigh Dickinson", players: [line("601", 30), line("699", 170)] },
    ],
  }),
};

test("live lines score each player with his opponent's defence and his own school's net", async () => {
  const got = await liveLines(db, source, [
    { playerId: 10, playedOn: "2026-11-02" }, { playerId: 11, playedOn: "2026-11-02" }, { playerId: 12, playedOn: "2026-11-02" },
  ]);
  const poss = 2 * (15 - 2 + 3 + 0.475 * 4);
  const coleman = got.get(liveKey(10, "2026-11-02"))!;
  const jacobs = got.get(liveKey(11, "2026-11-02"))!;
  assert.equal(coleman.points, Math.round(liveValue(line("501", 25), { oppDef: -6.0, poss, teamMin: 200, net: 32.5 }, PARAMS) * 10) / 10);
  assert.equal(jacobs.points, Math.round(liveValue(line("601", 30), { oppDef: -10, poss, teamMin: 200, net: -15.1 }, PARAMS) * 10) / 10);
  assert.deepEqual([coleman.us, coleman.them, coleman.opponent, coleman.final, coleman.detail], [52, 31, "Fairleigh Dickinson", false, "2nd - 8:41"]);
  // No ESPN id: found by name inside his own school's box.
  assert.equal(got.get(liveKey(12, "2026-11-02"))?.min, 20);
});
