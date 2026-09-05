import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseStatus } from "./injuries.ts";

test("recognised RotoWire wording maps onto the fixed vocabulary", () => {
  assert.equal(normaliseStatus("Out"), "out");
  assert.equal(normaliseStatus("Out For Season"), "out");
  assert.equal(normaliseStatus("Injured Reserve"), "out");
  assert.equal(normaliseStatus("Doubtful"), "doubtful");
  assert.equal(normaliseStatus("Questionable"), "questionable");
  assert.equal(normaliseStatus("Day-To-Day"), "questionable");
  assert.equal(normaliseStatus("GTD"), "questionable");
  assert.equal(normaliseStatus("Probable"), "probable");
  assert.equal(normaliseStatus("Available"), "available");
});

test("matching ignores case and surrounding space", () => {
  assert.equal(normaliseStatus("  oUt  "), "out");
  assert.equal(normaliseStatus("PROBABLE"), "probable");
});

test("unrecognised wording defaults to questionable, not available", () => {
  // RotoWire lists a player at all because something is being said about him
  // — the safe reading of wording this repo has not seen yet is doubt.
  assert.equal(normaliseStatus("Load Management"), "questionable");
  assert.equal(normaliseStatus(""), "questionable");
});
