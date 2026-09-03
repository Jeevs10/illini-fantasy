import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG, SEASON_CONFIG } from "./config.ts";
import { scale, scoreLine, archetypeFor, computeBlocks } from "./score.ts";
import type { PlayerLine } from "./types.ts";

const base: PlayerLine = {
  playerId: "1", name: "Test", team: "Illinois", conference: "B10", role: "Combo G",
  minutes: 30, points: 0, rebounds: 0, assists: 0,
  effectiveFieldGoalPct: 0, trueShootingPct: 0, threePointPct: 0, freeThrowPct: 0,
  usage: 0, assistPct: 0, turnoverPct: 0, stealPct: 0, blockPct: 0,
  defensiveRating: 0, offensiveReboundPct: 0, defensiveReboundPct: 0,
  bpm: -5, obpm: -4, dbpm: -2, porpag: 0,
  attempts: { three: 0, freeThrow: 0, fieldGoal: 0 },
  seasonRates: {
    effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.38, freeThrowPct: 0.8,
  },
};

test("scale clips and normalises", () => {
  assert.equal(scale(5, 0, 10), 0.5);
  assert.equal(scale(-3, 0, 10), 0);
  assert.equal(scale(99, 0, 10), 1);
  assert.equal(scale(NaN, 0, 10), 0);
});

test("unknown role falls back to the configured archetype", () => {
  assert.equal(archetypeFor("Wing F", GAME_CONFIG), "wing");
  assert.equal(archetypeFor("Point Forward", GAME_CONFIG), GAME_CONFIG.fallbackArchetype);
  assert.equal(archetypeFor(null, GAME_CONFIG), GAME_CONFIG.fallbackArchetype);
});

test("no attempts means no shooting credit, despite a strong season prior", () => {
  const blocks = computeBlocks(base, GAME_CONFIG);
  assert.equal(blocks.shooting, 0,
    "shrinkage must not credit season shooting to a game with no shots");
});

test("shooting shrinks a 1-for-1 three toward the season rate", () => {
  // Hold the other three rates at their season values so only the 3P% term moves;
  // otherwise shrinkage lifts the zeroed rates and masks the effect.
  const line: PlayerLine = {
    ...base, usage: 20,
    effectiveFieldGoalPct: base.seasonRates!.effectiveFieldGoalPct,
    trueShootingPct: base.seasonRates!.trueShootingPct,
    freeThrowPct: base.seasonRates!.freeThrowPct,
    threePointPct: 1,
    attempts: { three: 1, freeThrow: 2, fieldGoal: 3 },
  };
  const shrunk = computeBlocks(line, GAME_CONFIG);
  const unshrunk = computeBlocks(line, { ...GAME_CONFIG, shrinkagePriorAttempts: 0 });
  assert.ok(shrunk.shooting < unshrunk.shooting,
    "a single made three must not max the shooting term");
  assert.ok(unshrunk.shooting > 0, "sanity: the unshrunk line does max it");
});

test("using no possessions forfeits the turnover-avoidance credit", () => {
  const idle = computeBlocks({ ...base, usage: 0 }, GAME_CONFIG);
  const active = computeBlocks({ ...base, usage: 12 }, GAME_CONFIG);
  assert.equal(idle.playmaking, 0);
  assert.ok(active.playmaking > 0);
});

test("an empty stat line scores near zero", () => {
  const { score } = scoreLine(base, GAME_CONFIG, 1);
  assert.ok(score < 1, `expected under 1, got ${score.toFixed(2)}`);
});

test("the minutes ramp scales a cameo down and leaves a full game alone", () => {
  const productive: PlayerLine = {
    ...base, points: 20, rebounds: 5, assists: 4, usage: 24, minutes: 30,
    effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.4, freeThrowPct: 0.8,
    defensiveRating: 95, bpm: 6, obpm: 3, dbpm: 2, porpag: 3,
    attempts: { three: 5, freeThrow: 4, fieldGoal: 14 },
  };
  const full = scoreLine(productive, GAME_CONFIG, 1).score;
  const cameo = scoreLine({ ...productive, minutes: 5 }, GAME_CONFIG, 1).score;
  assert.ok(Math.abs(cameo - full / 2) < 1e-9, "5 of 10 minutes should halve the score");
  assert.equal(scoreLine({ ...productive, minutes: 40 }, GAME_CONFIG, 1).score, full);
});

test("season config keeps the original bounds and no gate", () => {
  assert.equal(SEASON_CONFIG.bounds.points!.max, 20);
  assert.equal(SEASON_CONFIG.minutesGate, 0);
  assert.equal(GAME_CONFIG.bounds.points!.max, 37);
});

test("the source model's weight sums are uneven, and we reproduce them", () => {
  const sums = Object.fromEntries(
    Object.entries(GAME_CONFIG.weights).map(([k, w]) =>
      [k, Object.values(w).reduce((a, b) => a + b, 0)]),
  );
  // Not a typo: generate_player_scores.py really does score swing out of 102
  // and big out of 98. Reproduced deliberately so fidelity is the default.
  assert.deepEqual(sums, { lead: 100, combo: 100, wing: 100, swing: 102, big: 98 });
});

test("normaliseWeights removes the 102/98 archetype gap", () => {
  const line: PlayerLine = {
    ...base, points: 18, rebounds: 9, assists: 2, usage: 22, minutes: 30,
    effectiveFieldGoalPct: 55, trueShootingPct: 60, threePointPct: 0.35, freeThrowPct: 0.75,
    assistPct: 12, turnoverPct: 14, stealPct: 2, blockPct: 5,
    defensiveRating: 95, offensiveReboundPct: 9, defensiveReboundPct: 20,
    bpm: 5, obpm: 2, dbpm: 3, porpag: 3,
    attempts: { three: 4, freeThrow: 4, fieldGoal: 12 },
  };
  const raw = (role: string, normalise: boolean) =>
    scoreLine({ ...line, role }, { ...GAME_CONFIG, normaliseWeights: normalise }, 1).raw;

  const gapBefore = raw("Stretch 4", false) / raw("PF/C", false);
  const gapAfter = raw("Stretch 4", true) / raw("PF/C", true);
  assert.ok(gapAfter < gapBefore, "normalising must narrow the swing/big gap");
});
