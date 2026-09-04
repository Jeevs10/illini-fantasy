"use server";

import { revalidatePath } from "next/cache";
import {
  AlreadyRosteredError, BudgetExceededError, NotOnWaiversError, NotYourPlayerError,
  OnWaiversError, RosterFullError,
  addFreeAgent, cancelClaim, dropPlayer, moveClaim, submitClaim,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewNow } from "../../lib/session.ts";

export interface WaiverActionState {
  error?: string;
  ok?: string;
  /** Which result is the most recent — several actions share one notice region. */
  at?: number;
}

const now = () => Date.now();

/**
 * Waivers run on the app's clock, not the wall clock.
 *
 * This is the opposite of the draft, and for a reason worth stating. A draft
 * writes rosters dated by the draft's own `opens_on`, so pinning its clock only
 * ever stops the deadline passing. A waiver claim writes a dated tenure and is
 * read back against the same pinned date the rest of the app browses — take the
 * wall clock here and a drop in a pinned February season is dated September,
 * which is to say the player never leaves the roster on any night anybody can
 * see.
 */
async function acting() {
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId } = viewer.membership;
  if (fantasyTeamId === null) return null;
  return { viewer, leagueId, fantasyTeamId, now: viewNow() };
}

const NO_TEAM = { error: "You do not manage a team in this league.", at: 0 };

/** Every screen that can change a roster shows the result of one on another. */
function refresh() {
  revalidatePath("/waivers");
  revalidatePath("/team");
  revalidatePath("/players");
}

export async function bid(
  _state: WaiverActionState, formData: FormData,
): Promise<WaiverActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  const playerId = Number(formData.get("playerId"));
  const name = String(formData.get("name") ?? "That player");
  const amount = Number(formData.get("bid"));
  const dropRaw = String(formData.get("dropPlayerId") ?? "");
  const dropPlayerId = dropRaw === "" ? null : Number(dropRaw);

  if (!Number.isInteger(amount) || amount < 0) {
    return { error: "A bid is a whole number of dollars, zero or more.", at: now() };
  }

  try {
    const claim = await submitClaim(db, {
      leagueId: act.leagueId, fantasyTeamId: act.fantasyTeamId, playerId,
      bid: amount, dropPlayerId, byUserId: act.viewer.userId, now: act.now,
    });
    refresh();
    return {
      ok: `$${claim.bid} on ${name}${claim.dropPlayerName ? `, dropping ${claim.dropPlayerName}` : ""}. ` +
        "Nobody else can see it until the bids are opened.",
      at: now(),
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { error: `You have $${error.remaining} left.`, at: now() };
    }
    if (error instanceof NotOnWaiversError) {
      return { error: `${name} is a free agent — add him outright instead.`, at: now() };
    }
    if (error instanceof AlreadyRosteredError) {
      return { error: `${error.byTeamName} already has him.`, at: now() };
    }
    if (error instanceof NotYourPlayerError) {
      return { error: "You cannot drop a player you do not own.", at: now() };
    }
    throw error;
  }
}

export async function withdraw(
  _state: WaiverActionState, formData: FormData,
): Promise<WaiverActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  const pulled = await cancelClaim(db, {
    fantasyTeamId: act.fantasyTeamId, claimId: Number(formData.get("claimId")),
  });
  refresh();
  return pulled
    ? { ok: "Claim withdrawn.", at: now() }
    : { error: "That claim has already been settled.", at: now() };
}

export async function reorder(
  _state: WaiverActionState, formData: FormData,
): Promise<WaiverActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  await moveClaim(db, {
    fantasyTeamId: act.fantasyTeamId,
    claimId: Number(formData.get("claimId")),
    direction: formData.get("direction") === "up" ? "up" : "down",
  });
  refresh();
  return { at: now() };
}

export async function add(
  _state: WaiverActionState, formData: FormData,
): Promise<WaiverActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  const playerId = Number(formData.get("playerId"));
  const name = String(formData.get("name") ?? "That player");
  const dropRaw = String(formData.get("dropPlayerId") ?? "");

  try {
    await addFreeAgent(db, {
      leagueId: act.leagueId, fantasyTeamId: act.fantasyTeamId, playerId,
      dropPlayerId: dropRaw === "" ? null : Number(dropRaw),
      byUserId: act.viewer.userId, now: act.now,
    });
    refresh();
    return { ok: `${name} added.`, at: now() };
  } catch (error) {
    if (error instanceof OnWaiversError) {
      return {
        error: `${name} is on waivers — put a bid in rather than adding him.`,
        at: now(),
      };
    }
    if (error instanceof AlreadyRosteredError) {
      return { error: `${error.byTeamName} got there first.`, at: now() };
    }
    if (error instanceof RosterFullError) {
      return { error: "Your roster is full — name somebody to drop.", at: now() };
    }
    if (error instanceof NotYourPlayerError) {
      return { error: "You cannot drop a player you do not own.", at: now() };
    }
    throw error;
  }
}

export async function drop(
  _state: WaiverActionState, formData: FormData,
): Promise<WaiverActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  const playerId = Number(formData.get("playerId"));
  const name = String(formData.get("name") ?? "That player");

  try {
    await dropPlayer(db, {
      leagueId: act.leagueId, fantasyTeamId: act.fantasyTeamId, playerId, now: act.now,
    });
    refresh();
    return {
      ok: `${name} dropped. He is on waivers, not back in the pool — anyone who wants him bids.`,
      at: now(),
    };
  } catch (error) {
    if (error instanceof NotYourPlayerError) {
      return { error: `${name} is not on your roster.`, at: now() };
    }
    throw error;
  }
}
