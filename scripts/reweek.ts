/**
 * Re-cuts a league's lineup history from nights into weeks.
 *
 * A season seeded before lineups were weekly was auto-filled one night at a
 * time, which means it never held a weekly decision at all — it held seven of
 * them, and the union of those seven is most of the roster. Twelve players can
 * end up having started somewhere inside a week the league has seven slots for.
 * Everything they scored counts, because settlement counts started nights, so
 * the totals are real; they are just the totals of a lineup nobody could have
 * set. The team page had to grow a "also started this week" list to show the
 * five players with no slot left to sit in.
 *
 * This replaces each of those weeks with the decision the week should have
 * been: `seedPeriodLineup` picks one lineup per team per period, on form from
 * before the period opened, and writes it across every night in it. Then the
 * weeks that were settled are settled again, because their points were the
 * points of the old lineups (and, on any league seeded before the games cap
 * came out, of a best-of-N rule that no longer exists).
 *
 *   npm run reweek -- 6              re-cut league 6 and re-settle it
 *   npm run reweek -- 6 --dry-run    say what it would do, write nothing
 *   npm run reweek -- 6 --weeks 1-10 only those periods
 *
 * A period with no lineup rows at all is left alone — nobody has played or set
 * it, and seeding it here would invent a decision the manager still gets to
 * make. A period whose every team already reads as weekly is left alone too, so
 * a season that has been through this once survives being run through it again.
 *
 * Any other period is re-cut for all ten teams, not only the ones that show the
 * scar. A matchup is two sides of one week and has to be scored under one rule,
 * and a week seeded a night at a time can leave a team looking weekly by
 * accident — five starters over a holiday week is fewer than seven, and says
 * nothing about how they were picked. The cost is that a manager who set that
 * particular week through the page has it re-picked; every team the run will
 * touch is named in the output first, and `--dry-run` shows it without writing.
 */
import { connect } from "@illini/db";
import {
  DEFAULT_SETTINGS, scorePeriod, seedPeriodLineup, settleWeek, standings,
  type LeagueSettings,
} from "@illini/league";
import { loadEnv } from "./env.ts";

loadEnv();
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const leagueId = Number(argv.find((a) => /^\d+$/.test(a)));
const weekArg = argv.includes("--weeks") ? argv[argv.indexOf("--weeks") + 1] : undefined;

interface Period { week: number; from: string; to: string; settled: boolean }

/** What a team's week looks like now, from the rows as they stand. */
interface Shape {
  fantasyTeamId: number;
  name: string;
  /** Distinct players who started at least one night. */
  starters: number;
  /** Players started on one night of the week and not on another they played. */
  partial: number;
  total: number;
}

function wanted(week: number): boolean {
  if (weekArg === undefined) return true;
  const [lo, hi] = weekArg.includes("-") ? weekArg.split("-") : [weekArg, weekArg];
  return week >= Number(lo) && week <= Number(hi);
}

/**
 * Whether a period's rows could have come from one weekly decision.
 *
 * Two tells, and either is enough. More distinct starters than the league has
 * starting slots means several nights each named their own seven. A player
 * started on one of his nights and benched on another means the same thing
 * from the other side — a weekly lineup starts him on all of them or none.
 */
function nightly(shape: Shape, slots: number): boolean {
  return shape.starters > slots || shape.partial > 0;
}

async function shapeOf(
  { fantasyTeamId, name, from, to, configId }: {
    fantasyTeamId: number; name: string; from: string; to: string; configId: number;
  },
): Promise<Shape> {
  const { rows } = await db.query<{ starters: string; partial: string }>(
    `WITH nights AS (
       SELECT l.player_id, l.slot NOT IN ('BENCH', 'IR') AS started
         FROM lineup_entry l
        WHERE l.fantasy_team_id = $1 AND l.played_on BETWEEN $2 AND $3
     )
     SELECT count(DISTINCT player_id) FILTER (WHERE started) AS starters,
            count(DISTINCT player_id) FILTER (WHERE NOT started
              AND player_id IN (SELECT player_id FROM nights WHERE started)) AS partial
       FROM nights`,
    [fantasyTeamId, from, to]);
  const period = await scorePeriod(db, { fantasyTeamId, configId, from, to });
  return {
    fantasyTeamId, name,
    starters: Number(rows[0]?.starters ?? 0),
    partial: Number(rows[0]?.partial ?? 0),
    total: period.total,
  };
}

