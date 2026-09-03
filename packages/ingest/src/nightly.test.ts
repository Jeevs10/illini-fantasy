import { test } from "node:test";
import assert from "node:assert/strict";
import { basketballDate } from "./nightly.ts";

test("an evening tip belongs to the day it was played, not the day UTC filed it", () => {
  // 7pm Eastern on the 10th — 00:00 UTC on the 11th, and the trap that filed
  // 158 of the first 280 games a day late.
  assert.equal(basketballDate("2026-02-11T00:00:00.000Z"), "2026-02-10");
  // 10:30pm Pacific, the latest tip in the observed data.
  assert.equal(basketballDate("2026-02-15T04:00:00.000Z"), "2026-02-14");
  // Noon Eastern, the earliest.
  assert.equal(basketballDate("2026-02-14T17:00:00.000Z"), "2026-02-14");
});

test("the day boundary sits in the gap where nothing tips off", () => {
  // Observed tip-offs span 16:00 to 05:00 UTC. The boundary is 09:00 UTC, so
  // both edges have hours of margin — the fix does not depend on a game never
  // running long.
  assert.equal(basketballDate("2026-02-14T09:00:00.000Z"), "2026-02-14");
  assert.equal(basketballDate("2026-02-14T08:59:59.000Z"), "2026-02-13");
  assert.equal(basketballDate("2026-02-14T05:00:00.000Z"), "2026-02-13",
    "the latest possible tip still lands on the previous day");
  assert.equal(basketballDate("2026-02-14T16:00:00.000Z"), "2026-02-14",
    "the earliest possible tip lands on its own day");
});
