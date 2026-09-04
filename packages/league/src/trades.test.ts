import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, type Archetype } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import { upsertUser } from "./membership.ts";
import { rosterOn } from "./roster.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";
import { dropPlayer } from "./waivers.ts";
import {
  EmptyTradeError, NotTradeableError, NotYourTradeError, TradeClosedError, TradeDeadlineError,
  TradeRosterError, cancelTrade, deadlinePassedAt, listTrades, proposeTrade, respondToTrade,
  settleTrades, tradeById, tradeableRosters, tradingClosed, vetoTrade,
} from "./trades.ts";

let db: Db;
let configId: number;
let commish: number;
let manager: number;

const TEAMS = [1, 2, 3];
const PLAYERS = 20;
const STAT_DAY = "2026-01-05";

/** A four-man roster, so "full" is reachable without twelve inserts. */
const SETTINGS: LeagueSettings = {
  ...DEFAULT_SETTINGS,
  starters: [{ slot: "G", count: 1 }, { slot: "F", count: 1 }, { slot: "B", count: 1 }],
  bench: 1,
  ir: 0,
};
const LIMIT = 4;

const archetypeOf = (id: number): Archetype => (id <= 10 ? "lead" : id <= 15 ? "wing" : "big");

/** Tuesday afternoon; the review window is a day, so Wednesday is when deals land. */
const TUE = new Date("2026-01-06T18:00:00Z");
const WED = new Date("2026-01-07T18:00:00Z");
const SAT = new Date("2026-01-10T18:00:00Z");

async function reset() {
  await db.query("DELETE FROM trade_item");
  await db.query("DELETE FROM trade");
  await db.query("DELETE FROM waiver_claim");
  await db.query("DELETE FROM waiver_wire");
  await db.query("DELETE FROM lineup_entry");
  await db.query("DELETE FROM roster_slot");
  await db.query("DELETE FROM transaction");
}

/** Puts a player on a roster directly, so a test can arrange without trading. */
async function give(fantasyTeamId: number, playerId: number, on = "2026-01-01") {
  await db.query(
    `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
     VALUES ($1, 1, $2, $3, 'draft')`,
    [fantasyTeamId, playerId, on]);
}

const owners = async (on: string) => {
  const out: Record<number, number[]> = {};
  for (const team of TEAMS) {
    out[team] = (await rosterOn(db, team, on)).map((p) => p.playerId).sort((a, b) => a - b);
  }
  return out;
};

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_trades_test");
  await admin.query("CREATE DATABASE illini_trades_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_trades_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));
  ({ id: commish } = await upsertUser(db, { email: "commish@illini.test", displayName: "Commish" }));
  ({ id: manager } = await upsertUser(db, { email: "manager@illini.test", displayName: "Manager" }));

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')");
  await db.query(
    `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
     VALUES (1,'L',2026,$1,$2,$3)`,
    [configId, JSON.stringify(SETTINGS), commish]);
  await db.query(
    `INSERT INTO league_member (league_id, user_id, role)
     VALUES (1,$1,'commissioner'), (1,$2,'manager')`, [commish, manager]);
  for (const id of TEAMS) {
    await db.query("INSERT INTO fantasy_team (id, league_id, name) VALUES ($1,1,$2)",
      [id, `Team ${id}`]);
  }

  for (let id = 1; id <= PLAYERS; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,1)",
      [id, `Player ${id}`, `player ${id}`]);
    await db.query(
      `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
       VALUES ($1,$2,2026,'Wing F',30,'{}'::jsonb,'torvik')`, [id, STAT_DAY]);
    await db.query(
      `INSERT INTO player_game_score
         (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,0,1,1,$5)`,
      [id, STAT_DAY, configId, archetypeOf(id), 100 - id]);
  }
});

beforeEach(reset);
after(async () => { await db?.end(); });

// --- offering --------------------------------------------------------------

