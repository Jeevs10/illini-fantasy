import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicaliseName, normaliseName, normaliseTeam } from "./normalise.ts";
import { buildIndex, resolve, editDistance, type SourceRecord } from "./match.ts";

const rec = (name: string, team: string, id = name): SourceRecord =>
  ({ source: "test", sourceId: id, name, team });

test("names fold accents, punctuation and suffixes", () => {
  // Đ is a distinct code point, not D plus a combining mark, so NFKD alone
  // drops it entirely. International rosters are full of these.
  assert.equal(normaliseName("Nikola Đurišić"), "nikola durisic");
  assert.equal(normaliseName("Kałuża"), "kaluza");
  assert.equal(normaliseName("Søren Østergaard"), "soren ostergaard");
  assert.equal(normaliseName("D'Angelo Russell Jr."), "dangelo russell");
  assert.equal(normaliseName("Jaylen  Smith  III"), "jaylen smith");
});

test("names survive null and non-string input", () => {
  assert.equal(normaliseName(null), "");
  assert.equal(normaliseName(undefined), "");
  // CBBD returns numeric ids in some recruiting rows where a name is expected.
  assert.equal(normaliseName(1234 as unknown as string), "1234");
});

test("'Last, First' is reordered", () => {
  assert.equal(canonicaliseName("Kelvin, Michael"), "michael kelvin");
  assert.equal(canonicaliseName("Michael Kelvin"), "michael kelvin");
});

test("team aliases reconcile the sources", () => {
  assert.equal(normaliseTeam("Connecticut"), normaliseTeam("UConn"));
  assert.equal(normaliseTeam("Central Florida"), normaliseTeam("UCF"));
  assert.equal(normaliseTeam("College of Charleston"), normaliseTeam("Charleston"));
  assert.equal(normaliseTeam("Arkansas-Little Rock"), normaliseTeam("Little Rock"));
  assert.equal(normaliseTeam("Middle Tennessee St."), normaliseTeam("Middle Tennessee"));
});

test("Torvik's 'St.' and CBBD's 'State' agree", () => {
  assert.equal(normaliseTeam("Michigan St."), normaliseTeam("Michigan State"));
  assert.equal(normaliseTeam("Ohio St."), normaliseTeam("Ohio State"));
});

test("a leading 'St.' is Saint, not State", () => {
  // Expanding it blindly turned "St. Thomas" into "state thomas".
  assert.equal(normaliseTeam("St. Thomas"), normaliseTeam("St. Thomas-Minnesota"));
  assert.ok(!normaliseTeam("St. Thomas").startsWith("state"));
  assert.notEqual(normaliseTeam("St. Thomas"), normaliseTeam("Thomas State"));
});

test("aliases converge — an alias output is normalised like any other input", () => {
  // A single pass left "LIU" -> "long island university" beside CBBD's own
  // "Long Island University" -> "long island", and the two never met.
  assert.equal(normaliseTeam("LIU"), normaliseTeam("Long Island University"));
  assert.equal(normaliseTeam("FIU"), normaliseTeam("Florida International"));
  assert.equal(normaliseTeam("Mississippi"), normaliseTeam("Ole Miss"));
  assert.equal(normaliseTeam("Penn"), normaliseTeam("Pennsylvania"));
  assert.equal(normaliseTeam("UMKC"), normaliseTeam("Kansas City"));
});

test("normaliseTeam is idempotent", () => {
  for (const name of ["LIU", "St. Thomas", "Miami FL", "Michigan St.", "College of Charleston"]) {
    const once = normaliseTeam(name);
    assert.equal(normaliseTeam(once), once, `${name} is not stable under a second pass`);
  }
});

test("Miami FL and Miami OH stay distinct", () => {
  assert.notEqual(normaliseTeam("Miami FL"), normaliseTeam("Miami OH"));
  assert.equal(normaliseTeam("Miami FL"), normaliseTeam("Miami"));
  assert.equal(normaliseTeam("Miami OH"), normaliseTeam("Miami (OH)"));
});

test("edit distance bails out early past the cap", () => {
  assert.equal(editDistance("smith", "smyth"), 1);
  assert.ok(editDistance("smith", "completely different") > 3);
});

test("name plus team is an exact match", () => {
  const index = buildIndex([rec("Michael Kelvin", "Florida International")]);
  const m = resolve(rec("Michael Kelvin", "Florida International"), index);
  assert.equal(m.confidence, "exact");
});

test("a unique national name matches across a transfer", () => {
  const index = buildIndex([rec("Tylen Riley", "Tulsa")]);
  const m = resolve(rec("Tylen Riley", "Cincinnati"), index);
  assert.equal(m.confidence, "strong");
  assert.match(m.reason, /transfer/);
  assert.equal(m.candidate?.team, "Tulsa");
});

test("a nickname on the same team resolves without a national lookup", () => {
  const index = buildIndex([
    rec("Michael Kelvin II", "Florida International"),
    rec("Michael Kelvin", "Duke", "decoy"), // forces the national name to be ambiguous
  ]);
  const m = resolve(rec("Mikey Kelvin", "Florida International"), index);
  assert.equal(m.confidence, "strong");
  assert.equal(m.candidate?.sourceId, "Michael Kelvin II");
});

test("an ambiguous name with no team match is sent to review, never guessed", () => {
  const index = buildIndex([rec("John Smith", "Duke", "a"), rec("John Smith", "Kansas", "b")]);
  const m = resolve(rec("John Smith", "Villanova"), index);
  assert.equal(m.confidence, "none");
  assert.equal(m.candidate, null);
});

test("two players sharing a name on one team are never auto-matched", () => {
  const index = buildIndex([rec("Chris Lee", "Duke", "a"), rec("Chris Lee", "Duke", "b")]);
  const m = resolve(rec("Chris Lee", "Duke"), index);
  assert.equal(m.confidence, "none");
  assert.match(m.reason, /share this name/);
});

test("a spelling slip on a known team is weak, not silently accepted", () => {
  const index = buildIndex([rec("Jaylen Smith", "Duke"), rec("Marcus Webb", "Duke")]);
  const m = resolve(rec("Jaylen Smyth", "Duke"), index);
  assert.equal(m.confidence, "weak");
  assert.match(m.reason, /edit distance/);
});

test("an unknown team is reported as such, so aliases can be added", () => {
  const index = buildIndex([rec("Someone Else", "Duke")]);
  const m = resolve(rec("Nobody Here", "Fictional State"), index);
  assert.equal(m.confidence, "none");
  assert.match(m.reason, /team not in index/);
});
