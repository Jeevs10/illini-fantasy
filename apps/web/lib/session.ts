import { cache } from "react";
import { redirect } from "next/navigation";
import { membershipsFor, type Membership } from "@illini/league";
import { auth } from "../auth.ts";
import { db } from "./db.ts";

export interface Viewer {
  userId: number;
  email: string;
  name: string;
  membership: Membership;
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
  | { state: "no-league"; userId: number; email: string; name: string }
  | { state: "member"; viewer: Viewer };

export const who = cache(async (): Promise<Who> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { state: "anonymous" };

  const userId = Number(user.id);
  const email = user.email ?? "";
  const name = user.name ?? "";

  const memberships = await membershipsFor(db, userId);
  const membership = memberships[0];
  if (!membership) return { state: "no-league", userId, email, name };

  return { state: "member", viewer: { userId, email, name, membership } };
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
