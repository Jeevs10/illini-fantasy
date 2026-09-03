"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LEAGUE_COOKIE, requireViewer } from "../lib/session.ts";

/**
 * Points the whole app at another of the viewer's leagues.
 *
 * The cookie is only ever a preference — `who` resolves it against the
 * viewer's real memberships and falls back rather than trusting it — so the
 * check here is about refusing a nonsense value early, not about access.
 *
 * Revalidates the layout, not just the page: the league name and the
 * commissioner link both live in the masthead, and without this the router
 * replays the nav it cached for the league you just left.
 */
export async function switchLeague(formData: FormData): Promise<void> {
  const viewer = await requireViewer();
  const leagueId = Number(formData.get("leagueId"));
  if (!viewer.memberships.some((m) => m.leagueId === leagueId)) return;

  (await cookies()).set(LEAGUE_COOKIE, String(leagueId), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
