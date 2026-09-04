import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { membershipsFor, type Membership } from "@illini/league";
import { sessionUser } from "./auth.ts";
import { db } from "./db.ts";

/** The cookie naming which league the viewer is currently looking at. */
export const LEAGUE_COOKIE = "illini_league";

export interface Viewer {
  userId: number;
  username: string;
  email: string;
  name: string;
  /** The league being viewed. */
  membership: Membership;
  /** Every league the viewer belongs to, so the nav can offer the others. */
  memberships: Membership[];
}

/**
 * Who is asking: nobody, somebody with no league yet, or a manager.
 *
 * Signed in with no league is a real state — an invite exists but has not been
 * redeemed — and is worth telling apart from signed out, since the two want
 * different pages.
 *
 * `cache` scopes the lookup to one request, so the layout can ask for the
 * viewer's role to decide what to put in the nav without costing a second
 * round trip on top of the page's own call.
 */
export type Who =
  | { state: "anonymous" }
  | { state: "no-league"; userId: number; username: string; email: string; name: string }
  | { state: "member"; viewer: Viewer };

export const who = cache(async (): Promise<Who> => {
  const user = await sessionUser();
  if (!user) return { state: "anonymous" };

  const { id: userId, username, email, name } = user;

  const memberships = await membershipsFor(db, userId);
  if (memberships.length === 0) {
    return { state: "no-league", userId, username, email, name };
  }

  // Which league, when there is more than one. The cookie is a preference, not
  // an authorisation: the chosen league has to be one the viewer is actually a
  // member of, so a hand-edited cookie selects nothing rather than something
  // else's data.
  const preferred = Number((await cookies()).get(LEAGUE_COOKIE)?.value);
  const membership = memberships.find((m) => m.leagueId === preferred) ?? memberships[0]!;

  return {
    state: "member",
    viewer: { userId, username, email, name, membership, memberships },
  };
});

/** The signed-in manager and the league they are looking at. */
export async function requireViewer(): Promise<Viewer> {
  const found = await who();
  if (found.state === "anonymous") redirect("/signin");
  if (found.state === "no-league") redirect("/no-league");
  return found.viewer;
}

/** The date the app treats as today. Overridable so a finished season is browsable. */
export function viewDate(searchParam?: string): string {
  if (searchParam && /^\d{4}-\d{2}-\d{2}$/.test(searchParam)) return searchParam;
  return today();
}

function today(): string {
  return process.env.ILLINI_TODAY ?? new Date().toISOString().slice(0, 10);
}

/**
 * The clock the lock is measured against.
 *
 * This has to move with `viewDate`. Pinning the date for a demo season while
 * leaving the clock on the real wall time makes every pinned night look like
 * ancient history, so every game reads as tipped off and the lineup controls
 * never render at all — the app looks finished and is inert.
 *
 * Browsing to another date with `?date=` deliberately does *not* move the
 * clock: a past night should be locked and a future one open, which is what
 * comparing real tip-offs to the real clock already gives you.
 */
export function viewNow(): Date {
  const pinned = process.env.ILLINI_NOW;
  if (pinned) {
    const parsed = new Date(pinned);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  // A pinned date with no pinned clock keeps the real time of day, so a demo
  // slate locks through the evening the way a real one does.
  if (process.env.ILLINI_TODAY) {
    const now = new Date();
    return new Date(`${process.env.ILLINI_TODAY}T${now.toISOString().slice(11)}`);
  }
  return new Date();
}
