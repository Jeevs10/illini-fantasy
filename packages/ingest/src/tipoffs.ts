import type { Db } from "@illini/db";
import { normaliseTeam } from "@illini/crosswalk";
import { espnScoreboard, type EspnLiveEvent } from "@illini/sources";
import { basketballDate, easternDate } from "./dates.ts";

/**
 * Tip-off times from ESPN.
 *
 * CBBD stays the schedule of record: which games, on which day, between whom.
 * Early in the season it lists most of them startTimeTbd, and the feed sends
 * those with no time (forward.ts). ESPN's scoreboard usually has the announced
 * time, so every game is looked up there by its two schools — the same name
 * match live scoring uses — and ESPN's time written with
 * `tipoff_source = 'espn'`. A time ESPN itself calls a placeholder is skipped.
 *
 * Where CBBD has a time and ESPN's differs, ESPN's wins (user decision
 * 2026-11-01: its times track the TV listings); each one is reported, so a
 * disagreement is seen rather than resolved silently.
 *
 * Everything here runs on a game's tip-off: when it locks, when it shows as
 * live, and which night it scores on.
 */

/**
 * A CBBD game's date, tip-off and its source, as the `game` row stores them.
 * A TBD game has no time, so it is filed by its Eastern date: basketballDate's
 * 4am boundary put the midnight placeholder on the night before.
 */
export function cbbdTipoff(start: string, tbd: boolean | undefined, date?: string | null): {
  playedOn: string; tipoff: string | null; source: "cbbd" | null;
} {
  return tbd
    ? { playedOn: date ?? easternDate(start), tipoff: null, source: null }
    : { playedOn: basketballDate(start), tipoff: start, source: "cbbd" };
}

/**
 * The `ON CONFLICT (cbbd_id) DO UPDATE` assignments for a game's tip-off: an
 * ESPN time already filled in stands, whatever CBBD sends, until CBBD moves the
 * game to another day.
 */
const KEEP_ESPN = `game.tipoff_source = 'espn' AND game.played_on = EXCLUDED.played_on`;
export const TIPOFF_ON_CONFLICT = {
  tipoff: `CASE WHEN ${KEEP_ESPN} THEN game.tipoff ELSE EXCLUDED.tipoff END`,
  source: `CASE WHEN ${KEEP_ESPN} THEN 'espn' ELSE EXCLUDED.tipoff_source END`,
};

export interface TipoffDisagreement {
  gameId: number;
  playedOn: string;
  home: string;
  away: string;
  cbbd: string;
  espn: string;
}

export interface TipoffResult {
  /** Games in the window. */
  checked: number;
  /** Games given ESPN's time: TBD ones, CBBD times it replaced, and ESPN times that moved. */
  filled: number;
  /** TBD games ESPN has no announced time for yet. */
  stillTbd: number;
  /** Games not found on ESPN's scoreboard for their date. */
  unmatched: number;
  /** Of `filled`, the games whose CBBD time ESPN's replaced. */
  disagree: TipoffDisagreement[];
}

export interface TipoffOptions {
  /** First date, YYYY-MM-DD. */
  from: string;
  /** How many days from `from`. */
  days?: number;
  scoreboard?: (date: string) => Promise<EspnLiveEvent[]>;
}

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function fillTipoffs(
  db: Db, { from, days = 14, scoreboard = espnScoreboard }: TipoffOptions,
): Promise<TipoffResult> {
  const { rows } = await db.query<{
    id: string; played_on: string; tipoff: Date | null; tipoff_source: string | null;
    home: string; home_norm: string; away: string; away_norm: string;
  }>(
    `SELECT g.id, to_char(g.played_on, 'YYYY-MM-DD') AS played_on, g.tipoff, g.tipoff_source,
            h.name AS home, h.normalised AS home_norm, a.name AS away, a.normalised AS away_norm
       FROM game g
       JOIN team h ON h.id = g.home_team_id
       JOIN team a ON a.id = g.away_team_id
      WHERE g.played_on BETWEEN $1 AND $2
      ORDER BY g.played_on`,
    [from, addDays(from, days - 1)],
  );

  const result: TipoffResult = { checked: rows.length, filled: 0, stillTbd: 0, unmatched: 0, disagree: [] };
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.played_on, [...(byDate.get(r.played_on) ?? []), r]);

  for (const [date, games] of byDate) {
    let events: EspnLiveEvent[];
    try {
      events = await scoreboard(date);
    } catch {
      result.unmatched += games.length;
      continue;
    }
    // Both orders: CBBD and ESPN can disagree on which side is home at a neutral site.
    const byPair = new Map<string, EspnLiveEvent>();
    // A school plays once a day, so one school is enough when ESPN names the
    // other differently — usually a non-D1 visitor ("Old Westbury").
    const byTeam = new Map<string, EspnLiveEvent[]>();
    for (const e of events) {
      for (const t of e.teams) {
        const k = normaliseTeam(t.location);
        byTeam.set(k, [...(byTeam.get(k) ?? []), e]);
      }
      const home = e.teams.find((t) => t.homeAway === "home");
      const away = e.teams.find((t) => t.homeAway === "away");
      if (!home || !away) continue;
      const [h, a] = [normaliseTeam(home.location), normaliseTeam(away.location)];
      byPair.set(`${h}|${a}`, e);
      if (!byPair.has(`${a}|${h}`)) byPair.set(`${a}|${h}`, e);
    }

    for (const g of games) {
      const one = (k: string) => (byTeam.get(k)?.length === 1 ? byTeam.get(k)![0] : undefined);
      const e = byPair.get(`${g.home_norm}|${g.away_norm}`) ?? one(g.home_norm) ?? one(g.away_norm);
      if (!e) {
        result.unmatched += 1;
        if (g.tipoff === null) result.stillTbd += 1;
        continue;
      }
      if (!e.timeValid) {
        if (g.tipoff === null) result.stillTbd += 1;
        continue;
      }
      const ours = g.tipoff === null ? null : new Date(g.tipoff).toISOString();
      if (ours === e.start) continue;
      if (ours !== null && g.tipoff_source !== "espn") {
        result.disagree.push({ gameId: Number(g.id), playedOn: g.played_on, home: g.home, away: g.away, cbbd: ours, espn: e.start });
      }
      await db.query(`UPDATE game SET tipoff = $2, tipoff_source = 'espn' WHERE id = $1`, [g.id, e.start]);
      result.filled += 1;
    }
  }
  return result;
}
