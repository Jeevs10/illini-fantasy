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
  if (fantasyTeamId === null) return { error: "You do not manage a team in this league." };

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
      return { error: "That game has tipped off — the slot is locked for the night." };
    }
    if (error instanceof InvalidLineupError) return { error: error.message };
    if (error instanceof NotOnRosterError) return { error: "That player is not on your roster." };
    throw error;
  }

  revalidatePath("/team");
  return { ok: "Lineup saved." };
}

/** Fills whatever is still open, best projection first. */
export async function autoFill(
  _state: LineupState, formData: FormData,
): Promise<LineupState> {
  const viewer = await requireViewer();
  const { fantasyTeamId, configId, settings } = viewer.membership;
  if (fantasyTeamId === null) return { error: "You do not manage a team in this league." };

  const day = String(formData.get("day") ?? "");
  const result = await autoFillDay(db, { fantasyTeamId, day, configId, settings, now: viewNow() });
  revalidatePath("/team");

  const started = result.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR").length;
  return { ok: `Auto-filled — ${started} starting, ${result.locked.length} already locked.` };
}
