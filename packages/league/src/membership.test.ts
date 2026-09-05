import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GAME_CONFIG } from "@illini/scoring";
import { connect, migrate, upsertScoringConfig, type Db } from "@illini/db";
import {
  acceptInvite, inviteByToken, inviteToLeague, members, openInvites, revokeInvite, roleOf,
  teamsInLeague, upsertUser,
} from "./membership.ts";
import {
  AlreadyRosteredError, RosterFullError, claimPlayer, releasePlayer, rosterOn, playerPool,
} from "./roster.ts";
import { DEFAULT_SETTINGS } from "./slots.ts";

let db: Db;
let configId: number;
let commish: number;

const LEAGUE = 1;
const OTHER_LEAGUE = 2;

before(async () => {
  const admin = connect("postgresql://postgres:dev@localhost:55432/postgres");
  await admin.query("DROP DATABASE IF EXISTS illini_member_test");
  await admin.query("CREATE DATABASE illini_member_test");
  await admin.end();

  db = connect("postgresql://postgres:dev@localhost:55432/illini_member_test");
  await migrate(db);
  ({ id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG));

  ({ id: commish } = await upsertUser(db, { email: "commish@illini.test", displayName: "Commish" }));

  await db.query("INSERT INTO team (id, name, normalised) VALUES (1,'Illinois','illinois')");
  for (let id = 1; id <= 40; id += 1) {
    await db.query("INSERT INTO player (id, name, normalised, team_id) VALUES ($1,$2,$3,1)",
      [id, `Player ${id}`, `player ${id}`]);
  }

  for (const leagueId of [LEAGUE, OTHER_LEAGUE]) {
    await db.query(
      `INSERT INTO league (id, name, season, config_id, settings, commissioner_id)
       VALUES ($1, $2, 2026, $3, $4, $5)`,
      [leagueId, `League ${leagueId}`, configId, JSON.stringify(DEFAULT_SETTINGS), commish]);
    await db.query(
      "INSERT INTO league_member (league_id, user_id, role) VALUES ($1,$2,'commissioner')",
      [leagueId, commish]);
    for (let t = 1; t <= 3; t += 1) {
      await db.query("INSERT INTO fantasy_team (id, league_id, name) VALUES ($1,$2,$3)",
        [leagueId * 10 + t, leagueId, `Team ${t}`]);
    }
  }
});

after(async () => { await db?.end(); });

test("only a commissioner can invite", async () => {
  const { id: outsider } = await upsertUser(db, { email: "outsider@illini.test" });
  await assert.rejects(
    () => inviteToLeague(db, { leagueId: LEAGUE, email: "x@y.z", invitedBy: outsider }),
    /not a commissioner/);
});

test("an invite is single use, and only by the address it was sent to", async () => {
  const invite = await inviteToLeague(db,
    { leagueId: LEAGUE, email: "Manager.One@illini.test", invitedBy: commish });
  assert.ok(invite.token, "the plaintext token is returned exactly once");
  assert.equal(invite.email, "manager.one@illini.test", "addresses are normalised");

  // Only the hash is stored, so the token cannot be read back out.
  const { rows } = await db.query<{ token_hash: string }>(
    "SELECT token_hash FROM league_invite WHERE id = $1", [invite.id]);
  assert.notEqual(rows[0]!.token_hash, invite.token);
  const open = await openInvites(db, LEAGUE);
  assert.ok(open.every((i) => i.token === undefined), "a listing never carries tokens");

  await assert.rejects(
    () => acceptInvite(db, { token: invite.token!, email: "someone.else@illini.test" }),
    /different email/);

  const accepted = await acceptInvite(db,
    { token: invite.token!, email: "manager.one@illini.test", displayName: "Manager One" });
  assert.equal(accepted.leagueId, LEAGUE);
  assert.equal(accepted.fantasyTeamId, 11, "the lowest unclaimed team");
  assert.equal(await roleOf(db, LEAGUE, accepted.userId), "manager");

  await assert.rejects(
    () => acceptInvite(db, { token: invite.token!, email: "manager.one@illini.test" }),
    /already used/);
});

