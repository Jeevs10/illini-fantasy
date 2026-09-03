import type { Archetype } from "@illini/scoring";

/** Roster slots. FLEX takes anyone; BENCH and IR never score. */
export type Slot = "G" | "F" | "C" | "FLEX" | "BENCH" | "IR";

export interface LeagueSettings {
  /** Starting slots and how many of each. Order matters for auto-fill. */
  starters: { slot: Exclude<Slot, "BENCH" | "IR">; count: number }[];
  bench: number;
  ir: number;
  /**
   * Most games a team may start in one scoring period. College schedules are
   * uneven — some teams play twice a week, some once — so without a cap the
   * matchup is decided by whose players happened to have a heavier slate.
   */
  gamesCap: number;
  periodDays: number;
}

export const DEFAULT_SETTINGS: LeagueSettings = {
  starters: [
    { slot: "G", count: 2 },
    { slot: "F", count: 2 },
    { slot: "C", count: 1 },
    { slot: "FLEX", count: 2 },
  ],
  bench: 5,
  ir: 1,
  gamesCap: 9,
  periodDays: 7,
};

/**
 * Which slots a player is eligible for.
 *
 * Derived from the archetype the scoring model already assigns, so eligibility
 * and scoring can never disagree about what a player is.
 */
const SLOTS_BY_ARCHETYPE: Record<Archetype, Slot[]> = {
  lead:  ["G", "FLEX"],
  combo: ["G", "FLEX"],
  wing:  ["F", "FLEX"],
  swing: ["F", "C", "FLEX"],   // stretch fours cover both
  big:   ["C", "F", "FLEX"],
};

export function eligibleSlots(archetype: Archetype): Slot[] {
  return SLOTS_BY_ARCHETYPE[archetype];
}

export function isEligible(archetype: Archetype, slot: Slot): boolean {
  if (slot === "BENCH" || slot === "IR") return true;
  return SLOTS_BY_ARCHETYPE[archetype].includes(slot);
}

export interface LineupSlot {
  playerId: number;
  archetype: Archetype;
  slot: Slot;
}

export interface Violation {
  slot: Slot;
  message: string;
}

/** Checks a proposed lineup against the league's slots. */
export function validateLineup(
  lineup: LineupSlot[], settings: LeagueSettings = DEFAULT_SETTINGS,
): Violation[] {
  const violations: Violation[] = [];
  const counts = new Map<Slot, number>();
  for (const entry of lineup) counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1);

  for (const { slot, count } of settings.starters) {
    const filled = counts.get(slot) ?? 0;
    if (filled > count) {
      violations.push({ slot, message: `${filled} players in ${slot}, room for ${count}` });
    }
  }

  const bench = counts.get("BENCH") ?? 0;
  if (bench > settings.bench) {
    violations.push({ slot: "BENCH", message: `${bench} on the bench, room for ${settings.bench}` });
  }

  for (const entry of lineup) {
    if (!isEligible(entry.archetype, entry.slot)) {
      violations.push({
        slot: entry.slot,
        message: `a ${entry.archetype} cannot start at ${entry.slot}`,
      });
    }
  }

  const seen = new Set<number>();
  for (const entry of lineup) {
    if (seen.has(entry.playerId)) {
      violations.push({ slot: entry.slot, message: `player ${entry.playerId} is in two slots` });
    }
    seen.add(entry.playerId);
  }
  return violations;
}

/** Fills the starting slots greedily from the scarcest position outward. */
export function autoFill(
  roster: { playerId: number; archetype: Archetype; projected: number }[],
  settings: LeagueSettings = DEFAULT_SETTINGS,
): LineupSlot[] {
  const remaining = [...roster].sort((a, b) => b.projected - a.projected);
  const lineup: LineupSlot[] = [];

  // Fill the most restrictive slots first — FLEX last, since anyone can take it.
  const order = [...settings.starters].sort((a, b) => {
    const scarcity = (s: Slot) => (s === "FLEX" ? 99 : Object.values(SLOTS_BY_ARCHETYPE)
      .filter((slots) => slots.includes(s)).length);
    return scarcity(a.slot) - scarcity(b.slot);
  });

  for (const { slot, count } of order) {
    for (let i = 0; i < count; i += 1) {
      const index = remaining.findIndex((p) => isEligible(p.archetype, slot));
      if (index < 0) break;
      lineup.push({ playerId: remaining[index]!.playerId, archetype: remaining[index]!.archetype, slot });
      remaining.splice(index, 1);
    }
  }
  for (const p of remaining) lineup.push({ playerId: p.playerId, archetype: p.archetype, slot: "BENCH" });
  return lineup;
}
