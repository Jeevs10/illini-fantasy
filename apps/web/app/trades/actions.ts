"use server";

import { revalidatePath } from "next/cache";
import {
  EmptyTradeError, NotTradeableError, NotYourTradeError, TradeClosedError, TradeDeadlineError,
  TradeRosterError, cancelTrade, proposeTrade, respondToTrade, vetoTrade,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewNow } from "../../lib/session.ts";

export interface TradeActionState {
  error?: string;
  ok?: string;
  /** Which result is the most recent — several actions share one notice region. */
  at?: number;
}

const now = () => Date.now();

/**
 * Trades run on the app's clock, the same as waivers and for the same reason.
 *
 * A trade writes a dated tenure on both sides and is read back against the
 * pinned date the rest of the app browses. Take the wall clock and a deal made
 * in a pinned February season executes in September, which is to say the
 * players never change hands on any night anybody can see.
 */
async function acting() {
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId } = viewer.membership;
  if (fantasyTeamId === null) return null;
  return { viewer, leagueId, fantasyTeamId, now: viewNow() };
}

const NO_TEAM = { error: "You do not run a team in this league, so you have nobody to trade." };

/** A trade changes two rosters, so every screen that shows one has to be refreshed. */
function refresh() {
  revalidatePath("/trades");
  revalidatePath("/team");
  revalidatePath("/players");
  revalidatePath("/league");
}

const ids = (form: FormData, field: string) =>
  form.getAll(field).map(Number).filter((n) => Number.isInteger(n));

const DEADLINE_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
});

/** The deadline, worded. Both callers say the same day and a different verb. */
const closedSince = (deadline: string) =>
  DEADLINE_DAY.format(new Date(`${deadline}T12:00:00Z`));

export async function offer(
  _state: TradeActionState, formData: FormData,
): Promise<TradeActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  const toTeamId = Number(formData.get("toTeamId"));
  if (!Number.isInteger(toTeamId) || toTeamId === act.fantasyTeamId) {
    return { error: "Pick a team to trade with.", at: now() };
  }

  try {
    const trade = await proposeTrade(db, {
      leagueId: act.leagueId, fromTeamId: act.fantasyTeamId, toTeamId,
      gives: ids(formData, "give"), gets: ids(formData, "get"),
      message: String(formData.get("message") ?? ""),
      byUserId: act.viewer.userId, now: act.now,
    });
    refresh();
    return {
      ok: `Offer sent to ${trade.to.teamName}. Nothing moves unless they accept it.`,
      at: now(),
    };
  } catch (error) {
    if (error instanceof EmptyTradeError) {
      return { error: "A trade has to move at least one player.", at: now() };
    }
    if (error instanceof NotTradeableError) {
      return {
        error: "Somebody in that offer has changed hands since the page loaded. Reload and try again.",
        at: now(),
      };
    }
    if (error instanceof TradeDeadlineError) {
      return {
        error: `Trading closed after ${closedSince(error.deadline)}.`,
        at: now(),
      };
    }
    throw error;
  }
}

export async function respond(
  _state: TradeActionState, formData: FormData,
): Promise<TradeActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  const accept = formData.get("answer") === "accept";
  try {
    const trade = await respondToTrade(db, {
      tradeId: Number(formData.get("tradeId")), fantasyTeamId: act.fantasyTeamId,
      accept, now: act.now,
    });
    refresh();
    return {
      ok: accept
        ? `Agreed with ${trade.from.teamName}. The league can see it until it executes; ` +
          "after that the players are yours."
        : `Turned down ${trade.from.teamName}.`,
      at: now(),
    };
  } catch (error) {
    if (error instanceof TradeClosedError) {
      return { error: `That offer is ${error.status} — it can no longer be answered.`, at: now() };
    }
    if (error instanceof NotYourTradeError) {
      return { error: "That offer was not made to you.", at: now() };
    }
    if (error instanceof TradeRosterError) {
      return {
        error: `${error.teamName} would hold ${error.size} players and the limit is ` +
          `${error.limit}. Drop somebody, or ask for a smaller deal.`,
        at: now(),
      };
    }
    if (error instanceof NotTradeableError) {
      return { error: "Somebody in that offer is no longer on the roster that put him up.", at: now() };
    }
    if (error instanceof TradeDeadlineError) {
      return {
        error: `Trading closed after ${closedSince(error.deadline)}, so this can no longer ` +
          "be agreed. Turning it down still works.",
        at: now(),
      };
    }
    throw error;
  }
}

export async function withdraw(
  _state: TradeActionState, formData: FormData,
): Promise<TradeActionState> {
  const act = await acting();
  if (!act) return { ...NO_TEAM, at: now() };

  try {
    await cancelTrade(db, {
      tradeId: Number(formData.get("tradeId")), fantasyTeamId: act.fantasyTeamId, now: act.now,
    });
    refresh();
    return { ok: "Offer withdrawn.", at: now() };
  } catch (error) {
    if (error instanceof TradeClosedError) {
      return { error: `That offer is already ${error.status}.`, at: now() };
    }
    if (error instanceof NotYourTradeError) {
      return { error: "That offer is not yours to withdraw.", at: now() };
    }
    throw error;
  }
}

/**
 * Stops an agreed trade before the players move.
 *
 * The data layer refuses a non-commissioner on its own — `vetoTrade` calls
 * `requireCommissioner` — so the check here is about giving them a sentence
 * rather than a stack trace.
 */
export async function veto(
  _state: TradeActionState, formData: FormData,
): Promise<TradeActionState> {
  const viewer = await requireViewer();
  if (viewer.membership.role !== "commissioner") {
    return { error: "Only the commissioner can veto a trade.", at: now() };
  }

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length === 0) {
    // A veto is the most contested thing a commissioner does, and one delivered
    // without a sentence is why leagues argue about vetoes.
    return { error: "Say why. A veto without a reason is the thing leagues fall out over.", at: now() };
  }

  try {
    const trade = await vetoTrade(db, {
      tradeId: Number(formData.get("tradeId")), byUserId: viewer.userId,
      reason, now: viewNow(),
    });
    refresh();
    return {
      ok: `${trade.from.teamName} and ${trade.to.teamName} have been told the deal is off.`,
      at: now(),
    };
  } catch (error) {
    if (error instanceof TradeClosedError) {
      return {
        error: error.status === "executed"
          ? "That trade has already executed. Undoing it would rewrite nights that have been scored."
          : `That trade is ${error.status}.`,
        at: now(),
      };
    }
    throw error;
  }
}
