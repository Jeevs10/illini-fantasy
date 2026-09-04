/**
 * Ingest and score game days.
 *
 *   npm run ingest -- setup 2026            teams and ratings
 *   npm run ingest -- schedule 2026 20261101 20270315   games and tip-off times
 *   npm run ingest -- night 2026 20260214   one game day
 *   npm run ingest -- range 2026 20260210 20260214
 *   npm run ingest -- link 2026             crosswalk CBBD onto known players
 *
 * `link` runs after at least one night, because Torvik is the identity spine:
 * players exist once they have a stat line, and other sources attach to them.
 */
import { connect, migrate } from "@illini/db";
import { CbbdClient, TorvikClient } from "@illini/sources";
import {
  ingestNight, opponentsOn, syncSchedule, syncTeams, syncRatings, linkCbbdRosters,
} from "@illini/ingest";
import { loadEnv } from "./env.ts";

loadEnv();

const [command, seasonArg, a, b] = process.argv.slice(2);
const season = Number(seasonArg);
if (!command || !Number.isFinite(season)) {
  console.error("usage: ingest <setup|schedule|night|range|link> <season> [date] [endDate]");
  process.exit(1);
}

const iso = (d: string): string => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const cbbd = new CbbdClient();
const torvik = new TorvikClient();

const dateRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(iso(from)); d <= new Date(iso(to)); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return out;
};

try {
  await migrate(db);

  if (command === "setup") {
    const teams = await syncTeams(db, cbbd, season);
    const ratings = await syncRatings(db, cbbd, season, `${season - 1}-11-01`);
    console.log(`teams ${teams} | ratings ${ratings}`);
  } else if (command === "schedule") {
    // Lineups are set the night before, so the schedule has to land before the
    // box scores do. One call covers a whole range.
    const games = await syncSchedule(db, cbbd, season, a!, b ?? a!);
    console.log(`schedule ${games} games ${iso(a!)} to ${iso(b ?? a!)}`);
  } else if (command === "link") {
    const { rows } = await db.query<{ n: string }>("SELECT count(*) n FROM player");
    if (rows[0]!.n === "0") {
      console.error("no players yet — run `ingest night` first, Torvik is the identity spine");
      process.exit(1);
    }
    const links = await linkCbbdRosters(db, cbbd, season);
    console.log(`cbbd linked ${links.linked}, queued for review ${links.queued}`);
  } else if (command === "night" || command === "range") {
    const dates = command === "night" ? [a!] : dateRange(a!, b!);

    // A range loads the whole schedule once and reads each night back out of
    // it. `night` still asks CBBD for its own day, because a single night is
    // usually being caught up on its own and the schedule may not be there yet.
    if (command === "range") {
      const games = await syncSchedule(db, cbbd, season, a!, b!);
      console.log(`schedule ${games} games ${iso(a!)} to ${iso(b!)}`);
    }

    for (const date of dates) {
      const r = await ingestNight(db, {
        torvik, cbbd, season, date,
        opponents: command === "range" ? await opponentsOn(db, season, iso(date)) : undefined,
      });
      console.log(
        `${r.date}  stats ${String(r.statsWritten).padStart(5)}  scored ${String(r.scoresWritten).padStart(5)}` +
        (r.withoutOpponent ? `  no-opponent ${r.withoutOpponent}` : ""),
      );
    }
  } else {
    console.error(`unknown command: ${command}`);
    process.exit(1);
  }
  console.log(`cbbd calls spent ${cbbd.usage.spent}, cached ${cbbd.usage.cached}, remaining ${cbbd.usage.remaining ?? "n/a"}`);
} finally {
  await db.end();
}
