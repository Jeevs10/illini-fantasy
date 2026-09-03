/**
 * League operations.
 *
 *   npm run league -- create 2026 "Illini Fantasy" 10
 *   npm run league -- draft 1 2026          snake draft by season Player-Score
 *   npm run league -- lineups 1 20260214    auto-fill and lock a day's lineups
 *   npm run league -- settle 1 1
 *   npm run league -- standings 1
 */
import { connect, insertMany, upsertScoringConfig } from "@illini/db";
import { GAME_CONFIG, type Archetype } from "@illini/scoring";
import {
  DEFAULT_SETTINGS, autoFill, generateSchedule, settleWeek, standings, weeksFrom,
} from "@illini/league";
import { loadEnv } from "./env.ts";

loadEnv();

const [command, ...args] = process.argv.slice(2);
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const iso = (d: string) => (d.includes("-") ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);

const ARCHETYPE_OF: Record<string, Archetype> = {
  "Scoring PG": "lead", "Pure PG": "lead", "Combo G": "combo", "Wing G": "combo",
  "Wing F": "wing", "Stretch 4": "swing", "PF/C": "big", "C": "big",
};

try {
  if (command === "create") {
    const [seasonArg, name, teamsArg] = args;
    const season = Number(seasonArg);
    const teamCount = Number(teamsArg ?? 10);
    const { id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG);

    const { rows: [owner] } = await db.query<{ id: string }>(
      `INSERT INTO app_user (email, display_name) VALUES ('commish@illini.test','Commissioner')
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`);
    const { rows: [league] } = await db.query<{ id: string }>(
      `INSERT INTO league (name, season, config_id, settings, commissioner_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, season, configId, JSON.stringify(DEFAULT_SETTINGS), owner!.id]);

    await insertMany(db, {
      table: "fantasy_team",
      columns: ["league_id", "owner_id", "name"],
      rows: Array.from({ length: teamCount }, (_, i) => [league!.id, owner!.id, `Team ${i + 1}`]),
      conflict: "(league_id, name) DO NOTHING",
    });
    const weeks = generateSchedule
      ? await generateSchedule(db, Number(league!.id), `${season - 1}-11-02`, 17)
      : 0;
    console.log(`league ${league!.id} | ${teamCount} teams | ${weeks} matchups scheduled`);

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
        picks.push([team.id, player.player_id, `${season - 1}-11-01`, "draft"]);
      }
    }
    const n = await insertMany(db, {
      table: "roster_slot",
      columns: ["fantasy_team_id", "player_id", "acquired_on", "acquired_via"],
      rows: picks,
    });
    console.log(`drafted ${n} players across ${teams.length} teams (${roster} per roster)`);

  } else if (command === "lineups") {
    const [leagueArg, dateArg] = args;
    const day = iso(dateArg!);
    const { rows: teams } = await db.query<{ id: string }>(
      "SELECT id FROM fantasy_team WHERE league_id = $1 ORDER BY id", [Number(leagueArg)]);

    let locked = 0;
    for (const team of teams) {
      // Only players who actually have a game that day are startable.
      const { rows: available } = await db.query<{ player_id: string; role: string | null; score: number }>(
        `SELECT r.player_id, st.role, s.score
           FROM roster_slot r
           JOIN player_game_stat st ON st.player_id = r.player_id AND st.played_on = $2
           JOIN player_game_score s ON s.player_id = r.player_id AND s.played_on = $2
          WHERE r.fantasy_team_id = $1 AND r.released_on IS NULL`,
        [team.id, day]);
      if (available.length === 0) continue;

      const lineup = autoFill(available.map((a) => ({
        playerId: Number(a.player_id),
        archetype: ARCHETYPE_OF[a.role ?? ""] ?? "wing",
        projected: Number(a.score),
      })));
      locked += await insertMany(db, {
        table: "lineup_entry",
        columns: ["fantasy_team_id", "played_on", "player_id", "slot"],
        rows: lineup.map((l) => [team.id, day, l.playerId, l.slot]),
        dedupeOn: [0, 1, 2],
        conflict: "(fantasy_team_id, played_on, player_id) DO UPDATE SET slot = EXCLUDED.slot",
      });
    }
    console.log(`${day}: locked ${locked} lineup entries across ${teams.length} teams`);

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
    console.error("usage: league <create|draft|lineups|settle|standings> …");
    process.exit(1);
  }
} finally {
  await db.end();
}