test("a second manager gets the next team, not the same one", async () => {
  const invite = await inviteToLeague(db,
    { leagueId: LEAGUE, email: "manager.two@illini.test", invitedBy: commish });
  const accepted = await acceptInvite(db,
    { token: invite.token!, email: "manager.two@illini.test" });
  assert.equal(accepted.fantasyTeamId, 12);

  const roster = await members(db, LEAGUE);
  assert.equal(roster.length, 3, "commissioner plus two managers");
  const two = roster.find((m) => m.email === "manager.two@illini.test");
  assert.equal(two?.fantasyTeamName, "Team 2");
});

test("re-inviting an address kills the outstanding link", async () => {
  const first = await inviteToLeague(db,
    { leagueId: LEAGUE, email: "manager.three@illini.test", invitedBy: commish });
  const second = await inviteToLeague(db,
    { leagueId: LEAGUE, email: "manager.three@illini.test", invitedBy: commish });

  await assert.rejects(
    () => acceptInvite(db, { token: first.token!, email: "manager.three@illini.test" }),
    /revoked|already used|not found/);
  const accepted = await acceptInvite(db,
    { token: second.token!, email: "manager.three@illini.test" });
  assert.equal(accepted.fantasyTeamId, 13);
});

test("an expired invite is refused, and a revoked one too", async () => {
  const expired = await inviteToLeague(db,
    { leagueId: OTHER_LEAGUE, email: "late@illini.test", invitedBy: commish, ttlDays: -1 });
  await assert.rejects(
    () => acceptInvite(db, { token: expired.token!, email: "late@illini.test" }), /expired/);

  const live = await inviteToLeague(db,
    { leagueId: OTHER_LEAGUE, email: "gone@illini.test", invitedBy: commish });
  assert.equal(await revokeInvite(db, { inviteId: live.id, byUserId: commish }), true);
  await assert.rejects(
    () => acceptInvite(db, { token: live.token!, email: "gone@illini.test" }), /not found/);
});

test("a player belongs to one team per league, and the database is what says so", async () => {
  await claimPlayer(db, { fantasyTeamId: 11, playerId: 1, on: "2026-11-02", via: "draft" });

  await assert.rejects(
    () => claimPlayer(db, { fantasyTeamId: 12, playerId: 1, on: "2026-11-02" }),
    (error: Error) => error instanceof AlreadyRosteredError && /Team 1/.test(error.message));

  // The index, not just the guard: a direct insert must fail too.
  await assert.rejects(
    () => db.query(
      `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
       VALUES (12, 1, 1, '2026-11-02', 'waiver')`),
    /duplicate key|roster_slot_owned_idx/);

  // A different league is a different pool.
  await claimPlayer(db, { fantasyTeamId: 21, playerId: 1, on: "2026-11-02" });
  assert.equal((await rosterOn(db, 21, "2026-11-02")).length, 1);
});

