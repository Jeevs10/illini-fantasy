import type { Db } from "@illini/db";
import { advanceExpired } from "./draft.ts";
import { settlePlayoffs } from "./playoffs.ts";
import { settleWeek } from "./settle.ts";
import { settleTrades } from "./trades.ts";
import { settleWaivers } from "./waivers.ts";

/**
 * Everything the clock has made due, for every league in a season.
 *
 * The app settles on read — the first request past a deadline does the work —
 * but each piece only on the page that needs it: the waiver run when somebody
 * opens /waivers or /players, a trade when somebody opens /trades. Weeks were
 * never settled on read at all; only `npm run league -- settle` did it, so
 * the standings, the playoff seeding and the waiver order all sat waiting on
 * a commissioner at a terminal. The morning feed is the one moment every day
 * the app is guaranteed to be touched after the night's games are in, so it
 * runs this after it writes them.
 *
 * Order matters and is the order a week actually happens in: the draft clock,
 * then the moves due by now (waivers before trades, the same order the pages
 * call them in), then every regular-season week that has ended, then the
 * bracket. A week is settled again for seven days after it ends, because a
 * late box score lands in the next morning's feed and settling recomputes
 * from scores rather than accumulating them.
 */
export async function settleDue(
  db: Db, { season, now = new Date(), through }: {
    season: number;
    now?: Date;
    /** Weeks ending before this date are settled — the feed's date, whose lines run through the night before. */
    through: string;
  },
): Promise<{ leagueId: number; waiverRuns: number; trades: number; weeks: number[]; playoffs: number }[]> {
  const { rows: leagues } = await db.query<{ id: string }>(
    "SELECT id FROM league WHERE season = $1 ORDER BY id", [season]);
  const out = [];
  for (const { id } of leagues) {
    const leagueId = Number(id);
    await advanceExpired(db, { leagueId, now });
    const waiverRuns = (await settleWaivers(db, { leagueId, now })).length;
    const trades = (await settleTrades(db, { leagueId, now })).length;
    const { rows: weeks } = await db.query<{ week: number }>(
      `SELECT DISTINCT week FROM matchup
        WHERE league_id = $1 AND round IS NULL AND ends_on < $2::date
          AND (settled_at IS NULL OR ends_on >= $2::date - 7)
        ORDER BY week`,
      [leagueId, through]);
    for (const { week } of weeks) await settleWeek(db, leagueId, week);
    const playoffs = (await settlePlayoffs(db, { leagueId, now })).length;
    out.push({ leagueId, waiverRuns, trades, weeks: weeks.map((w) => w.week), playoffs });
  }
  return out;
}
