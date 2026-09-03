/**
 * League operations.
 *
 *   npm run league -- create 2026 "Illini Fantasy" 10 you@example.com
 *   npm run league -- invite 1 manager@example.com [teamId]
 *   npm run league -- accept <token> manager@example.com "Manager Name"
 *   npm run league -- members 1
 *   npm run league -- draft 1 2026          snake draft by season Player-Score
 *   npm run league -- roster 3
 *   npm run league -- lineups 1 20260214    auto-fill tonight, locks respected
 *   npm run league -- lineups 1 20260214 2026-02-14T16:00:00Z    replay as of a time
 *   npm run league -- settle 1 1
 *   npm run league -- standings 1
 */
import { connect, insertMany, upsertScoringConfig } from "@illini/db";
import { GAME_CONFIG } from "@illini/scoring";
import {
  DEFAULT_SETTINGS, autoFillLeague, generateSchedule, inviteToLeague, acceptInvite,
  members, rosterOn, settleWeek, standings,
} from "@illini/league";
import { loadEnv } from "./env.ts";

loadEnv();

const [command, ...args] = process.argv.slice(2);
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const iso = (d: string) => (d.includes("-") ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
const today = () => new Date().toISOString().slice(0, 10);

try {
  if (command === "create") {
    const [seasonArg, name, teamsArg, emailArg] = args;
    const season = Number(seasonArg);
    const teamCount = Number(teamsArg ?? 10);
    const { id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG);

    const { rows: [owner] } = await db.query<{ id: string }>(
      `INSERT INTO app_user (email, display_name) VALUES ($1, 'Commissioner')
       ON CONFLICT (email) DO UPDATE SET display_name = app_user.display_name RETURNING id`,
      [emailArg ?? "commish@illini.test"]);
    const { rows: [league] } = await db.query<{ id: string }>(
      `INSERT INTO league (name, season, config_id, settings, commissioner_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, season, configId, JSON.stringify(DEFAULT_SETTINGS), owner!.id]);
    await db.query(
      `INSERT INTO league_member (league_id, user_id, role) VALUES ($1,$2,'commissioner')
       ON CONFLICT (league_id, user_id) DO UPDATE SET role = 'commissioner'`,
      [league!.id, owner!.id]);

    // Teams start unowned. A manager takes one by redeeming an invite, so
    // ownership is something a person did rather than something seeded.
    await insertMany(db, {
      table: "fantasy_team",
      columns: ["league_id", "name"],
      rows: Array.from({ length: teamCount }, (_, i) => [league!.id, `Team ${i + 1}`]),
      conflict: "(league_id, name) DO NOTHING",
    });
    const weeks = await generateSchedule(db, Number(league!.id), `${season - 1}-11-02`, 17);
    console.log(`league ${league!.id} | ${teamCount} teams | ${weeks} matchups scheduled`);

  } else if (command === "invite") {
    const [leagueArg, email, teamArg] = args;
    const { rows: [commish] } = await db.query<{ commissioner_id: string }>(
      "SELECT commissioner_id FROM league WHERE id = $1", [Number(leagueArg)]);
    const invite = await inviteToLeague(db, {
      leagueId: Number(leagueArg),
      email: email!,
      invitedBy: Number(commish!.commissioner_id),
      fantasyTeamId: teamArg ? Number(teamArg) : undefined,
    });
    // Printed once. Only the hash is stored, so this cannot be recovered later.
    console.log(`invite ${invite.id} -> ${invite.email}`);
    console.log(`  token   ${invite.token}`);
    console.log(`  expires ${invite.expiresAt.slice(0, 10)}`);

  } else if (command === "accept") {
    const [token, email, displayName] = args;
    const joined = await acceptInvite(db, { token: token!, email: email!, displayName });
    console.log(`${email} joined league ${joined.leagueId} as ${joined.role}, running ${joined.fantasyTeamName}`);

  } else if (command === "members") {
    for (const m of await members(db, Number(args[0]))) {
      console.log(`${m.role.padEnd(13)}${m.displayName.padEnd(20)}${(m.fantasyTeamName ?? "—").padEnd(12)}${m.email}`);
    }

  } else if (command === "draft") {
    const [leagueArg, seasonArg] = args;
    const leagueId = Number(leagueArg);
    const season = Number(seasonArg);
    const { rows: teams } = await db.query<{ id: string }>(
      "SELECT id FROM fantasy_team WHERE league_id = $1 ORDER BY id", [leagueId]);
    const roster = DEFAULT_SETTINGS.starters.reduce((a, s) => a + s.count, 0) + DEFAULT_SETTINGS.bench;

    // Rank by season total under the league's config — the best available board.
    const { rows: pool } = await db.query<{ player_id: string }>(
      `SELECT s.player_id, sum(s.score) total
         FROM player_game_score s
         JOIN player_game_stat st ON st.player_id = s.player_id AND st.played_on = s.played_on
        WHERE st.season = $1
        GROUP BY s.player_id
        ORDER BY total DESC
        LIMIT $2`,
      [season, teams.length * roster]);

    // Snake order, so the first pick does not compound every round.
    const picks: unknown[][] = [];
    let i = 0;
    for (let round = 0; round < roster; round += 1) {
      const order = round % 2 === 0 ? teams : [...teams].reverse();
      for (const team of order) {
        const player = pool[i]; i += 1;
        if (!player) break;
        picks.push([team.id, leagueId, player.player_id, `${season - 1}-11-01`, "draft"]);
      }
    }
    const n = await insertMany(db, {
      table: "roster_slot",
      columns: ["fantasy_team_id", "league_id", "player_id", "acquired_on", "acquired_via"],
      rows: picks,
    });
    console.log(`drafted ${n} players across ${teams.length} teams (${roster} per roster)`);

  } else if (command === "roster") {
    const players = await rosterOn(db, Number(args[0]), args[1] ? iso(args[1]) : today());
    for (const p of players) {
      console.log(`${p.name.padEnd(24)}${(p.role ?? "—").padEnd(12)}${(p.teamName ?? "").padEnd(20)}${p.acquiredVia}`);
    }
    console.log(`${players.length} players`);

  } else if (command === "lineups") {
    const [leagueArg, dateArg, asOfArg] = args;
    const day = iso(dateArg!);
    // The clock is the real one unless a commissioner names another. Replaying
    // a night needs the override, because every game in it has already tipped
    // off and the lock would otherwise, correctly, refuse to move anyone.
    const asOf = asOfArg ? new Date(asOfArg) : new Date();
    const result = await autoFillLeague(db, Number(leagueArg), day, asOf);
    console.log(`${day}: started ${result.started} across ${result.teams} teams` +
      (asOfArg ? `  (as of ${asOf.toISOString()})` : ""));

  } else if (command === "settle") {
    const settled = await settleWeek(db, Number(args[0]), Number(args[1]));
    for (const m of settled) {
      console.log(
        `week ${m.week}  ${m.home.total.toFixed(1).padStart(7)} - ${m.away.total.toFixed(1).padEnd(7)}` +
        `  (${m.home.gamesCounted}/${m.home.gamesPlayed} vs ${m.away.gamesCounted}/${m.away.gamesPlayed} games)  ${m.winner}`);
    }
    if (settled.length === 0) console.log("no matchups that week");

  } else if (command === "standings") {
    const table = await standings(db, Number(args[0]));
    console.log(`${"team".padEnd(10)}${"W".padStart(3)}${"L".padStart(3)}${"T".padStart(3)}${"PF".padStart(9)}${"PA".padStart(9)}`);
    for (const r of table) {
      console.log(r.name.padEnd(10) + String(r.wins).padStart(3) + String(r.losses).padStart(3) +
        String(r.ties).padStart(3) + r.pointsFor.toFixed(1).padStart(9) + r.pointsAgainst.toFixed(1).padStart(9));
    }
  } else {
    console.error("usage: league <create|invite|accept|members|draft|roster|lineups|settle|standings> …");
    process.exit(1);
  }
} finally {
  await db.end();
}