async function run(): Promise<void> {
  if (!Number.isFinite(leagueId)) {
    throw new Error("usage: npm run reweek -- <leagueId> [--dry-run] [--weeks 1-10]");
  }

  const { rows: leagues } = await db.query<{
    name: string; config_id: string; settings: LeagueSettings;
  }>("SELECT name, config_id, settings FROM league WHERE id = $1", [leagueId]);
  const league = leagues[0];
  if (league === undefined) throw new Error(`no league ${leagueId}`);

  const configId = Number(league.config_id);
  const settings: LeagueSettings = { ...DEFAULT_SETTINGS, ...(league.settings ?? {}) };
  const slots = settings.starters.reduce((a, s) => a + s.count, 0);

  const { rows: teams } = await db.query<{ id: string; name: string }>(
    "SELECT id, name FROM fantasy_team WHERE league_id = $1 ORDER BY id", [leagueId]);

  // Playoff rounds share the week column with the regular season, so a period
  // is a distinct (week, span) rather than a distinct week.
  const { rows: periodRows } = await db.query<{
    week: string; from: string; to: string; settled: string;
  }>(
    `SELECT week,
            to_char(starts_on, 'YYYY-MM-DD') AS from, to_char(ends_on, 'YYYY-MM-DD') AS to,
            count(*) FILTER (WHERE settled_at IS NOT NULL) AS settled
       FROM matchup WHERE league_id = $1
      GROUP BY week, starts_on, ends_on ORDER BY week, starts_on`,
    [leagueId]);
  const periods: Period[] = periodRows.map((r) => ({
    week: Number(r.week), from: r.from, to: r.to, settled: Number(r.settled) > 0,
  }));

  console.log(`league ${leagueId} "${league.name}" — ${teams.length} teams, ` +
    `${slots} starting slots, ${periods.length} periods${dryRun ? "  (dry run)" : ""}\n`);

  let rewritten = 0;
  const resettle: Period[] = [];

  for (const period of periods) {
    if (!wanted(period.week)) continue;

    const before = await Promise.all(teams.map((t) => shapeOf({
      fantasyTeamId: Number(t.id), name: t.name, from: period.from, to: period.to, configId,
    })));
    const touched = before.filter((s) => s.starters > 0);
    if (touched.length === 0) continue; // nobody has played or set this period

    const scarred = touched.filter((s) => nightly(s, slots));
    const label = `week ${String(period.week).padStart(2)}  ${period.from}..${period.to}`;
    if (scarred.length === 0) {
      console.log(`${label}  already weekly — left alone`);
      continue;
    }

    console.log(`${label}  ${scarred.length}/${touched.length} teams set night by night` +
      (period.settled ? "" : "  (unsettled)"));
    for (const s of scarred) {
      console.log(`    ${s.name.padEnd(9)} ${String(s.starters).padStart(2)} starters` +
        `${s.partial > 0 ? `, ${s.partial} started only some of their nights` : ""}` +
        `${s.total.toFixed(1).padStart(9)} scored`);
    }
    if (dryRun) continue;

    for (const team of teams) {
      await seedPeriodLineup(db, {
        fantasyTeamId: Number(team.id), from: period.from, to: period.to, configId, settings,
      });
    }
    rewritten += 1;
    if (period.settled) resettle.push(period);

    const after = await Promise.all(teams.map((t) => shapeOf({
      fantasyTeamId: Number(t.id), name: t.name, from: period.from, to: period.to, configId,
    })));
    for (const s of after.filter((a) => a.starters > 0)) {
      const was = before.find((b) => b.fantasyTeamId === s.fantasyTeamId)!;
      console.log(`    → ${s.name.padEnd(9)} ${String(s.starters).padStart(2)} starters` +
        `${s.total.toFixed(1).padStart(9)} scored  (was ${was.total.toFixed(1)})`);
    }
  }

  if (dryRun) {
    console.log("\nnothing written");
    return;
  }

  console.log("");
  for (const period of resettle) {
    const settled = await settleWeek(db, leagueId, period.week);
    const spread = settled
      .filter((s) => s.home.gamesPlayed + s.away.gamesPlayed > 0)
      .map((s) => `${s.home.total.toFixed(0)}-${s.away.total.toFixed(0)}`).join("  ");
    console.log(`settled week ${String(period.week).padStart(2)}  ${spread}`);
  }

  console.log(`\n${rewritten} periods re-cut, ${resettle.length} re-settled\n`);
  for (const s of await standings(db, leagueId)) {
    console.log(`  ${s.name.padEnd(10)}${String(s.wins).padStart(3)}-${s.losses}-${s.ties}` +
      `${s.pointsFor.toFixed(0).padStart(8)} for${s.pointsAgainst.toFixed(0).padStart(8)} against`);
  }
}

try {
  await run();
} finally {
  await db.end();
}
