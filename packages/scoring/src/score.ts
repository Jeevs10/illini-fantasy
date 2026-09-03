import type {
  Archetype, BlockName, PlayerLine, ScoredLine, ScoringConfig,
} from "./types.ts";

/** Clip to [min,max] then normalise to 0..1. Torvik's `scale()`. */
export function scale(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 0;
  return (Math.min(Math.max(value, min), max) - min) / (max - min);
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Empirical-Bayes shrinkage toward a season rate.
 * Audit finding 02: on one night 46 players went 1-for-1 from three and maxed
 * the 3P% term; 156 were perfect on <=2 free-throw attempts.
 */
function shrink(
  observed: number, attempts: number, seasonRate: number, prior: number,
): number {
  if (prior <= 0 || !Number.isFinite(seasonRate)) return observed;
  const n = Math.max(attempts, 0);
  return (observed * n + seasonRate * prior) / (n + prior);
}

export function archetypeFor(role: string | null, cfg: ScoringConfig): Archetype {
  if (role && role in cfg.positionMap) return cfg.positionMap[role]!;
  return cfg.fallbackArchetype;
}

/** Compute the six 0..1 blocks for one line. */
export function computeBlocks(
  line: PlayerLine, cfg: ScoringConfig,
): Record<BlockName, number> {
  const b = cfg.bounds;
  const s = (v: number, key: string): number => {
    const bound = b[key];
    if (!bound) throw new Error(`missing bound: ${key}`);
    return scale(v, bound.min, bound.max);
  };

  const prior = cfg.shrinkagePriorAttempts;
  const sr = line.seasonRates;
  const at = line.attempts;
  const shootingRate = (
    observed: number, attempts: number | undefined, season: number | undefined,
  ): number => (sr && at && season !== undefined && attempts !== undefined)
    ? shrink(observed, attempts, season, prior)
    : observed;

  const eFG = shootingRate(line.effectiveFieldGoalPct, at?.fieldGoal, sr?.effectiveFieldGoalPct);
  const ts  = shootingRate(line.trueShootingPct,       at?.fieldGoal, sr?.trueShootingPct);
  const tp  = shootingRate(line.threePointPct,         at?.three,     sr?.threePointPct);
  const ft  = shootingRate(line.freeThrowPct,          at?.freeThrow, sr?.freeThrowPct);

  const usageGate = 0.5 + 0.5 * s(line.usage, "usage");

  // Audit finding 03: `1 - scale(x)` returns full credit when x is 0, so a
  // player who used no possessions banked a third of the playmaking block for
  // committing no turnovers. Gate the inverted terms on actual opportunity —
  // possessions used, not minutes stood on the floor.
  const usedPossessions = line.usage > 0;
  const invTurnover = usedPossessions ? 1 - s(line.turnoverPct, "turnoverPct") : 0;
  const invDefRating = line.defensiveRating > 0 ? 1 - s(line.defensiveRating, "defensiveRating") : 0;

  // Shrinkage returns the prior when there is no evidence, which credits a
  // player's season shooting to a game in which they never shot. No attempts,
  // no shooting block.
  const totalAttempts = at ? at.fieldGoal + at.freeThrow : Number.POSITIVE_INFINITY;
  const attempted = totalAttempts > 0;

  return {
    scoring: s(line.points, "points"),

    shooting: attempted
      ? mean([
          s(eFG, "effectiveFieldGoalPct"),
          s(tp, "threePointPct"),
          s(ft, "freeThrowPct"),
          s(ts, "trueShootingPct"),
        ]) * usageGate
      : 0,

    playmaking: mean([
      s(line.assists, "assists"),
      s(line.assistPct, "assistPct"),
      invTurnover,
    ]),

    defense: mean([
      s(line.stealPct, "stealPct"),
      s(line.blockPct, "blockPct"),
      invDefRating,
    ]),

    rebounding: mean([
      s(line.rebounds, "rebounds"),
      s(line.offensiveReboundPct, "offensiveReboundPct"),
      s(line.defensiveReboundPct, "defensiveReboundPct"),
    ]),

    efficiency: mean([
      s(line.bpm, "bpm"),
      s(line.obpm, "obpm"),
      s(line.dbpm, "dbpm"),
      s(line.porpag, "porpag"),
    ]),
  };
}

/**
 * Map a 0..1 strength rating into the multiplier band.
 * Season model: mean of own conference and own team strength.
 * Game model:   opponent strength, per the decision in section 03 of the plan.
 */
export function contextMultiplier(strength01: number, cfg: ScoringConfig): number {
  return cfg.multiplier.floor + scale(strength01, 0, 1) * cfg.multiplier.span;
}

export function scoreLine(
  line: PlayerLine, cfg: ScoringConfig, multiplier = 1,
): ScoredLine {
  const archetype = archetypeFor(line.role, cfg);
  const weights = cfg.weights[archetype];
  const blocks = computeBlocks(line, cfg);

  const total = (Object.values(weights) as number[]).reduce((a, b) => a + b, 0);
  const divisor = cfg.normaliseWeights ? total / 100 : 1;

  let raw = 0;
  for (const key of Object.keys(weights) as BlockName[]) {
    raw += (weights[key] / divisor) * blocks[key];
  }

  const gate = cfg.minutesGate > 0
    ? Math.min(1, line.minutes / cfg.minutesGate)
    : 1;

  return {
    playerId: line.playerId,
    name: line.name,
    team: line.team,
    archetype,
    blocks,
    raw,
    multiplier,
    score: raw * multiplier * gate,
  };
}
