"use server";

import { revalidatePath } from "next/cache";
import {
  DraftNotLiveError, NotOnTheClockError, PlayerUnavailableError, RosterFullError,
  autoDraft, createDraft, dequeue, enqueue, makePick, moveInQueue, pauseDraft, startDraft,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";

export interface DraftState {
  error?: string;
  ok?: string;
  /** Which result is the most recent — several actions share one notice region. */
  at?: number;
}

const now = () => Date.now();

/**
 * The draft runs on the real clock, not the pinned one.
 *
 * `viewNow` exists so a finished season can be browsed with the lineup lock
 * behaving as it did that night. A draft is the opposite kind of event: it is
 * happening, now, and a frozen clock would mean no deadline ever passes and no
 * autopick is ever made. Every draft path takes the wall clock deliberately.
 */
export async function pick(_state: DraftState, formData: FormData): Promise<DraftState> {
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId } = viewer.membership;
  if (fantasyTeamId === null) {
    return { error: "You do not manage a team in this league.", at: now() };
  }
  const playerId = Number(formData.get("playerId"));

  try {
    const made = await makePick(db, {
      leagueId, fantasyTeamId, playerId, byUserId: viewer.userId,
    });
    revalidatePath("/draft");
    return { ok: `Pick ${made.overall} — ${made.playerName}.`, at: now() };
  } catch (error) {
    revalidatePath("/draft");
    if (error instanceof NotOnTheClockError) {
      return { error: `${error.onTheClockTeamName} is on the clock.`, at: now() };
    }
    if (error instanceof PlayerUnavailableError) {
      return { error: `${error.byTeamName} took him first.`, at: now() };
    }
    if (error instanceof DraftNotLiveError) {
      return { error: `The draft is ${error.status}.`, at: now() };
    }
    if (error instanceof RosterFullError) {
      return { error: "Your roster is full.", at: now() };
    }
    throw error;
  }
}

export async function queuePlayer(_state: DraftState, formData: FormData): Promise<DraftState> {
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId } = viewer.membership;
  if (fantasyTeamId === null) return { error: "You do not manage a team here.", at: now() };

  const playerId = Number(formData.get("playerId"));
  const name = String(formData.get("name") ?? "That player");
  const added = await enqueue(db, { leagueId, fantasyTeamId, playerId });
  revalidatePath("/draft");
  return added
    ? { ok: `${name} added to your queue.`, at: now() }
    : { ok: `${name} is already in your queue.`, at: now() };
}

export async function unqueuePlayer(_state: DraftState, formData: FormData): Promise<DraftState> {
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId } = viewer.membership;
  if (fantasyTeamId === null) return { error: "You do not manage a team here.", at: now() };

  await dequeue(db, { leagueId, fantasyTeamId, playerId: Number(formData.get("playerId")) });
  revalidatePath("/draft");
  return { ok: "Removed from your queue.", at: now() };
}

export async function moveQueued(_state: DraftState, formData: FormData): Promise<DraftState> {
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId } = viewer.membership;
  if (fantasyTeamId === null) return { error: "You do not manage a team here.", at: now() };

  await moveInQueue(db, {
    leagueId, fantasyTeamId,
    playerId: Number(formData.get("playerId")),
    direction: formData.get("direction") === "up" ? "up" : "down",
  });
  revalidatePath("/draft");
  return { at: now() };
}

// ---------------------------------------------------------------------------
// Commissioner
// ---------------------------------------------------------------------------

async function commissioner() {
  const viewer = await requireViewer();
  if (viewer.membership.role !== "commissioner") return null;
  return viewer;
}

export async function setUpDraft(_state: DraftState, formData: FormData): Promise<DraftState> {
  const viewer = await commissioner();
  if (!viewer) return { error: "Only the commissioner can set up the draft.", at: now() };

  const rounds = Number(formData.get("rounds"));
  const pickSeconds = Number(formData.get("pickSeconds"));
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 30) {
    return { error: "Rounds has to be between 1 and 30.", at: now() };
  }
  if (!Number.isInteger(pickSeconds) || pickSeconds < 0 || pickSeconds > 3600) {
    return { error: "The clock has to be between 0 seconds and an hour.", at: now() };
  }

  try {
    const draft = await createDraft(db, {
      leagueId: viewer.membership.leagueId, by: viewer.userId, rounds, pickSeconds,
    });
    revalidatePath("/draft");
    return {
      ok: `${draft.rounds} rounds, ${draft.totalPicks} picks. The order has been drawn.`,
      at: now(),
    };
  } catch (error) {
    return { error: (error as Error).message, at: now() };
  }
}

export async function runClock(_state: DraftState, formData: FormData): Promise<DraftState> {
  const viewer = await commissioner();
  if (!viewer) return { error: "Only the commissioner can run the clock.", at: now() };
  const leagueId = viewer.membership.leagueId;
  const action = String(formData.get("action"));

  try {
    if (action === "pause") {
      await pauseDraft(db, { leagueId, by: viewer.userId });
      revalidatePath("/draft");
      return { ok: "Clock stopped. Nobody is on a deadline.", at: now() };
    }
    if (action === "finish") {
      // The escape hatch: half the league never showed up, and the season needs
      // rosters more than it needs their attendance.
      const made = await autoDraft(db, { leagueId });
      revalidatePath("/draft");
      return { ok: `Auto-picked the remaining ${made} selections.`, at: now() };
    }
    const draft = await startDraft(db, { leagueId, by: viewer.userId });
    revalidatePath("/draft");
    return {
      ok: draft.pickSeconds > 0
        ? `The draft is live — ${draft.pickSeconds} seconds a pick.`
        : "The draft is live, with no clock.",
      at: now(),
    };
  } catch (error) {
    return { error: (error as Error).message, at: now() };
  }
}
