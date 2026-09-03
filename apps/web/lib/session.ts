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
 * The signed-in manager and the league they are looking at.
 *
 * A viewer with no league is a real state — an invite exists but has not been
 * redeemed — and is sent somewhere that says so rather than to an empty page.
 */
export async function requireViewer(): Promise<Viewer> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) redirect("/signin");

  const memberships = await membershipsFor(db, Number(user.id));
  const membership = memberships[0];
  if (!membership) redirect("/no-league");

  return {
    userId: Number(user.id),
    email: user.email ?? "",
    name: user.name ?? "",
    membership,
  };
}

/** The date the app treats as today. Overridable so a finished season is browsable. */
export function viewDate(searchParam?: string): string {
  if (searchParam && /^\d{4}-\d{2}-\d{2}$/.test(searchParam)) return searchParam;
  return process.env.ILLINI_TODAY ?? new Date().toISOString().slice(0, 10);
}