test("league_id on a roster row cannot disagree with the team it points at", async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO roster_slot (fantasy_team_id, league_id, player_id, acquired_on, acquired_via)
       VALUES (11, 2, 5, '2026-11-02', 'draft')`),
    /roster_slot_team_league_fk|violates foreign key/);
});

test("a released player is free to claim, and history keeps the old tenure", async () => {
  assert.equal(await releasePlayer(db, { fantasyTeamId: 11, playerId: 1, on: "2026-12-01" }), true);
  await claimPlayer(db, { fantasyTeamId: 12, playerId: 1, on: "2026-12-01", via: "waiver" });

  // November still shows the original owner: settling an old week must not see
  // a roster rewritten by a December move.
  assert.ok((await rosterOn(db, 11, "2026-11-15")).some((p) => p.playerId === 1));
  assert.ok(!(await rosterOn(db, 11, "2026-12-02")).some((p) => p.playerId === 1));
  assert.ok((await rosterOn(db, 12, "2026-12-02")).some((p) => p.playerId === 1));
});

test("a roster fills up", async () => {
  const limit = DEFAULT_SETTINGS.starters.reduce((a, s) => a + s.count, 0)
    + DEFAULT_SETTINGS.bench + DEFAULT_SETTINGS.ir;
  for (let id = 10; id < 10 + limit; id += 1) {
    await claimPlayer(db, { fantasyTeamId: 13, playerId: id, on: "2026-11-02" });
  }
  await assert.rejects(
    () => claimPlayer(db, { fantasyTeamId: 13, playerId: 39, on: "2026-11-02" }),
    (error: Error) => error instanceof RosterFullError);
});

test("the pool reports who owns whom, and can hide the owned", async () => {
  const all = await playerPool(db, { leagueId: LEAGUE, season: 2026, configId, limit: 500 });
  const free = await playerPool(db,
    { leagueId: LEAGUE, season: 2026, configId, limit: 500, availableOnly: true });
  assert.ok(all.length >= free.length);
  assert.ok(free.every((p) => p.ownedBy === null));
});

test("asOf keeps a night the viewer has not reached yet out of the total", async () => {
  await db.query(
    `INSERT INTO player_game_stat (player_id, played_on, season, role, minutes, stats, source)
     VALUES (40,'2026-11-05',2026,'Pure PG',30,'{}'::jsonb,'torvik'),
            (40,'2026-12-05',2026,'Pure PG',30,'{}'::jsonb,'torvik')`);
  await db.query(
    `INSERT INTO player_game_score
       (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
     VALUES (40,'2026-11-05',$1,'lead','{}'::jsonb,0,1,1,10),
            (40,'2026-12-05',$1,'lead','{}'::jsonb,0,1,1,100)`,
    [configId]);

  const wholeSeason = await playerPool(db, { leagueId: LEAGUE, season: 2026, configId, limit: 500 });
  const player40Full = wholeSeason.find((p) => p.playerId === 40)!;
  assert.equal(player40Full.games, 2);
  assert.equal(player40Full.totalScore, 110, "with no asOf, both nights count");

  // Viewing from a date between the two games — the December night has not
  // happened yet as far as this viewer's clock is concerned.
  const midway = await playerPool(db,
    { leagueId: LEAGUE, season: 2026, configId, limit: 500, asOf: "2026-11-30" });
  const player40Midway = midway.find((p) => p.playerId === 40)!;
  assert.equal(player40Midway.games, 1);
  assert.equal(player40Midway.totalScore, 10, "only the night on or before asOf counts");
});

test("teamsInLeague reports both sides of a seat", async () => {
  // League 1 was filled by the invite tests above; league 2 was never claimed.
  const filled = await teamsInLeague(db, LEAGUE);
  assert.equal(filled.length, 3);
  assert.ok(filled.every((t) => t.ownerId !== null), "every seat taken");
  assert.equal(filled[0]!.ownerName, "Manager One");
  assert.equal(filled[0]!.ownerEmail, "manager.one@illini.test");

  const open = await teamsInLeague(db, OTHER_LEAGUE);
  assert.equal(open.filter((t) => t.ownerId === null).length, 3, "nothing claimed yet");
  assert.equal(open[0]!.ownerName, null);
});

test("an invite can be read before it is redeemed, and not after", async () => {
  const invite = await inviteToLeague(db, {
    leagueId: OTHER_LEAGUE, email: "Preview@illini.test", invitedBy: commish,
    fantasyTeamId: 22,
  });

  const preview = (await inviteByToken(db, invite.token!))!;
  assert.equal(preview.leagueName, "League 2");
  assert.equal(preview.email, "preview@illini.test");
  assert.equal(preview.fantasyTeamName, "Team 2", "the named seat, not the next free one");
  assert.equal(preview.expired, false);
  assert.equal(preview.role, "manager");

  // Reading it is not redeeming it: the seat is still open afterwards.
  const stillOpen = await teamsInLeague(db, OTHER_LEAGUE);
  assert.equal(stillOpen.find((t) => t.id === 22)?.ownerId, null);

  await acceptInvite(db, { token: invite.token!, email: "preview@illini.test" });
  assert.equal(await inviteByToken(db, invite.token!), null, "a spent link reads as nothing");
  assert.equal(await inviteByToken(db, "not-a-real-token"), null);
});

test("a preview says an expired link is expired rather than hiding it", async () => {
  // A refusal a manager can act on — ask for a new link — beats a dead end that
  // looks the same as a typo.
  const stale = await inviteToLeague(db, {
    leagueId: OTHER_LEAGUE, email: "stale@illini.test", invitedBy: commish, ttlDays: -1,
  });
  const preview = (await inviteByToken(db, stale.token!))!;
  assert.equal(preview.expired, true);
  assert.equal(preview.email, "stale@illini.test");
});
