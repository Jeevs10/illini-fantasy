/**
 * A whole season, drafted and played out.
 *
 * `replay.ts` re-cuts the five ingested days into three periods so the seeded
 * league has something to show. This is the other thing: a league that is
 * drafted from the full player pool on opening night, has a lineup set for
 * every night of the season, and settles every week of it. Nothing here invents
 * a statistic — every point is a stored `player_game_score` row written by the
 * ingest, under the league's own config.
 *
 * It wants a database with the season actually in it:
 *
 *   npm run ingest -- setup 2026
 *   npm run ingest -- range 2026 20251101 20260408
 *   npm run season
 *
 *   npm run season -- --drop     remove it again
 *
 * The draft is an auto-draft, which ranks by season-total Player-Score. That is
 * hindsight — no manager in November knows the March totals — and it is the
 * right hindsight to use here, because the point of the league is to show what
 * a full roster of real players scores, not to simulate draft-day ignorance.
 */
import { connect, upsertScoringConfig } from "@illini/db";
import { GAME_CONFIG } from "@illini/scoring";
import {
  DEFAULT_SETTINGS, autoDraft, autoFillLeague, createDraft, generateSchedule,
  settleWeek, standings, startDraft,
} from "@illini/league";
import { loadEnv } from "./env.ts";

const NAME = "Illini Fantasy — 2025-26";
/** Teams, members and owners are taken from here, so the same people run it. */
const SOURCE_LEAGUE = 1;
const SEASON = 2026;

loadEnv();
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

/** The Monday on or before a date. Scoring periods are Monday to Sunday. */
function mondayOnOrBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function drop(): Promise<void> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM league WHERE name = $1", [NAME]);
  for (const { id } of rows) {
    // lineup_entry hangs off fantasy_team rather than league, so the cascade
    // from `league` does not reach it.
    await db.query(
      `DELETE FROM lineup_entry WHERE fantasy_team_id IN
         (SELECT id FROM fantasy_team WHERE league_id = $1)`, [id]);
    await db.query("DELETE FROM league WHERE id = $1", [id]);
    console.log(`dropped league ${id}`);
  }
}

async function build(): Promise<void> {
  await drop();

  const { rows: span } = await db.query<{ first: string; last: string; days: string }>(
    `SELECT to_char(min(played_on), 'YYYY-MM-DD') AS first,
            to_char(max(played_on), 'YYYY-MM-DD') AS last,
            count(DISTINCT played_on) AS days
       FROM game WHERE season = $1`, [SEASON]);
  const { first, last, days } = span[0]!;
  if (!first) throw new Error(`no ${SEASON} games are loaded — run the ingest first`);

  const opensOn = mondayOnOrBefore(first);
  const weekCount = Math.ceil(
    (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${opensOn}T00:00:00Z`)) / (7 * 86_400_000)) + 1;
  console.log(`${days} game days, ${first} to ${last} — ${weekCount} scoring periods from ${opensOn}\n`);

  const { id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG);
  const { rows: made } = await db.query<{ id: string }>(
    `INSERT INTO league (name, season, config_id, settings, commissioner_id)
     SELECT $1, $2, $3, $4, commissioner_id FROM league WHERE id = $5
     RETURNING id`,
    [NAME, SEASON, configId, JSON.stringify(DEFAULT_SETTINGS), SOURCE_LEAGUE]);
  const leagueId = Number(made[0]!.id);

  await db.query(
    `INSERT INTO fantasy_team (league_id, name, owner_id)
     SELECT $1, name, owner_id FROM fantasy_team WHERE league_id = $2 ORDER BY id`,
    [leagueId, SOURCE_LEAGUE]);
  await db.query(
    `INSERT INTO league_member (league_id, user_id, role)
     SELECT $1, user_id, role FROM league_member WHERE league_id = $2`,
    [leagueId, SOURCE_LEAGUE]);

  const matchups = await generateSchedule(db, leagueId, opensOn, weekCount);
  const { rows: [commish] } = await db.query<{ commissioner_id: string }>(
    "SELECT commissioner_id FROM league WHERE id = $1", [leagueId]);
  const by = Number(commish!.commissioner_id);

  // The draft is dated to the day it opens, so every tenure starts before the
  // first tip-off and `startableOn` will offer the roster from night one.
  const opensAt = new Date(`${opensOn}T00:00:00Z`);
  const draft = await createDraft(db, { leagueId, by, opensOn });
  await startDraft(db, { leagueId, by, now: opensAt });
  const picks = await autoDraft(db, { leagueId, now: opensAt });
  console.log(`draft: ${picks} picks over ${draft.rounds} rounds, ${matchups} matchups scheduled`);

  // Every night with a game on it. Auto-fill is run as of midnight UTC that
  // day — before anything tips — or the lock would freeze every roster on the
  // bench, which is what "set a lineup in hindsight" would actually look like.
  const { rows: nights } = await db.query<{ day: string }>(
    `SELECT DISTINCT to_char(played_on, 'YYYY-MM-DD') AS day
       FROM game WHERE season = $1 ORDER BY 1`, [SEASON]);

  let started = 0;
  for (const [i, { day }] of nights.entries()) {
    const r = await autoFillLeague(db, leagueId, day, new Date(`${day}T00:00:00Z`));
    started += r.started;
    if ((i + 1) % 20 === 0 || i === nights.length - 1) {
      console.log(`lineups ${String(i + 1).padStart(3)}/${nights.length} nights  ${day}  ${started} starts`);
    }
  }

  console.log("");
  for (let week = 1; week <= weekCount; week += 1) {
    const settled = await settleWeek(db, leagueId, week);
    const played = settled.filter((s) => s.home.gamesPlayed + s.away.gamesPlayed > 0);
    if (played.length === 0) continue;
    const spread = played.map((s) => `${s.home.total.toFixed(0)}-${s.away.total.toFixed(0)}`).join("  ");
    console.log(`week ${String(week).padStart(2)}  ${spread}`);
  }

  console.log(`\nleague ${leagueId} "${NAME}"`);
  for (const s of await standings(db, leagueId)) {
    console.log(`  ${s.name.padEnd(10)}${String(s.wins).padStart(3)}-${s.losses}-${s.ties}` +
      `${s.pointsFor.toFixed(0).padStart(8)} for${s.pointsAgainst.toFixed(0).padStart(8)} against`);
  }
}

try {
  await (process.argv.includes("--drop") ? drop() : build());
} finally {
  await db.end();
}
