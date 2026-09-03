/** Position archetypes the CBB model weights against. */
export type Archetype = "lead" | "combo" | "wing" | "swing" | "big";

export type BlockName =
  | "scoring" | "shooting" | "playmaking"
  | "defense" | "rebounding" | "efficiency";

/** A single scale bound: value is clipped to [min,max] then normalised to 0..1. */
export interface Bound { min: number; max: number }

export interface ScoringConfig {
  /** Per-archetype block weights. Each archetype's weights sum to 100. */
  weights: Record<Archetype, Record<BlockName, number>>;
  /** Torvik `role` string -> archetype. Unknown roles fall back to `fallbackArchetype`. */
  positionMap: Record<string, Archetype>;
  fallbackArchetype: Archetype;
  /** Every clipped min-max bound in the model, named so they can be refit as data. */
  bounds: Record<string, Bound>;
  /** Context multiplier band. Torvik's model uses 2/3..4/3. */
  multiplier: { floor: number; span: number };
  /** Below this many minutes the score is scaled linearly toward zero. */
  minutesGate: number;
  /**
   * The source model's `swing` weights sum to 102 and `big` to 98, so those two
   * archetypes are scored out of different totals — a 4.1% structural gap.
   * Leave false to reproduce the CBB Player-Score exactly; set true to divide
   * each archetype's weights by their own sum first.
   */
  normaliseWeights: boolean;
  /** Empirical-Bayes prior weight, in attempts, for shrinking one-game rates. */
  shrinkagePriorAttempts: number;
}

/** The model inputs for one player in one game (or one season window). */
export interface PlayerLine {
  playerId: string;
  name: string;
  team: string;
  conference: string;
  role: string | null;

  minutes: number;
  points: number;
  rebounds: number;
  assists: number;

  effectiveFieldGoalPct: number;   // 0..100
  trueShootingPct: number;         // 0..100
  threePointPct: number;           // 0..1
  freeThrowPct: number;            // 0..1
  usage: number;                   // 0..100

  assistPct: number;
  turnoverPct: number;
  stealPct: number;
  blockPct: number;
  defensiveRating: number;
  offensiveReboundPct: number;
  defensiveReboundPct: number;

  bpm: number;
  obpm: number;
  dbpm: number;
  porpag: number;

  /** Attempts, used only for shrinkage. Optional: absent means no shrinkage. */
  attempts?: { three: number; freeThrow: number; fieldGoal: number };
  /** The player's season rates, shrunk toward. Absent means no shrinkage. */
  seasonRates?: {
    effectiveFieldGoalPct: number;
    trueShootingPct: number;
    threePointPct: number;
    freeThrowPct: number;
  };
}

export interface ScoredLine {
  playerId: string;
  name: string;
  team: string;
  archetype: Archetype;
  blocks: Record<BlockName, number>;
  /** Weighted sum before the context multiplier and minutes gate. */
  raw: number;
  multiplier: number;
  /** Final Game Score. */
  score: number;
}
