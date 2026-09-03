"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { acceptInvite } from "@illini/league";
import { auth, signIn } from "../../../auth.ts";
import { db } from "../../../lib/db.ts";

export interface JoinState {
  error?: string;
}

/**
 * Redeems an invite for the signed-in address.
 *
 * The email is taken from the session rather than from a form field, which is
 * the whole reason this route insists on signing in first: a magic link is
 * proof that the person holding the invite also holds the mailbox it was
 * addressed to. `acceptInvite` compares the two at fixed length and refuses a
 * mismatch, so a stolen link is worth nothing without the inbox.
 */
export async function redeem(_state: JoinState, formData: FormData): Promise<JoinState> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Your session expired. Sign in again and reopen the link." };

  const token = String(formData.get("token") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();

  try {
    await acceptInvite(db, { token, email, displayName: displayName || undefined });
  } catch (error) {
    // The seat can be taken between rendering this page and submitting it —
    // that is the same race the transaction exists to lose safely — so the
    // failure is reported rather than thrown at a manager as a stack trace.
    const message = error instanceof Error ? error.message : "";
    if (/expired/.test(message)) return { error: "This invite has expired. Ask for a new link." };
    if (/different email/.test(message)) {
      return { error: `This invite was not issued to ${email}.` };
    }
    if (/no unclaimed team/.test(message)) {
      return { error: "Every team in this league has been claimed. Tell your commissioner." };
    }
    if (/not found|already used|revoked/.test(message)) {
      return { error: "This link has already been used, or was revoked." };
    }
    console.error("redeem failed", error);
    return { error: "The invite could not be redeemed." };
  }

  // The layout renders the joiner's name and, for a commissioner, their nav —
  // both of which this call just changed. Without revalidating it, the client
  // router replays the layout it cached a moment ago and the new manager lands
  // on their team under the placeholder name the magic link gave them.
  revalidatePath("/", "layout");
  redirect("/team");
}

/** Sends the magic link and comes back here, so the invite survives signing in. */
export async function signInToJoin(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "");
  await signIn("resend", { email, redirectTo: `/join/${encodeURIComponent(token)}` });
}