test("an offer names players both sides actually own", async () => {
  await give(1, 5);
  await give(2, 11);

  await assert.rejects(
    proposeTrade(db, { leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [12], now: TUE }),
    NotTradeableError);
  await assert.rejects(
    proposeTrade(db, { leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [], gets: [], now: TUE }),
    EmptyTradeError);

  const trade = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11],
    message: "you need a guard", byUserId: manager, now: TUE });
  assert.equal(trade.status, "proposed");
  assert.deepEqual(trade.from.gives.map((p) => p.playerId), [5]);
  assert.deepEqual(trade.to.gives.map((p) => p.playerId), [11]);
  assert.equal(trade.message, "you need a guard");
  // Three days by default, and nothing has moved yet.
  assert.equal(trade.expiresAt, "2026-01-09T18:00:00.000Z");
  assert.deepEqual((await owners("2026-01-06"))[1], [5]);
});

test("only the team that was asked can answer, and only the proposer can withdraw", async () => {
  await give(1, 5);
  await give(2, 11);
  const trade = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });

  await assert.rejects(
    respondToTrade(db, { tradeId: trade.id, fantasyTeamId: 1, accept: true, now: TUE }),
    NotYourTradeError);
  await assert.rejects(
    respondToTrade(db, { tradeId: trade.id, fantasyTeamId: 3, accept: true, now: TUE }),
    NotYourTradeError);
  await assert.rejects(
    cancelTrade(db, { tradeId: trade.id, fantasyTeamId: 2, now: TUE }),
    NotYourTradeError);

  assert.equal((await cancelTrade(db, { tradeId: trade.id, fantasyTeamId: 1, now: TUE })).status,
    "cancelled");
  // And a withdrawn offer cannot be brought back by answering it.
  await assert.rejects(
    respondToTrade(db, { tradeId: trade.id, fantasyTeamId: 2, accept: true, now: TUE }),
    TradeClosedError);
});

// --- the review window -----------------------------------------------------

test("accepting starts the window, and nothing moves until it closes", async () => {
  await give(1, 5);
  await give(2, 11);
  const offered = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });

  const accepted = await respondToTrade(db, {
    tradeId: offered.id, fantasyTeamId: 2, accept: true, now: TUE });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.executesAt, "2026-01-07T18:00:00.000Z");

  // An hour before the window closes, however often anyone looks.
  assert.deepEqual(await settleTrades(db, { leagueId: 1, now: new Date("2026-01-07T17:00:00Z") }), []);
  assert.deepEqual((await owners("2026-01-07"))[1], [5]);

  const [done] = await settleTrades(db, { leagueId: 1, now: WED });
  assert.equal(done!.status, "executed");
  assert.equal(done!.at, "2026-01-07T18:00:00.000Z");

  const after = await owners("2026-01-07");
  assert.deepEqual(after[1], [11]);
  assert.deepEqual(after[2], [5]);
  // Dated to the execution, not to the offer and not to the reader.
  assert.deepEqual((await rosterOn(db, 2, "2026-01-07")).map((p) => [p.acquiredOn, p.acquiredVia]),
    [["2026-01-07", "trade"]]);
});

test("a league nobody watched executes each deal at its own moment", async () => {
  await give(1, 5);
  await give(2, 11);
  await give(2, 12);
  await give(3, 16);

  const first = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
  await respondToTrade(db, { tradeId: first.id, fantasyTeamId: 2, accept: true, now: TUE });

  const second = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 3, toTeamId: 2, gives: [16], gets: [12],
    now: new Date("2026-01-08T06:00:00Z") });
  await respondToTrade(db, {
    tradeId: second.id, fantasyTeamId: 2, accept: true, now: new Date("2026-01-08T06:00:00Z") });

  // Nobody looks until Saturday. Both deals still land on the nights they were
  // due, in the order they were due.
  const done = await settleTrades(db, { leagueId: 1, now: SAT });
  assert.deepEqual(done.map((d) => [d.status, d.at]), [
    ["executed", "2026-01-07T18:00:00.000Z"],
    ["executed", "2026-01-09T06:00:00.000Z"],
  ]);

  // On Wednesday only the first had happened; the second man is still Team 2's.
  assert.deepEqual((await owners("2026-01-08"))[2], [5, 12]);
  assert.deepEqual((await owners("2026-01-09"))[3], [12]);
});

