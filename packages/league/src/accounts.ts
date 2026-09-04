import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Queryable } from "./membership.ts";

/**
 * Usernames and passwords.
 *
 * The league used to sign people in with a magic link, on the reasoning that in
 * a private twenty-person league the invite and the sign-in are the same
 * mechanism. That reasoning holds right up until you want to sign in and the
 * mail does not arrive — a league is played on a phone at 11pm, and a round
 * trip through an inbox is a worse door than a password manager.
 *
 * So: a username and a password, stored here. The invite link stays, because it
 * is how a commissioner hands over a *team*; what it hands over now is the
 * chance to pick a username, not a session.
 *
 * One thing genuinely got weaker and is worth naming. A magic link proved the
 * holder owned the mailbox the invite named. Nothing proves that any more, so
 * the invite token is the whole credential: whoever opens the link claims the
 * seat. For a link the commissioner passes to somebody they know, that is the
 * trade being made deliberately.
 */

const scrypt = promisify(scryptCallback) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** scrypt at the parameters Node documents as interactive-login cost. */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_BYTES = 64;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 8;
/** Kept in one place so the form, the CLI and the CHECK constraint agree. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,23}$/;
export const USERNAME_RULE =
  "3 to 24 characters: letters, numbers, and . _ - after the first.";

export interface Account {
  id: number;
  username: string;
  email: string;
  displayName: string;
}

interface AccountRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
}

const COLUMNS = "id, username, email, display_name";

const toAccount = (row: AccountRow): Account => ({
  id: Number(row.id),
  username: row.username,
  email: row.email,
  displayName: row.display_name,
});

/** Case and surrounding space are not part of a username. */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The reason a username is unusable, or null if it is fine. */
export function usernameProblem(raw: string): string | null {
  const username = normaliseUsername(raw);
  if (username.length < USERNAME_MIN) return `Too short — ${USERNAME_RULE}`;
  if (username.length > USERNAME_MAX) return `Too long — ${USERNAME_RULE}`;
  if (!USERNAME_PATTERN.test(username)) return `Not a usable username — ${USERNAME_RULE}`;
  return null;
}

/**
 * The reason a password is unusable, or null.
 *
 * Length only. Composition rules ("one number, one symbol") push people toward
 * `Password1!` and away from the long unmemorable string a password manager
 * would have generated, which is the opposite of what this wants.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Passwords are at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > 200) return "That password is implausibly long.";
  return null;
}

/**
 * Hashes a password for storage.
 *
 * `scrypt$N$r$p$salt$hash`, so the cost parameters travel with the hash and
 * raising them later leaves every existing password verifiable.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_BYTES, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p,
    salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time check of a password against a stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(expected, actual);
}

/**
 * A hash of nothing, verified against when no such user exists.
 *
 * Without it, a wrong username returns in microseconds and a wrong password
 * takes ~100ms, which turns the sign-in form into a list of who has an account.
 */
const ABSENT = hashPassword(randomBytes(32).toString("hex"));

/**
 * Signs somebody in, or returns null.
 *
 * Deliberately one answer for "no such username" and "wrong password": telling
 * them apart only helps somebody working through a list of names.
 */
