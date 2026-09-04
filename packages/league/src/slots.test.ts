import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS, autoFill, eligibleSlots, isEligible, rolesFor, validateLineup, type Slot,
} from "./slots.ts";

/** The eight strings Torvik's `role` column actually contains. */
const ROLES = [
  "Pure PG", "Scoring PG", "Combo G", "Wing G", "Wing F", "Stretch 4", "PF/C", "C",
] as const;

const SLOTS: Slot[] = ["G", "F", "B", "FLEX", "BENCH", "IR"];

/** What each role should start at, worked out by hand from the mapping. */
const EXPECTED: Record<(typeof ROLES)[number], Slot[]> = {
  "Pure PG": ["G", "FLEX", "BENCH", "IR"],
  "Scoring PG": ["G", "FLEX", "BENCH", "IR"],
  "Combo G": ["G", "FLEX", "BENCH", "IR"],
  "Wing G": ["G", "F", "FLEX", "BENCH", "IR"],
  "Wing F": ["F", "FLEX", "BENCH", "IR"],
  "Stretch 4": ["F", "FLEX", "BENCH", "IR"],
  "PF/C": ["F", "B", "FLEX", "BENCH", "IR"],
  "C": ["B", "FLEX", "BENCH", "IR"],
};

test("every Torvik role against every slot", () => {
  for (const role of ROLES) {
    for (const slot of SLOTS) {
      assert.equal(isEligible(role, slot), EXPECTED[role].includes(slot),
        `${role} at ${slot}`);
    }
  }
});

test("a Wing G plays guard and forward; a PF/C plays forward and big", () => {
  assert.deepEqual(rolesFor("Wing G"), ["G", "F"]);
  assert.deepEqual(rolesFor("PF/C"), ["F", "B"]);
});

test("an unfamiliar role, or none at all, is FLEX-only rather than a guess", () => {
  assert.deepEqual(rolesFor(null), []);
  assert.deepEqual(rolesFor("Point Forward"), []);
  assert.deepEqual(eligibleSlots(null), ["FLEX"]);
  assert.deepEqual(eligibleSlots("Point Forward"), ["FLEX"]);
  for (const slot of SLOTS) {
    assert.equal(isEligible(null, slot), slot === "FLEX" || slot === "BENCH" || slot === "IR");
  }
});

test("a lineup is only as legal as the roles in it", () => {
  const lineup = [
    { playerId: 1, role: "Pure PG", slot: "G" as Slot },
    { playerId: 2, role: "Wing F", slot: "F" as Slot },
    { playerId: 3, role: "C", slot: "B" as Slot },
    { playerId: 4, role: "PF/C", slot: "FLEX" as Slot },
  ];
  assert.deepEqual(validateLineup(lineup), []);

  const illegal = validateLineup([{ playerId: 1, role: "Pure PG", slot: "B" as Slot }]);
  assert.equal(illegal.length, 1);
  assert.match(illegal[0]!.message, /Pure PG cannot start at B/);

  const unknown = validateLineup([{ playerId: 1, role: null, slot: "G" as Slot }]);
  assert.equal(unknown.length, 1);
  assert.match(unknown[0]!.message, /no known role cannot start at G/);
});

test("auto-fill seats the scarcest roles first and benches an unrecognised one", () => {
  const roster = [
    { playerId: 1, role: "C", projected: 10 },        // B, FLEX only
    { playerId: 2, role: "Pure PG", projected: 20 },  // G, FLEX
    { playerId: 3, role: "Wing G", projected: 15 },   // G, F, FLEX
    { playerId: 4, role: "Wing F", projected: 5 },     // F, FLEX
    { playerId: 5, role: "Nonsense Role", projected: 30 }, // FLEX only
  ];
  const lineup = autoFill(roster, DEFAULT_SETTINGS);
  assert.deepEqual(validateLineup(lineup, DEFAULT_SETTINGS), []);

  const by = new Map(lineup.map((l) => [l.playerId, l.slot]));
  assert.equal(by.get(1), "B", "the only big fills the only big slot");
  // Two guards close G before FLEX is even considered.
  assert.equal(by.get(2), "G");
  assert.equal(by.get(3), "G");
  // The unrecognised role is the best projection on the roster but can only
  // ever take FLEX — it does not get to skip the queue.
  assert.equal(by.get(5), "FLEX");
});