test("a review window of zero executes on the next read", async () => {
  await db.query("UPDATE league SET settings = $1 WHERE id = 1",
    [JSON.stringify({ ...SETTINGS, tradeReviewHours: 0 })]);
  try {
    await give(1, 5);
    await give(2, 11);
    const offered = await proposeTrade(db, {
      leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
    await respondToTrade(db, { tradeId: offered.id, fantasyTeamId: 2, accept: true, now: TUE });

    const [done] = await settleTrades(db, { leagueId: 1, now: TUE });
    assert.equal(done!.status, "executed");
    assert.deepEqual((await owners("2026-01-06"))[2], [5]);
  } finally {
    await db.query("UPDATE league SET settings = $1 WHERE id = 1", [JSON.stringify(SETTINGS)]);
  }
});

test("the commissioner can veto inside the window and not after it", async () => {
  await give(1, 5);
  await give(2, 11);
  const offered = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
  await respondToTrade(db, { tradeId: offered.id, fantasyTeamId: 2, accept: true, now: TUE });

  // A manager is not a commissioner, whatever they think of the deal.
  await assert.rejects(
    vetoTrade(db, { tradeId: offered.id, byUserId: manager, now: TUE }), /not a commissioner/);

  const vetoed = await vetoTrade(db, {
    tradeId: offered.id, byUserId: commish, reason: "collusion", now: TUE });
  assert.equal(vetoed.status, "vetoed");
  assert.equal(vetoed.reason, "collusion");
  assert.equal(vetoed.vetoedByName, "Commish");

  // Nothing moves afterwards, and there is nothing left to veto.
  assert.deepEqual(await settleTrades(db, { leagueId: 1, now: SAT }), []);
  assert.deepEqual((await owners("2026-01-07"))[1], [5]);
  await assert.rejects(
    vetoTrade(db, { tradeId: offered.id, byUserId: commish, now: WED }), TradeClosedError);
});

// --- deals that stop being honourable --------------------------------------

test("a player dropped before the window closes voids the trade, and says so", async () => {
  await give(1, 5);
  await give(2, 11);
  const offered = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
  await respondToTrade(db, { tradeId: offered.id, fantasyTeamId: 2, accept: true, now: TUE });

  await dropPlayer(db, {
    leagueId: 1, fantasyTeamId: 1, playerId: 5, now: new Date("2026-01-07T06:00:00Z") });

  const [done] = await settleTrades(db, { leagueId: 1, now: WED });
  assert.equal(done!.status, "invalid");
  assert.match(done!.reason!, /Player 5 had already been dropped/);
  // And nothing half-happened: Team 2 still holds his own man.
  assert.deepEqual((await owners("2026-01-07"))[2], [11]);
});

test("the same player offered to two teams goes to whichever deal lands first", async () => {
  await give(1, 5);
  await give(2, 11);
  await give(3, 16);

  const toTwo = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
  const toThree = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 3, gives: [5], gets: [16],
    now: new Date("2026-01-06T19:00:00Z") });

  // Shopping a man to two teams is ordinary. Both may accept.
  await respondToTrade(db, { tradeId: toTwo.id, fantasyTeamId: 2, accept: true, now: TUE });
  await respondToTrade(db, {
    tradeId: toThree.id, fantasyTeamId: 3, accept: true, now: new Date("2026-01-06T19:00:00Z") });

  const done = await settleTrades(db, { leagueId: 1, now: SAT });
  assert.deepEqual(done.map((d) => d.status), ["executed", "invalid"]);
  assert.match(done[1]!.reason!, /Player 5 is on Team 2 now/);

  const after = await owners("2026-01-08");
  assert.deepEqual(after[2], [5]);
  assert.deepEqual(after[3], [16]);   // his own man never left
});

test("a trade that would overfill a roster is refused at acceptance and at execution", async () => {
  for (const id of [1, 2, 3, 4]) await give(2, id);       // full at four
  for (const id of [11, 12]) await give(1, id);

  const twoForOne = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [11, 12], gets: [1], now: TUE });
  await assert.rejects(
    respondToTrade(db, { tradeId: twoForOne.id, fantasyTeamId: 2, accept: true, now: TUE }),
    TradeRosterError);

  // A straight swap is fine, and stays fine — until Team 2 fills the room it
  // was going to use. The window is a day, and a day is long enough.
  const swap = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [11], gets: [1], now: TUE });
  await respondToTrade(db, { tradeId: swap.id, fantasyTeamId: 2, accept: true, now: TUE });
  await db.query("DELETE FROM roster_slot WHERE fantasy_team_id = 2 AND player_id = 1");
  await give(2, 5, "2026-01-07");

  const [done] = await settleTrades(db, { leagueId: 1, now: WED });
  assert.equal(done!.status, "invalid");
  assert.match(done!.reason!, /Player 1 had already been dropped/);
});