export async function authenticate(
  db: Queryable, { username, password }: { username: string; password: string },
): Promise<Account | null> {
  const { rows } = await db.query<AccountRow & { password_hash: string | null }>(
    `SELECT ${COLUMNS}, password_hash FROM app_user WHERE username = $1`,
    [normaliseUsername(username)],
  );
  const row = rows[0];
  if (!row?.password_hash) {
    await verifyPassword(password, await ABSENT);
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? toAccount(row) : null;
}

export async function accountById(db: Queryable, id: number): Promise<Account | null> {
  const { rows } = await db.query<AccountRow>(
    `SELECT ${COLUMNS} FROM app_user WHERE id = $1`, [id]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function accountByUsername(
  db: Queryable, username: string,
): Promise<Account | null> {
  const { rows } = await db.query<AccountRow>(
    `SELECT ${COLUMNS} FROM app_user WHERE username = $1`, [normaliseUsername(username)]);
  return rows[0] ? toAccount(rows[0]) : null;
}

/** Whether an address can already sign in — the join page needs to know. */
export async function accountByEmail(db: Queryable, email: string): Promise<Account | null> {
  const { rows } = await db.query<AccountRow>(
    `SELECT ${COLUMNS} FROM app_user WHERE email = $1 AND password_hash IS NOT NULL`,
    [email.trim().toLowerCase()]);
  return rows[0] ? toAccount(rows[0]) : null;
}

/** Thrown for the two failures a registration form has to be able to explain. */
export class AccountTaken extends Error {
  constructor(readonly field: "username" | "email") {
    super(`that ${field} is already registered`);
    this.name = "AccountTaken";
  }
}

/**
 * Creates an account, or adopts the seat a commissioner already made for it.
 *
 * `app_user` rows exist before anybody signs in — `league create` makes the
 * commissioner, and an invite is addressed to an email that may already be a
 * row. Registering against one of those adopts it rather than failing, so the
 * league membership and the login are the same person. A row that already has
 * a password is somebody else's account and is refused.
 */
export async function registerAccount(
  db: Queryable,
  { username, password, email, displayName }: {
    username: string; password: string; email: string; displayName?: string;
  },
): Promise<Account> {
  const name = normaliseUsername(username);
  const problem = usernameProblem(name) ?? passwordProblem(password);
  if (problem) throw new Error(problem);

  const address = email.trim().toLowerCase();
  const hash = await hashPassword(password);

  const { rows: existing } = await db.query<{ id: string; password_hash: string | null }>(
    "SELECT id, password_hash FROM app_user WHERE email = $1", [address]);
  if (existing[0]?.password_hash) throw new AccountTaken("email");

  const { rows: taken } = await db.query<{ email: string }>(
    "SELECT email FROM app_user WHERE username = $1", [name]);
  if (taken[0] && taken[0].email !== address) throw new AccountTaken("username");

  try {
    // $3 is null when the form left the name blank. A new row falls back to the
    // local part of the address; an existing one keeps the name it already has,
    // which is the one the commissioner typed when they made the seat.
    const { rows } = await db.query<AccountRow>(
      `INSERT INTO app_user (email, username, display_name, password_hash)
       VALUES ($1, $2, COALESCE($3, split_part($1, '@', 1)), $4)
       ON CONFLICT (email) DO UPDATE SET
         username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash,
         display_name = COALESCE($3, app_user.display_name)
       RETURNING ${COLUMNS}`,
      [address, name, displayName?.trim() || null, hash],
    );
    return toAccount(rows[0]!);
  } catch (error) {
    // Two people can pick the same username between the check above and the
    // insert. The unique index is the real arbiter; this only translates its
    // answer into the one the form knows how to say.
    if ((error as { code?: string }).code === "23505") throw new AccountTaken("username");
    throw error;
  }
}

/** Sets or replaces a password. The commissioner's reset, and the CLI's. */
export async function setPassword(
  db: Queryable, { userId, password }: { userId: number; password: string },
): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  await db.query("UPDATE app_user SET password_hash = $2 WHERE id = $1",
    [userId, await hashPassword(password)]);
}

/**
 * Changes a password, given the current one.
 *
 * Returns false rather than throwing when the old password is wrong: from a
 * settings form that is an answer, not an exception.
 */
export async function changePassword(
  db: Queryable,
  { userId, current, next }: { userId: number; current: string; next: string },
): Promise<boolean> {
  const problem = passwordProblem(next);
  if (problem) throw new Error(problem);

  const { rows } = await db.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM app_user WHERE id = $1", [userId]);
  const hash = rows[0]?.password_hash;
  if (!hash || !(await verifyPassword(current, hash))) return false;

  await setPassword(db, { userId, password: next });
  return true;
}

/** Renames an account. Throws `AccountTaken` if somebody else holds the name. */
export async function setUsername(
  db: Queryable, { userId, username }: { userId: number; username: string },
): Promise<Account> {
  const name = normaliseUsername(username);
  const problem = usernameProblem(name);
  if (problem) throw new Error(problem);

  const { rows: taken } = await db.query<{ id: string }>(
    "SELECT id FROM app_user WHERE username = $1", [name]);
  if (taken[0] && Number(taken[0].id) !== userId) throw new AccountTaken("username");

  const { rows } = await db.query<AccountRow>(
    `UPDATE app_user SET username = $2 WHERE id = $1 RETURNING ${COLUMNS}`, [userId, name]);
  return toAccount(rows[0]!);
}
