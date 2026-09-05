import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, migrate, type Db } from "@illini/db";
import type { EspnTeam } from "@illini/sources";
import { syncTeamIdentity } from "./teams.ts";

let db: Db;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_identity_test");
  await admin.query("CREATE DATABASE illini_identity_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_identity_test");
  await migrate(db);

  await db.query(
    `INSERT INTO team (id, name, normalised) VALUES
       (1, 'Illinois', 'illinois'),
       (2, 'Duke', 'duke'),
       (3, 'Some Small School', 'some small school')`,
  );
});

after(async () => { await db?.end(); });

const espn = (teams: EspnTeam[]) => ({ teams: async () => teams });

test("colour and abbreviation land on the team a name matches, hex prefixed with '#'", async () => {
  const matched = await syncTeamIdentity(db, espn([
    { espnId: "356", location: "Illinois", displayName: "Illinois Fighting Illini",
      abbreviation: "ILL", color: "ff5f05", alternateColor: "13294b" },
  ]));
  assert.equal(matched, 1);
  const { rows } = await db.query(
    "SELECT primary_color, secondary_color, abbreviation FROM team WHERE id = 1",
  );
  assert.deepEqual(rows[0], {
    primary_color: "#ff5f05", secondary_color: "#13294b", abbreviation: "ILL",
  });
});

test("a name nothing in the team table matches is skipped, not inserted as a new row", async () => {
  const before = await db.query("SELECT count(*) n FROM team");
  const matched = await syncTeamIdentity(db, espn([
    { espnId: "999", location: "Nonexistent College", displayName: "Nonexistent",
      abbreviation: "NON", color: "000000", alternateColor: null },
  ]));
  assert.equal(matched, 0);
  const after = await db.query("SELECT count(*) n FROM team");
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("a missing colour never overwrites one already on the row", async () => {
  await db.query(
    "UPDATE team SET primary_color = '#001122', secondary_color = '#334455' WHERE id = 2",
  );
  await syncTeamIdentity(db, espn([
    { espnId: "150", location: "Duke", displayName: "Duke Blue Devils",
      abbreviation: "DUKE", color: null, alternateColor: null },
  ]));
  const { rows } = await db.query(
    "SELECT primary_color, secondary_color FROM team WHERE id = 2",
  );
  assert.deepEqual(rows[0], { primary_color: "#001122", secondary_color: "#334455" });
});

test("two ESPN rows that normalise to the same school keep the first", async () => {
  const matched = await syncTeamIdentity(db, espn([
    { espnId: "1", location: "Some Small School", displayName: "Some Small School Foo",
      abbreviation: "SSS", color: "111111", alternateColor: null },
    { espnId: "2", location: "Some Small School", displayName: "Some Small School Bar",
      abbreviation: "SSB", color: "222222", alternateColor: null },
  ]));
  assert.equal(matched, 1);
  const { rows } = await db.query("SELECT abbreviation FROM team WHERE id = 3");
  assert.equal(rows[0].abbreviation, "SSS");
});
