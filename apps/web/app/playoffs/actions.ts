"use server";

import { revalidatePath } from "next/cache";
import { BracketExistsError, BracketRefusedError, createBracket } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";

export interface DrawState {
  error?: string;
  ok?: string;
  at?: number;
}

/**
 * Draws the bracket. Unlike the draft's clock, this reads no time of its
 * own — it is a one-shot action a commissioner takes once the standings it
 * seeds from are the ones that should count.
 */
export async function drawBracket(_state: DrawState, _formData: FormData): Promise<DrawState> {
  const viewer = await requireViewer();
  const { leagueId, role } = viewer.membership;
  if (role !== "commissioner") {
    return { error: "Only the commissioner can draw the bracket.", at: Date.now() };
  }

  try {
    const created = await createBracket(db, { leagueId, by: viewer.userId });
    revalidatePath("/playoffs");
    return {
      ok: `The bracket is drawn: ${created.winners.rounds.length} round` +
        `${created.winners.rounds.length === 1 ? "" : "s"}` +
        `${created.consolation ? ", plus a consolation bracket" : ""}.`,
      at: Date.now(),
    };
  } catch (error) {
    if (error instanceof BracketExistsError) {
      return { error: "This league already has a bracket.", at: Date.now() };
    }
    if (error instanceof BracketRefusedError) {
      return { error: error.reasons.join(" "), at: Date.now() };
    }
    console.error("drawing the bracket failed", error);
    return { error: "The bracket could not be drawn.", at: Date.now() };
  }
}
