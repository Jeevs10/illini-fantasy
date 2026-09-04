"use server";

import { revalidatePath } from "next/cache";
import {
  InvalidLineupError, LineupLockedError, NotOnRosterError,
  autoFillDay, setLineup, type Slot,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewNow } from "../../lib/session.ts";

export interface LineupState {
  error?: string;
  ok?: string;
  /** When it happened, so the screen can show the later of two answers. */
  at?: number;
}

/**
 * A lineup violation, said the way a manager would say it.
 *
 * `validateLineup` speaks in slots and counts because it is checking a rule.
 * The manager is not checking a rule — they clicked one control and want to
 * know why it did not take. The bench case is the one they will actually hit:
 * a full roster on a night everybody plays has nowhere to sit anybody.
 */
function humanise(error: InvalidLineupError, settings: { bench: number }): string {
  const bench = error.violations.find((v) => v.slot === "BENCH");
  if (bench) {
    return `Your bench is full — there are ${settings.bench} seats and that would need ${settings.bench + 1}. `
      + "Start him somewhere else, or drop somebody on the waivers page.";
  }
  const over = error.violations.find((v) => v.message.includes("room for"));
  if (over) return `That slot is already taken — ${over.message}.`;
  return error.message;
}

/**
 * Moves one player into one slot.
 *
 * A single move rather than a whole-lineup submit, because the payload is a
 * patch: naming only what changed is what keeps a stale page from benching
 * someone who tipped off while it was open.
 */
export async function moveToSlot(
  _state: LineupState, formData: FormData,
): Promise<LineupState> {
  const viewer = await requireViewer();
  const { fantasyTeamId, configId, settings } = viewer.membership;
  if (fantasyTeamId === null) return { error: "You do not manage a team in this league.", at: Date.now() };

  const day = String(formData.get("day") ?? "");
  const playerId = Number(formData.get("playerId"));
  const slot = String(formData.get("slot") ?? "") as Slot;

  try {
    await setLineup(db, {
      fantasyTeamId, day, configId, settings, now: viewNow(),
      entries: [{ playerId, slot }],
    });
  } catch (error) {
    if (error instanceof LineupLockedError) {
      return { error: "That game has tipped off — the slot is locked for the night.", at: Date.now() };
    }
    if (error instanceof InvalidLineupError) {
      return { error: humanise(error, settings), at: Date.now() };
    }
    if (error instanceof NotOnRosterError) {
      return { error: "That player is not on your roster.", at: Date.now() };
    }
    throw error;
  }

  revalidatePath("/team");
  return { ok: "Lineup saved.", at: Date.now() };
}

/** Fills whatever is still open, best projection first. */
export async function autoFill(
  _state: LineupState, formData: FormData,
): Promise<LineupState> {
  const viewer = await requireViewer();
  const { fantasyTeamId, configId, settings } = viewer.membership;
  if (fantasyTeamId === null) return { error: "You do not manage a team in this league.", at: Date.now() };

  const day = String(formData.get("day") ?? "");
  const result = await autoFillDay(db, { fantasyTeamId, day, configId, settings, now: viewNow() });
  revalidatePath("/team");

  const started = result.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR").length;
  return { ok: `Auto-filled — ${started} starting, ${result.locked.length} already locked.`, at: Date.now() };
}
