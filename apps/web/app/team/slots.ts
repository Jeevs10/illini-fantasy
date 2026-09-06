import type { LeagueSettings, Slot } from "@illini/league";

/**
 * The starting lineup as positions, not as a player list.
 *
 * The roster is what a manager owns; the lineup is what they set. Rendering the
 * roster sorted by projection with the slot in a column makes an unfilled
 * position invisible — the one thing they came to the page to check.
 *
 * It lives here rather than beside the component so the server can total the
 * week from the same assignment the browser draws. It used not to matter: a
 * night has one lineup and everything in a starting slot was starting. A period
 * can disagree with itself — rows written a night at a time, under the old
 * nightly lineup, can leave nine players holding a "G" between them — and when
 * the header counted every non-bench slot while the table showed only the seven
 * that fit, the two numbers on one screen were both defensible and different.
 * Whoever fits the slots is starting; that is the only answer either should give.
 */
export interface SlotRow<P extends { playerId: number; slot: string }> {
  key: string;
  slot: Slot;
  player: P | null;
}

/**
 * `slot` is widened to `string` because the matchup screen lays its two
 * rosters out through this too, and what it holds is a `PlayerWeek` — a slot
 * read back off a `lineup_entry` row, which the database types as text. The
 * comparison is the same either way, and the row still names a real league
 * slot: that comes from the settings, not from the player.
 */
export function buildSlots<P extends { playerId: number; slot: string }>(
  startable: P[], settings: LeagueSettings,
): SlotRow<P>[] {
  const pool = [...startable];
  const rows: SlotRow<P>[] = [];
  for (const { slot, count } of settings.starters) {
    for (let i = 0; i < count; i += 1) {
      const index = pool.findIndex((p) => p.slot === slot);
      rows.push({ key: `${slot}-${i}`, slot, player: index < 0 ? null : pool.splice(index, 1)[0]! });
    }
  }
  return rows;
}
