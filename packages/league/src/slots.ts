/** Roster slots. FLEX takes anyone; BENCH and IR never score. */
export type Slot = "G" | "F" | "B" | "FLEX" | "BENCH" | "IR";

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
  /**
   * Free Agent Acquisition Budget, for the whole season. Bids are whole
   * dollars: a blind auction settled to the cent invites a tiebreak nobody
   * intended, and every league that has tried it ends up rounding anyway.
   */
  faabBudget: number;
  /** The hour, UTC, at which sealed bids are opened. */
  waiverHour: number;
  /**
   * How long a dropped player sits on the wire before he is an ordinary free
   * agent. Measured in days from the drop; he clears at the first run after
   * that, so the wait is never shorter than this and never longer than a day
   * more.
   */
  waiverDays: number;
  /**
   * How long an offer stands before it goes stale. Measured in days from the
   * proposal: an offer nobody ever answered is not a live deal, and leaving it
   * open all season means a manager can accept in March something that was fair
   * in December.
   */
  tradeOfferDays: number;
  /**
   * How long an accepted trade sits in the open before the players move.
   *
   * The window is the whole point of it. Both managers have already agreed, so
   * nothing here is about them — it is the rest of the league's chance to see
   * what was agreed, and the commissioner's chance to stop it. Zero means a
   * trade executes as soon as it is accepted, which is a league that trusts
   * itself and is a legitimate way to run one.
   */
  tradeReviewHours: number;
  /**
   * The last day on which a trade may be *agreed*, or null for no deadline.
   *
   * A date rather than a count of days, because a deadline is a fixture of the
   * season and not of the offer: every league closes trading at the same
   * moment, and "three days from now" is a different moment for everybody.
   *
   * It binds the handshake and not the execution. A deal agreed on deadline day
   * still executes when its review window closes, which may be the day after —
   * the window belongs to the league and the commissioner, and voiding a deal
   * two managers legitimately agreed to because somebody else's review period
   * straddled midnight would punish them for a setting they do not control.
   */
  tradeDeadline: string | null;
}

export const DEFAULT_SETTINGS: LeagueSettings = {
  starters: [
    { slot: "G", count: 2 },
    { slot: "F", count: 2 },
    { slot: "B", count: 1 },
    { slot: "FLEX", count: 2 },
  ],
  bench: 5,
  ir: 1,
  gamesCap: 9,
  periodDays: 7,
  faabBudget: 100,
  // 09:00 UTC — 4am Eastern, 1am Pacific. The same dead band migration 005
  // picked for the game date, and for the same reason: no college game is
  // under way, so a run never lands in the middle of a night's scoring.
  waiverHour: 9,
  waiverDays: 1,
  tradeOfferDays: 3,
  // A day. Long enough that the league sees the deal before it happens, short
  // enough that a manager who traded for tonight's slate still gets him this
  // week — a three-day window in a sport that plays Tuesday and Saturday means
  // trading for a player you cannot start.
  tradeReviewHours: 24,
  // No deadline until a commissioner sets one. A league that has never thought
  // about it should not discover in March that trading closed in February.
  tradeDeadline: null,
};

/**
 * The three positions a lineup slot actually cares about — not the six-way
 * scoring archetype, and not the eight strings Torvik hands back for a role.
 *
 * Named `PositionRole` rather than `Role` because this package already has one
 * — `membership.ts`'s commissioner/manager — and the two must not collide in
 * the barrel export.
 *
 * A Wing G plays guard and forward; a PF/C plays forward and centre. Neither
 * is one role, which is why this is `PositionRole[]` rather than
 * `PositionRole` — the split the archetype cannot represent, because `combo`
 * and `big` each cover two of these at once.
 */
export type PositionRole = "G" | "F" | "B";

/**
 * The Torvik role string to what it means for a lineup, verbatim from that
 * one column. Anything not listed here — an unfamiliar string, or no role at
 * all — is unknown rather than guessed, and `rolesFor` returns nothing for it.
 */
const ROLE_MAP: Record<string, PositionRole[]> = {
  "Pure PG": ["G"],
  "Scoring PG": ["G"],
  "Combo G": ["G"],
  "Wing G": ["G", "F"],
  "Wing F": ["F"],
  "Stretch 4": ["F"],
  "PF/C": ["F", "B"],
  "C": ["B"],
};

export function rolesFor(role: string | null): PositionRole[] {
  return role === null ? [] : ROLE_MAP[role] ?? [];
}

/** Every Torvik role string this app recognises — the reverse of `rolesFor`. */
export const KNOWN_ROLES: string[] = Object.keys(ROLE_MAP);

const SLOTS_BY_ROLE: Record<PositionRole, Slot[]> = {
  G: ["G", "FLEX"],
  F: ["F", "FLEX"],
  B: ["B", "FLEX"],
};

/**
 * Which slots a player is eligible for.
 *
 * Derived from the Torvik role string, so eligibility answers to the same
 * source the position label on screen does. A role this app does not
 * recognise — or none at all — is FLEX-only rather than a guess: better an
 * honest "anywhere" than a wrong "here".
 */
export function eligibleSlots(role: string | null): Slot[] {
  const roles = rolesFor(role);
  if (roles.length === 0) return ["FLEX"];
  const slots = new Set<Slot>();
  for (const r of roles) for (const s of SLOTS_BY_ROLE[r]) slots.add(s);
  return [...slots];
}

export function isEligible(role: string | null, slot: Slot): boolean {
  if (slot === "BENCH" || slot === "IR") return true;
  return eligibleSlots(role).includes(slot);
}

export interface LineupSlot {
  playerId: number;
  role: string | null;
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
    if (!isEligible(entry.role, entry.slot)) {
      violations.push({
        slot: entry.slot,
        message: entry.role === null
          ? `a player with no known role cannot start at ${entry.slot}`
          : `a ${entry.role} cannot start at ${entry.slot}`,
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
  roster: { playerId: number; role: string | null; projected: number }[],
  settings: LeagueSettings = DEFAULT_SETTINGS,
): LineupSlot[] {
  const remaining = [...roster].sort((a, b) => b.projected - a.projected);
  const lineup: LineupSlot[] = [];

  // Fill the most restrictive slots first — FLEX last, since anyone can take it.
  const order = [...settings.starters].sort((a, b) => {
    const scarcity = (s: Slot) => (s === "FLEX" ? 99 : Object.values(SLOTS_BY_ROLE)
      .filter((slots) => slots.includes(s)).length);
    return scarcity(a.slot) - scarcity(b.slot);
  });

  for (const { slot, count } of order) {
    for (let i = 0; i < count; i += 1) {
      const index = remaining.findIndex((p) => isEligible(p.role, slot));
      if (index < 0) break;
      lineup.push({ playerId: remaining[index]!.playerId, role: remaining[index]!.role, slot });
      remaining.splice(index, 1);
    }
  }
  for (const p of remaining) lineup.push({ playerId: p.playerId, role: p.role, slot: "BENCH" });
  return lineup;
}
