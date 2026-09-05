import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, migrate, type Db } from "@illini/db";
import { availabilityFor, availabilityOf } from "./availability.ts";

let db: Db;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_availability_test");
  await admin.query("CREATE DATABASE illini_availability_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_availability_test");
  await migrate(db);

  await db.query(
    `INSERT INTO player (id, name, normalised) VALUES
       (1, 'Terrence Shannon Jr.', 'terrence shannon jr'),
       (2, 'Marcus Domask', 'marcus domask'),
       (3, 'Coleman Hawkins', 'coleman hawkins')`,
  );
});

after(async () => { await db?.end(); });

test("a player with no row at all is absent from the map, not assumed available", async () => {
  const result = await availabilityFor(db, [1]);
  assert.equal(result.has(1), false);
  assert.equal(await availabilityOf(db, 1), null);
});

test("the latest row by as_of wins, not the highest-status or insertion order", async () => {
  await db.query(
    `INSERT INTO player_availability (player_id, as_of, status, injury, note) VALUES
       (2, '2026-02-01T12:00:00Z', 'out', 'ankle', null),
       (2, '2026-02-05T12:00:00Z', 'questionable', 'ankle', null),
       (2, '2026-02-03T12:00:00Z', 'doubtful', 'ankle', null)`,
  );
  const row = await availabilityOf(db, 2);
  assert.ok(row);
  assert.equal(row.status, "questionable");
  assert.equal(row.asOf, "2026-02-05T12:00:00.000Z");
});

test("a cleared player's most recent row is available, even though an older one said out", async () => {
  await db.query(
    `INSERT INTO player_availability (player_id, as_of, status, injury, note) VALUES
       (3, '2026-02-01T12:00:00Z', 'out', 'knee', null),
       (3, '2026-02-08T12:00:00Z', 'available', null, 'cleared from RotoWire''s report')`,
  );
  const row = await availabilityOf(db, 3);
  assert.ok(row);
  assert.equal(row.status, "available");
  assert.equal(row.injury, null);
});

test("availabilityFor batches several players in one query and omits an empty request", async () => {
  const map = await availabilityFor(db, [1, 2, 3]);
  assert.equal(map.has(1), false);
  assert.equal(map.get(2)?.status, "questionable");
  assert.equal(map.get(3)?.status, "available");
  assert.deepEqual(await availabilityFor(db, []), new Map());
});
