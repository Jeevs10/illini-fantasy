import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "./slots.ts";
import { roundRobin, weeksFrom } from "./schedule.ts";

// Role-to-slot eligibility, auto-fill and lineup validation now live in
// slots.test.ts, against the Torvik role strings that actually govern them.

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
