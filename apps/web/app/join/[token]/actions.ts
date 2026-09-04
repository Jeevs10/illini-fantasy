"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AccountTaken, acceptInvite, inviteByToken, registerAccount, usernameProblem, passwordProblem,
} from "@illini/league";
import { db } from "../../../lib/db.ts";
import { endSession, sessionUser, startSession } from "../../../lib/auth.ts";

export interface JoinState {
  error?: string;
}

/** The message an `acceptInvite` failure should show a manager, not a stack trace. */
function explain(error: unknown, email: string): string {
  const message = error instanceof Error ? error.message : "";
  if (/expired/.test(message)) return "This invite has expired. Ask for a new link.";
  if (/different email/.test(message)) return `This invite was not issued to ${email}.`;
  if (/no unclaimed team/.test(message)) {
    return "Every team in this league has been claimed. Tell your commissioner.";
  }
  if (/not found|already used|revoked/.test(message)) {
    return "This link has already been used, or was revoked.";
  }
  console.error("redeem failed", error);
  return "The invite could not be redeemed.";
}

/**
 * Redeems an invite for the signed-in account.
 *
 * The email is taken from the session rather than from a form field, and
 * `acceptInvite` compares it against the address the invite was issued to. That
 * check used to be the security of the whole thing — a magic link proved the
 * mailbox. It no longer proves anything, and is kept because it still catches
 * the real mistake: redeeming somebody else's link while signed in as yourself.
 */
export async function redeem(_state: JoinState, formData: FormData): Promise<JoinState> {
  const user = await sessionUser();
  if (!user) return { error: "Your session expired. Sign in again and reopen the link." };

  const token = String(formData.get("token") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();

  try {
    await acceptInvite(db, { token, email: user.email, displayName: displayName || undefined });
  } catch (error) {
    // The seat can be taken between rendering this page and submitting it —
    // that is the same race the transaction exists to lose safely.
    return { error: explain(error, user.email) };
  }

  // The layout renders the joiner's name and, for a commissioner, their nav —
  // both of which this call just changed.
  revalidatePath("/", "layout");
  redirect("/team");
}

/**
 * The whole of joining, for somebody who has never been here: pick a username
 * and a password, take the team, and arrive signed in.
 *
 * The account is registered against the invite's address rather than one the
 * form collects. There is nothing to gain from asking for an email again — the
 * commissioner already named it, and letting it be edited would only let a
 * manager put their account beyond the reach of the invite that made it.
 */
export async function registerAndJoin(
  _state: JoinState, formData: FormData,
): Promise<JoinState> {
  const token = String(formData.get("token") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();

  const problem = usernameProblem(username) ?? passwordProblem(password);
  if (problem) return { error: problem };

  const invite = await inviteByToken(db, token);
  if (!invite) return { error: "This link has already been used, or was revoked." };
  if (invite.expired) return { error: "This invite has expired. Ask for a new link." };

  let account;
  try {
    account = await registerAccount(db, {
      username, password, email: invite.email, displayName: displayName || undefined,
    });
  } catch (error) {
    if (error instanceof AccountTaken) {
      return error.field === "username"
        ? { error: `${username} is taken. Pick another.` }
        : { error: `${invite.email} already has an account. Sign in instead.` };
    }
    return { error: error instanceof Error ? error.message : "The account could not be created." };
  }

  try {
    await acceptInvite(db, { token, email: invite.email, displayName: displayName || undefined });
  } catch (error) {
    // The account survives a failed redemption on purpose: it is the thing the
    // manager just chose a password for, and telling them to sign in is a
    // better ending than silently discarding it.
    return {
      error: `${explain(error, invite.email)} Your account was created — sign in as ${username}.`,
    };
  }

  await startSession(account.id);
  revalidatePath("/", "layout");
  redirect("/team");
}

/** Signing out from the join page, when the wrong account is holding the browser. */
export async function signOutToJoin(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await endSession();
  revalidatePath("/", "layout");
  redirect(`/join/${encodeURIComponent(token)}`);
}
