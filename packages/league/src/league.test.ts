import { test } from "node:test";
import assert from "node:assert/strict";
import type { Archetype } from "@illini/scoring";
import { autoFill, validateLineup, eligibleSlots, DEFAULT_SETTINGS, type LineupSlot } from "./slots.ts";
import { roundRobin, weeksFrom } from "./schedule.ts";

const p = (id: number, archetype: Archetype, projected = 30) => ({ playerId: id, archetype, projected });

test("archetypes map to the slots the scoring model implies", () => {
  assert.deepEqual(eligibleSlots("lead"), ["G", "FLEX"]);
  assert.ok(eligibleSlots("big").includes("C"));
  // Stretch fours cover both forward and centre, which is the whole point of
  // the archetype.
  assert.ok(eligibleSlots("swing").includes("F"));
  assert.ok(eligibleSlots("swing").includes("C"));
});

test("autoFill produces a legal lineup from a mixed roster", () => {
  const roster = [
    p(1, "lead", 40), p(2, "combo", 38), p(3, "combo", 20),
    p(4, "wing", 35), p(5, "wing", 25), p(6, "swing", 30),
    p(7, "big", 33), p(8, "big", 18),
  ];
  const lineup = autoFill(roster);
  assert.deepEqual(validateLineup(lineup), []);
  const starters = lineup.filter((l) => l.slot !== "BENCH");
  assert.equal(starters.length, 7, "2G + 2F + 1C + 2FLEX");
});

test("autoFill fills the scarce centre slot before spending bigs on FLEX", () => {
  const roster = [
    p(1, "lead", 50), p(2, "lead", 49), p(3, "combo", 48), p(4, "combo", 47),
    p(5, "wing", 46), p(6, "wing", 45), p(7, "big", 10),
  ];
  const lineup = autoFill(roster);
  assert.deepEqual(validateLineup(lineup), []);
  const centre = lineup.find((l) => l.slot === "C");
  assert.equal(centre?.playerId, 7, "the only eligible centre must fill C, low score notwithstanding");
});

test("a guard cannot be started at centre", () => {
  const lineup: LineupSlot[] = [{ playerId: 1, archetype: "lead", slot: "C" }];
  const violations = validateLineup(lineup);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.message, /cannot start at C/);
});

test("overfilling a slot and double-starting a player are both caught", () => {
  const over: LineupSlot[] = [
    { playerId: 1, archetype: "lead", slot: "G" },
    { playerId: 2, archetype: "combo", slot: "G" },
    { playerId: 3, archetype: "combo", slot: "G" },
  ];
  assert.match(validateLineup(over)[0]!.message, /3 players in G, room for 2/);

  const twice: LineupSlot[] = [
    { playerId: 1, archetype: "lead", slot: "G" },
    { playerId: 1, archetype: "lead", slot: "FLEX" },
  ];
  assert.ok(validateLineup(twice).some((v) => /two slots/.test(v.message)));
});

test("round robin pairs everyone once per round, with no repeats", () => {
  const rounds = roundRobin([1, 2, 3, 4, 5, 6]);
  assert.equal(rounds.length, 5, "n-1 rounds for 6 teams");
  for (const round of rounds) {
    const seen = new Set<number>();
    for (const { home, away } of round) {
      assert.ok(!seen.has(home) && !seen.has(away), "a team plays at most once per round");
      seen.add(home); seen.add(away);
    }
    assert.equal(seen.size, 6, "every team is scheduled each round");
  }
  const pairs = rounds.flat().map(({ home, away }) => [home, away].sort().join("-"));
  assert.equal(new Set(pairs).size, pairs.length, "no pairing repeats");
});

test("an odd league gives someone a bye instead of dropping them", () => {
  const rounds = roundRobin([1, 2, 3, 4, 5]);
  assert.equal(rounds.length, 5);
  for (const round of rounds) {
    assert.equal(round.length, 2, "two games and one bye");
  }
  const appearances = new Map<number, number>();
  for (const { home, away } of rounds.flat()) {
    for (const t of [home, away]) appearances.set(t, (appearances.get(t) ?? 0) + 1);
  }
  assert.deepEqual([...new Set(appearances.values())], [4], "everyone sits exactly once");
});

test("home and away alternate across rounds", () => {
  const rounds = roundRobin([1, 2, 3, 4]);
  const homeCounts = new Map<number, number>();
  for (const { home } of rounds.flat()) homeCounts.set(home, (homeCounts.get(home) ?? 0) + 1);
  for (const count of homeCounts.values()) {
    assert.ok(count >= 1 && count <= 2, `lopsided home split: ${count} of ${rounds.length}`);
  }
});

test("weeks are contiguous Monday-to-Sunday periods", () => {
  const weeks = weeksFrom("2026-11-02", 3);
  assert.deepEqual(weeks[0], { week: 1, startsOn: "2026-11-02", endsOn: "2026-11-08" });
  assert.equal(weeks[1]!.startsOn, "2026-11-09", "no gap between periods");
  assert.equal(weeks.length, 3);
  assert.equal(DEFAULT_SETTINGS.periodDays, 7);
});
