import type { ScoringConfig } from "./types.ts";

/**
 * Faithful port of Scripts/college_model/generate_player_scores.py.
 *
 * `season` reproduces the CBB Player-Score exactly: the same weights, the same
 * clipped min-max bounds, the same [2/3, 4/3] multiplier band.
 *
 * `game` is the per-game variant. It differs in exactly four documented ways,
 * each traceable to a finding in the audit:
 *   1. wider bounds on the counting stats, which saturate in a single game
 *   2. shrinkage enabled for the shooting percentages
 *   3. a minutes gate, so a DNP scores 0
 *   4. the multiplier is fed opponent strength rather than own-team strength
 */

const WEIGHTS = {
  lead:  { scoring: 16, shooting: 21, playmaking: 24, defense: 14, rebounding: 5,  efficiency: 20 },
  combo: { scoring: 18, shooting: 25, playmaking: 16, defense: 14, rebounding: 7,  efficiency: 20 },
  wing:  { scoring: 17, shooting: 23, playmaking: 11, defense: 19, rebounding: 10, efficiency: 20 },
  swing: { scoring: 17, shooting: 19, playmaking: 8,  defense: 21, rebounding: 16, efficiency: 21 },
  big:   { scoring: 15, shooting: 14, playmaking: 7,  defense: 22, rebounding: 20, efficiency: 20 },
} as const;

const POSITION_MAP = {
  "Scoring PG": "lead",
  "Pure PG": "lead",
  "Combo G": "combo",
  "Wing G": "combo",
  "Wing F": "wing",
  "Stretch 4": "swing",
  "PF/C": "big",
  "C": "big",
} as const;

/** Bounds shared by both configs — the rate stats, which do not saturate per game. */
const RATE_BOUNDS = {
  effectiveFieldGoalPct: { min: 40, max: 60 },
  threePointPct:         { min: 0.15, max: 0.45 },
  freeThrowPct:          { min: 0.55, max: 0.90 },
  trueShootingPct:       { min: 40, max: 65 },
  usage:                 { min: 5, max: 30 },
  assistPct:             { min: 5, max: 40 },
  turnoverPct:           { min: 10, max: 40 },
  stealPct:              { min: 0.5, max: 10 },
  blockPct:              { min: 1, max: 15 },
  defensiveRating:       { min: 85, max: 110 },
  offensiveReboundPct:   { min: 2, max: 20 },
  defensiveReboundPct:   { min: 7.5, max: 35 },
  bpm:                   { min: -5, max: 15 },
  obpm:                  { min: -4, max: 9 },
  dbpm:                  { min: -2, max: 6.5 },
  porpag:                { min: 0, max: 6 },
} as const;

export const SEASON_CONFIG: ScoringConfig = {
  weights: WEIGHTS,
  positionMap: POSITION_MAP,
  fallbackArchetype: "wing",
  bounds: {
    ...RATE_BOUNDS,
    points:   { min: 5, max: 20 },
    rebounds: { min: 0.5, max: 10 },
    assists:  { min: 1, max: 8 },
  },
  multiplier: { floor: 2 / 3, span: 2 / 3 },
  minutesGate: 0,
  shrinkagePriorAttempts: 0,
  normaliseWeights: false,
};

/**
 * Per-game config. Bounds refit from the p99.9 of 20,116 player-games across 12
 * game days, which drops points clipping from 7.0% under the season bounds to
 * 0.1%. Audit finding 01: under the season bounds, 67 players on one night
 * scored 20+ ranging from 20 to 38, and every one maxed the scoring block.
 */
export const GAME_CONFIG: ScoringConfig = {
  ...SEASON_CONFIG,
  bounds: {
    ...RATE_BOUNDS,
    points:   { min: 0, max: 37 },
    rebounds: { min: 0, max: 16 },
    assists:  { min: 0, max: 11 },
  },
  // Torvik's own per-game BPM is wildly unstable in short stints — a 6-minute
  // cameo with an empty stat line can post BPM 17.7, which clips the efficiency
  // block at full credit. The Python model already haircuts below 10 minutes;
  // the per-game score needs the same ramp for the same reason.
  minutesGate: 10,
  // A prior of 6 leaves a 1-for-1 three at .469, still above the .45 bound, so
  // it clips at full credit anyway. 10 pulls it to .436 and the term responds.
  shrinkagePriorAttempts: 10,
  normaliseWeights: false,
};
