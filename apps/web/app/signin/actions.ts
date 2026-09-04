"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authenticate } from "@illini/league";
import { db } from "../../lib/db.ts";
import { safeNext, startSession } from "../../lib/auth.ts";

export interface SignInState {
  error?: string;
}

/**
 * Username and password in, session out.
 *
 * One error for every way this fails. "No such user" and "wrong password" are
 * the same sentence on purpose — told apart, the form becomes a way to find out
 * who is in the league.
 */
export async function signInWithPassword(
  _state: SignInState, formData: FormData,
): Promise<SignInState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "") || undefined);

  if (!username || !password) return { error: "Enter your username and password." };

  const account = await authenticate(db, { username, password });
  if (!account) return { error: "That username and password do not match an account." };

  await startSession(account.id);

  // The masthead renders the signed-in name and, for a commissioner, extra nav.
  // Without this the client router replays the signed-out layout it cached a
  // moment ago and the manager lands on their team with no way back out of it.
  revalidatePath("/", "layout");
  redirect(next);
}