// --- the rules a trade shares with every other ownership move --------------

test("a trade clears the lineups the losing team can no longer stand behind", async () => {
  await give(1, 5);
  await give(2, 11);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO game (played_on, season, home_team_id, tipoff)
     VALUES ('2026-01-07', 2026, 1, '2026-01-07T01:00:00Z'),
            ('2026-01-09', 2026, 1, '2026-01-10T01:00:00Z')
     RETURNING id`);
  const [played, future] = rows.map((r) => Number(r.id));
  for (const [day, gameId] of [["2026-01-07", played], ["2026-01-09", future]] as const) {
    await db.query(
      `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
       VALUES (1, $1, 5, 'G', $2)`, [day, gameId]);
  }

  const offered = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
  await respondToTrade(db, { tradeId: offered.id, fantasyTeamId: 2, accept: true, now: TUE });
  await settleTrades(db, { leagueId: 1, now: WED });

  const { rows: left } = await db.query<{ played_on: string }>(
    "SELECT to_char(played_on,'YYYY-MM-DD') AS played_on FROM lineup_entry WHERE player_id = 5");
  // Wednesday morning's game had tipped off before the trade executed — those
  // points were Team 1's. Friday's had not, and Team 1 must not score them.
  assert.deepEqual(left.map((r) => r.played_on), ["2026-01-07"]);
});

test("an offer nobody answers expires rather than standing all season", async () => {
  await give(1, 5);
  await give(2, 11);
  const offered = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });

  const [done] = await settleTrades(db, { leagueId: 1, now: SAT });
  assert.equal(done!.status, "expired");
  assert.equal(done!.at, offered.expiresAt);
  await assert.rejects(
    respondToTrade(db, { tradeId: offered.id, fantasyTeamId: 2, accept: true, now: SAT }),
    TradeClosedError);
});

// --- the deadline ----------------------------------------------------------

/** Runs a block with a deadline on the league, and puts the settings back. */
async function withDeadline(deadline: string | null, body: () => Promise<void>) {
  await db.query("UPDATE league SET settings = $1 WHERE id = 1",
    [JSON.stringify({ ...SETTINGS, tradeDeadline: deadline })]);
  try {
    await body();
  } finally {
    await db.query("UPDATE league SET settings = $1 WHERE id = 1", [JSON.stringify(SETTINGS)]);
  }
}

test("the deadline day is inclusive, and compared in roster days", () => {
  const settings = { ...SETTINGS, tradeDeadline: "2026-01-07" };
  assert.equal(tradingClosed(settings, TUE), false);
  // Late on the deadline day itself is still the deadline day.
  assert.equal(tradingClosed(settings, new Date("2026-01-07T23:59:00Z")), false);
  assert.equal(tradingClosed(settings, new Date("2026-01-08T00:01:00Z")), true);
  assert.equal(tradingClosed({ ...SETTINGS, tradeDeadline: null }, SAT), false);
  assert.equal(deadlinePassedAt("2026-01-07").toISOString(), "2026-01-08T00:00:00.000Z");
});

test("nothing can be offered or agreed after the deadline", async () => {
  await withDeadline("2026-01-07", async () => {
    await give(1, 5);
    await give(2, 11);

    await assert.rejects(
      proposeTrade(db, {
        leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: SAT }),
      (error: TradeDeadlineError) => {
        assert.equal(error.name, "TradeDeadlineError");
        assert.equal(error.deadline, "2026-01-07");
        return true;
      });

    // Offered in time, answered too late: the handshake is what the deadline
    // binds, and this one never happened.
    const offered = await proposeTrade(db, {
      leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
    await assert.rejects(
      respondToTrade(db, { tradeId: offered.id, fantasyTeamId: 2, accept: true, now: SAT }),
      TradeDeadlineError);

    // Turning it down still works. An inbox nobody can clear is worse.
    const rejected = await respondToTrade(db, {
      tradeId: offered.id, fantasyTeamId: 2, accept: false, now: SAT });
    assert.equal(rejected.status, "rejected");
  });
});

test("a deal agreed in time still executes after the deadline", async () => {
  await withDeadline("2026-01-06", async () => {
    await give(1, 5);
    await give(2, 11);
    const offered = await proposeTrade(db, {
      leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
    await respondToTrade(db, { tradeId: offered.id, fantasyTeamId: 2, accept: true, now: TUE });

    // The window closes on Wednesday, a day past the deadline. Both managers
    // shook hands while trading was open, and the window is not theirs.
    const [done] = await settleTrades(db, { leagueId: 1, now: WED });
    assert.equal(done!.status, "executed");
    assert.deepEqual((await owners("2026-01-07"))[2], [5]);
  });
});

test("the deadline expires the offers the ordinary expiry left alive", async () => {
  await withDeadline("2026-01-07", async () => {
    await give(1, 5);
    await give(2, 11);
    await give(3, 16);
    // Offered on Tuesday, so it stands three days and would have survived to
    // Friday on its own terms.
    const live = await proposeTrade(db, {
      leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });

    const done = await settleTrades(db, { leagueId: 1, now: new Date("2026-01-08T12:00:00Z") });
    assert.deepEqual(done, [{
      tradeId: live.id, status: "expired", reason: "the trade deadline passed",
      // Dated to the deadline rather than to whenever somebody looked.
      at: "2026-01-08T00:00:00.000Z",
    }]);
  });
});

test("two clocks on one offer, and the first to reach it wins", async () => {
  await withDeadline("2026-01-07", async () => {
    await give(1, 5);
    await give(2, 11);
    // Offered Tuesday, so it stands to Friday on its own terms — but the
    // deadline arrives at midnight on Thursday and gets there first.
    await proposeTrade(db, {
      leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
    const [done] = await settleTrades(db, { leagueId: 1, now: new Date("2026-01-20T00:00:00Z") });
    assert.equal(done!.reason, "the trade deadline passed");
    assert.equal(done!.at, "2026-01-08T00:00:00.000Z");
  });
});

test("an offer that died of neglect is not told it died of a deadline", async () => {
  await withDeadline("2026-01-31", async () => {
    await give(1, 5);
    await give(2, 11);
    const offered = await proposeTrade(db, {
      leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
    const [done] = await settleTrades(db, { leagueId: 1, now: SAT });
    assert.equal(done!.reason, "nobody answered before it expired");
    assert.equal(done!.at, offered.expiresAt);
  });
});

// --- reading ---------------------------------------------------------------

test("a team sees its own deals, and the league sees the ones under review", async () => {
  await give(1, 5);
  await give(2, 11);
  await give(3, 16);
  const mine = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 1, toTeamId: 2, gives: [5], gets: [11], now: TUE });
  const theirs = await proposeTrade(db, {
    leagueId: 1, fromTeamId: 2, toTeamId: 3, gives: [11], gets: [16], now: TUE });
  await respondToTrade(db, { tradeId: theirs.id, fantasyTeamId: 3, accept: true, now: TUE });

  assert.deepEqual((await listTrades(db, { leagueId: 1, involving: 1 })).map((t) => t.id),
    [mine.id]);
  // Under review is public: an agreed deal nobody can see is one nobody can object to.
  const review = await listTrades(db, { leagueId: 1, statuses: ["accepted"] });
  assert.deepEqual(review.map((t) => t.id), [theirs.id]);
  assert.equal(review[0]!.to.teamName, "Team 3");
  assert.equal((await tradeById(db, mine.id))!.from.gives[0]!.name, "Player 5");
});

test("the propose form sees every roster at once, including an empty one", async () => {
  await give(1, 5);
  await give(2, 11);
  const teams = await tradeableRosters(db, { leagueId: 1, on: "2026-01-06" });
  assert.deepEqual(teams.map((t) => [t.teamName, t.players.length]),
    [["Team 1", 1], ["Team 2", 1], ["Team 3", 0]]);
  assert.equal(teams[0]!.players[0]!.name, "Player 5");
});
