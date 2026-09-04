/**
 * A finished season, built out of the nights that were actually ingested.
 *
 * The seeded league runs a seventeen-week schedule against five days of real
 * data, so its "end of season" is one settled week and nine teams with nothing
 * to show. This makes a second league over the same rosters and the same
 * lineups, with the scoring periods re-cut to the slates that exist: three
 * periods instead of seventeen, and a games cap low enough that it actually
 * decides something on a single night.
 *
 * Nothing here invents a statistic. Every score is the same stored
 * `player_game_score` row the real league reads, produced by the same config;
 * the only thing that changes is where the week boundaries fall. It is a
 * different way of slicing real history, not a fabricated one.
 *
 *   npm run replay              build (or rebuild) the replay league
 *   npm run replay -- --drop    remove it again
 */

import { connect } from "@illini/db";
import { loadEnv } from "./env.ts";
import { roundRobin, settleWeek } from "@illini/league";

const NAME = "Illini Fantasy — 2025-26 replay";
const SOURCE_LEAGUE = 1;

/**
 * The slates, as they fell. Feb 12 and 13 carried six started games between
 * the whole league, so they join the 11th rather than becoming two weeks of
 * nearly nothing — the uneven college calendar is the reason the games cap
 * exists, and a period has to be big enough for it to bite.
 */
const PERIODS = [
  { week: 1, startsOn: "2026-02-10", endsOn: "2026-02-10" },
  { week: 2, startsOn: "2026-02-11", endsOn: "2026-02-13" },
  { week: 3, startsOn: "2026-02-14", endsOn: "2026-02-14" },
];

/** Five to seven starters a night, so four counting is a real decision. */
const GAMES_CAP = 4;

loadEnv();
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

async function drop(): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM league WHERE name = $1", [NAME]);
  for (const { id } of rows) {
    const leagueId = Number(id);
    await db.query(
      `DELETE FROM lineup_entry WHERE fantasy_team_id IN
         (SELECT id FROM fantasy_team WHERE league_id = $1)`, [leagueId]);
    await db.query("DELETE FROM league WHERE id = $1", [leagueId]);  // cascades
    console.log(`dropped league ${leagueId}`);
  }
}

async function build(): Promise<void> {
  await drop();

  const { rows: source } = await db.query<{ config_id: string; season: number; settings: Record<string, unknown> }>(
    "SELECT config_id, season, settings FROM league WHERE id = $1", [SOURCE_LEAGUE]);
  const src = source[0];
  if (!src) throw new Error(`league ${SOURCE_LEAGUE} does not exist`);

  const settings = { ...src.settings, gamesCap: GAMES_CAP, periodDays: 1 };
  const { rows: made } = await db.query<{ id: string }>(
    `INSERT INTO league (name, season, config_id, settings, commissioner_id)
     SELECT $1, season, config_id, $2, commissioner_id FROM league WHERE id = $3
     RETURNING id`,
    [NAME, JSON.stringify(settings), SOURCE_LEAGUE]);
  const leagueId = Number(made[0]!.id);

  // Teams, keeping names and owners so the same people run the same sides.
  const { rows: teams } = await db.query<{ old_id: string; id: string }>(
    `WITH src AS (
       SELECT id, name, owner_id FROM fantasy_team WHERE league_id = $2 ORDER BY id
     ), made AS (
       INSERT INTO fantasy_team (league_id, name, owner_id)
       SELECT $1, name, owner_id FROM src
       RETURNING id, name
     )
     SELECT src.id AS old_id, made.id
       FROM src JOIN made ON made.name = src.name`,
    [leagueId, SOURCE_LEAGUE]);
  const map = new Map(teams.map((t) => [Number(t.old_id), Number(t.id)]));

  await db.query(
    `INSERT INTO league_member (league_id, user_id, role)
     SELECT $1, user_id, role FROM league_member WHERE league_id = $2`,
    [leagueId, SOURCE_LEAGUE]);

  // Rosters and lineups, remapped. Both are copied rather than referenced:
  // a tenure belongs to a league, and the replay has to be able to settle
  // without touching the league it was copied from.
  const pairs = [...map.entries()];
  const oldIds = pairs.map(([o]) => o);
  const newIds = pairs.map(([, n]) => n);

  const copiedRosters = await db.query(
    `INSERT INTO roster_slot (league_id, fantasy_team_id, player_id, acquired_on, released_on, acquired_via)
     SELECT $1, m.new_id, r.player_id, r.acquired_on, r.released_on, r.acquired_via
       FROM roster_slot r
       JOIN unnest($2::bigint[], $3::bigint[]) AS m(old_id, new_id) ON m.old_id = r.fantasy_team_id
      WHERE r.league_id = $4`,
    [leagueId, oldIds, newIds, SOURCE_LEAGUE]);

  const copiedLineups = await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
     SELECT m.new_id, l.played_on, l.player_id, l.slot, l.game_id
       FROM lineup_entry l
       JOIN unnest($1::bigint[], $2::bigint[]) AS m(old_id, new_id) ON m.old_id = l.fantasy_team_id`,
    [oldIds, newIds]);

  // The log the copied tenures imply: who ended up with whom, and how. Each row
  // asserts exactly what its tenure already asserts — the team, the player, the
  // date, and the method — and deliberately nothing more.
  //
  // In particular every row carries the tenure's own date and no invented time.
  // A first attempt spaced them out round by round so the feed would read like
  // a draft board, and that was wrong: `roster_slot` records the date a player
  // was acquired but not his position in the draft, so the pretty version was
  // asserting an order the database does not know — and got it backwards,
  // showing each team's best player as its last pick. An arbitrary-looking feed
  // that only claims what is recorded is the better of the two.
  const copiedLog = await db.query(
    `INSERT INTO transaction (league_id, kind, payload, created_at)
     SELECT $1, r.acquired_via,
            jsonb_build_object('fantasyTeamId', r.fantasy_team_id, 'playerId', r.player_id,
                               'on', to_char(r.acquired_on, 'YYYY-MM-DD')),
            r.acquired_on::timestamptz
       FROM roster_slot r
      WHERE r.league_id = $1`,
    [leagueId]);

  // Three periods of a real round robin over the same ten teams.
  const rounds = roundRobin(newIds);
  for (const period of PERIODS) {
    for (const pair of rounds[(period.week - 1) % rounds.length]!) {
      await db.query(
        `INSERT INTO matchup (league_id, week, starts_on, ends_on, home_team_id, away_team_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [leagueId, period.week, period.startsOn, period.endsOn, pair.home, pair.away]);
    }
    const settled = await settleWeek(db, leagueId, period.week);
    const spread = settled.map((s) => `${s.home.total.toFixed(0)}-${s.away.total.toFixed(0)}`).join("  ");
    console.log(`week ${period.week}  ${period.startsOn}..${period.endsOn}  ${spread}`);
  }

  console.log(`\nleague ${leagueId} "${NAME}"`);
  console.log(`  ${copiedRosters.rowCount} roster tenures, ${copiedLineups.rowCount} lineup entries, `
    + `${copiedLog.rowCount} log entries`);
  console.log(`  ${PERIODS.length} settled periods, best ${GAMES_CAP} games count`);
}

await (process.argv.includes("--drop") ? drop() : build());
await db.end();
