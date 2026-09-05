"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession } from "../lib/auth.ts";

/**
 * Signing out, in one place.
 *
 * The session is a row, so this deletes it rather than only dropping a cookie:
 * a browser left signed in on somebody else's machine stops being signed in
 * everywhere, not just here.
 *
 * A module-level "use server" rather than the function-body form: this file
 * is imported straight into `ProfileMenu`, a Client Component, and Next only
 * allows that when the whole module is a server actions file — an inline
 * directive on the function is only visible to Server Component importers.
 */
export async function signOutAction(): Promise<void> {
  await endSession();
  revalidatePath("/", "layout");
  redirect("/signin");
}
