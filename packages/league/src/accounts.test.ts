import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, migrate, type Db } from "@illini/db";
import {
  AccountTaken, accountByEmail, accountById, accountByUsername, authenticate, changePassword,
  hashPassword, normaliseUsername, passwordProblem, registerAccount, setPassword, setUsername,
  usernameProblem, verifyPassword,
} from "./accounts.ts";
import { suggestUsername, upsertUser } from "./membership.ts";

let db: Db;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_account_test");
  await admin.query("CREATE DATABASE illini_account_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_account_test");
  await migrate(db);
});

after(async () => { await db?.end(); });

test("a hash is salted, so the same password twice looks different", async () => {
  const [a, b] = await Promise.all([hashPassword("correct horse"), hashPassword("correct horse")]);
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("correct horse", a));
  assert.ok(await verifyPassword("correct horse", b));
  assert.equal(await verifyPassword("Correct horse", a), false);
});

test("the cost parameters travel with the hash", async () => {
  const hash = await hashPassword("a password");
  const [scheme, n, r, p] = hash.split("$");
  assert.equal(scheme, "scrypt");
  assert.deepEqual([n, r, p], ["16384", "8", "1"]);
});

test("a stored value that is not a hash verifies nothing", async () => {
  for (const junk of ["", "hunter2", "bcrypt$1$2$3$4$5", "scrypt$16384$8$1"]) {
    assert.equal(await verifyPassword("hunter2", junk), false, junk);
  }
});

test("usernames are lowercased, and bounded", () => {
  assert.equal(normaliseUsername("  Coach.Sanjiv  "), "coach.sanjiv");
  assert.equal(usernameProblem("Coach.Sanjiv"), null);
  assert.equal(usernameProblem("a_b-c.d9"), null);
  assert.ok(usernameProblem("ab"), "two characters is too short");
  assert.ok(usernameProblem("x".repeat(25)), "twenty-five is too long");
  assert.ok(usernameProblem(".leading"), "punctuation cannot lead");
  assert.ok(usernameProblem("has space"), "spaces are not in the alphabet");
  assert.ok(usernameProblem("email@host"), "nor is @");
});

test("passwords are judged on length and nothing else", () => {
  assert.ok(passwordProblem("short1!"));
  assert.equal(passwordProblem("a passphrase with no digits at all"), null);
});

test("registering makes an account that can sign in", async () => {
  const account = await registerAccount(db, {
    username: "Deron", password: "orange and blue", email: "Deron@Illini.test",
    displayName: "Deron W",
  });
  assert.equal(account.username, "deron", "the name is normalised");
  assert.equal(account.email, "deron@illini.test", "so is the address");

  const signedIn = await authenticate(db, { username: "DERON", password: "orange and blue" });
  assert.deepEqual(signedIn, account, "case in the form does not matter");

  assert.equal(await authenticate(db, { username: "deron", password: "wrong" }), null);
  assert.equal(await authenticate(db, { username: "nobody", password: "orange and blue" }), null,
    "an unknown username is the same answer as a wrong password");
});

test("a seat the commissioner made is adopted, not duplicated", async () => {
  // This is the join flow: `league create` and `acceptInvite` both mint rows
  // with no password, and registering against that address has to land on the
  // same user id the league membership already points at.
  const seat = await upsertUser(db, { email: "seat@illini.test", displayName: "Seat" });
  assert.ok(seat.username, "a row always has a username, even with no password");
  assert.equal(await authenticate(db, { username: seat.username, password: "" }), null,
    "with no password set, nothing signs in");

  const account = await registerAccount(db, {
    username: "brad", password: "underwood 2026", email: "seat@illini.test",
  });
  assert.equal(account.id, seat.id, "the same person, now with a password");
  assert.equal(account.displayName, "Seat", "and the name the commissioner gave them");
});

test("an address with a password cannot be registered over", async () => {
  await assert.rejects(
    () => registerAccount(db,
      { username: "impostor", password: "let me in please", email: "deron@illini.test" }),
    (error: unknown) => error instanceof AccountTaken && error.field === "email");
});

test("a username belongs to one person", async () => {
  await assert.rejects(
    () => registerAccount(db,
      { username: "Deron", password: "a different password", email: "other@illini.test" }),
    (error: unknown) => error instanceof AccountTaken && error.field === "username");
});

test("registering refuses a username or password the form would have caught", async () => {
  await assert.rejects(() => registerAccount(db,
    { username: "no", password: "long enough", email: "short@illini.test" }), /Too short/);
  await assert.rejects(() => registerAccount(db,
    { username: "fine", password: "short", email: "short@illini.test" }), /at least 8/);
});

test("a derived username sidesteps the one already taken", async () => {
  // Two leagues, two people, one local part: coach@a and coach@b.
  const first = await upsertUser(db, { email: "coach@one.test" });
  const second = await upsertUser(db, { email: "coach@two.test" });
  assert.equal(first.username, "coach");
  assert.equal(second.username, "coach2");
  assert.notEqual(await suggestUsername(db, "coach@three.test"), "coach2");
});

test("a local part too short to be a username becomes one anyway", async () => {
  const { username } = await upsertUser(db, { email: "jb@illini.test" });
  assert.equal(usernameProblem(username), null, `${username} is a legal username`);
});

test("a commissioner reset replaces the password without touching anything else", async () => {
  const before = (await accountByUsername(db, "deron"))!;
  await setPassword(db, { userId: before.id, password: "a fresh password" });

  assert.equal(await authenticate(db, { username: "deron", password: "orange and blue" }), null);
  assert.deepEqual(await authenticate(db, { username: "deron", password: "a fresh password" }),
    before, "same account, new password");
});

test("changing a password needs the current one", async () => {
  const account = (await accountByUsername(db, "deron"))!;
  assert.equal(
    await changePassword(db, { userId: account.id, current: "guessing", next: "a newer one" }),
    false);
  assert.ok(
    await changePassword(db, { userId: account.id, current: "a fresh password", next: "a newer one" }));
  assert.ok(await authenticate(db, { username: "deron", password: "a newer one" }));
});

test("renaming keeps the account and refuses a taken name", async () => {
  const account = (await accountByUsername(db, "brad"))!;
  const renamed = await setUsername(db, { userId: account.id, username: "CoachB" });
  assert.equal(renamed.username, "coachb");
  assert.equal(await accountByUsername(db, "brad"), null);
  assert.ok(await authenticate(db, { username: "coachb", password: "underwood 2026" }),
    "the password survives the rename");

  await assert.rejects(() => setUsername(db, { userId: account.id, username: "deron" }),
    (error: unknown) => error instanceof AccountTaken);
});

test("lookups find an account by id, username and address", async () => {
  const account = (await accountByUsername(db, "deron"))!;
  assert.deepEqual(await accountById(db, account.id), account);
  assert.deepEqual(await accountByEmail(db, "Deron@illini.test "), account);
  assert.equal(await accountByEmail(db, "coach@one.test"), null,
    "an address with no password has no account to sign in to");
});

test("the database refuses a username the module would have rejected", async () => {
  // The CHECK constraint is the backstop for anything that writes SQL directly,
  // including a migration backfill.
  await assert.rejects(
    () => db.query("UPDATE app_user SET username = 'Bad Name' WHERE username = 'deron'"),
    /app_user_username_ck/);
});
