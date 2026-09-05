import { test } from "node:test";
import assert from "node:assert/strict";
import { winProbability } from "./winprob.ts";

test("a tied margin with nothing left is a coin flip, not a lie in either direction", () => {
  assert.equal(winProbability(0, 0), 0.5);
});

test("nothing left to play makes any real lead certain", () => {
  assert.equal(winProbability(12, 0), 1);
  assert.equal(winProbability(-12, 0), 0);
});

test("a tied projection with games still to play is 50/50", () => {
  assert.ok(Math.abs(winProbability(0, 3) - 0.5) < 1e-6);
});

test("a bigger lead is more probable, holding games remaining fixed", () => {
  const small = winProbability(2, 4);
  const big = winProbability(20, 4);
  assert.ok(big > small, `expected ${big} > ${small}`);
});

test("the same lead is less certain the more games remain to erase it", () => {
  const soon = winProbability(10, 1);
  const later = winProbability(10, 6);
  assert.ok(soon > later, `expected ${soon} > ${later}`);
  assert.ok(later > 0.5, "a real lead still favours the leader with more games left");
});

test("trailing mirrors leading — the two sides of one matchup sum to 1", () => {
  const left = winProbability(7, 3);
  const right = winProbability(-7, 3);
  assert.ok(Math.abs(left + right - 1) < 1e-6);
});

test("stays within [0, 1] for a lopsided margin over a long stretch", () => {
  const p = winProbability(500, 20);
  assert.ok(p <= 1 && p >= 0);
});
