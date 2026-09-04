import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db.ts";

/**
 * Sessions, as rows.
 *
 * This replaced Auth.js, which is not a small thing to do lightly — but the
 * league signs people in with a username and a password now, and Auth.js only
 * supports credentials alongside JWT sessions. That would have meant throwing
 * away `auth_session` and with it the ability to end somebody's session from
 * the database: a signed token is valid until it expires, whatever the server
 * later thinks of it.
 *
 * What is left is small enough to read in one sitting. A session is 32 random
 * bytes in an httpOnly cookie and a row naming who it belongs to; signing out
 * deletes the row, so a lost phone is one DELETE away from being harmless.
 */

export const SESSION_COOKIE = "illini_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  name: string;
}

/**
 * Who the cookie belongs to, or null.
 *
 * Expiry is checked in the WHERE clause rather than in Node: a row that has run
 * out is not a user, and asking Postgres means the comparison happens against
 * one clock instead of two.
 */
export async function sessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { rows } = await db.query<{
    id: string; username: string; email: string; display_name: string;
  }>(
    `SELECT u.id, u.username, u.email, u.display_name
       FROM auth_session s JOIN app_user u ON u.id = s.user_id
      WHERE s.session_token = $1 AND s.expires > now()`,
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    name: row.display_name,
  };
}

/**
 * Issues a session and sets the cookie. Only callable from a Server Action or
 * a Route Handler — Next refuses cookie writes during a render, which is the
 * right rule and the reason nothing here slides the expiry on read.
 */
export async function startSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  // Cheap enough to do on every sign-in, and it keeps the table from being a
  // growing list of every browser anybody ever used.
  await db.query("DELETE FROM auth_session WHERE expires < now()");
  await db.query(
    "INSERT INTO auth_session (session_token, user_id, expires) VALUES ($1, $2, $3)",
    [token, userId, expires],
  );

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

/** Ends the session this browser holds, in the database and in the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.query("DELETE FROM auth_session WHERE session_token = $1", [token]);
  jar.delete(SESSION_COOKIE);
}

/**
 * Where to go after signing in.
 *
 * Only same-origin paths: a `next` that starts with `//` or a scheme is an open
 * redirect, and the sign-in page is exactly the place somebody would try one.
 */
export function safeNext(next: string | undefined, fallback = "/home"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
