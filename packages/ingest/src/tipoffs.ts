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

/**
 * The `ON CONFLICT (cbbd_id) DO UPDATE` value for one side's school: CBBD's,
 * unless CBBD still has that side as TBD and the game already names a school.
 */
export const keepKnown = (side: "home" | "away"): string =>
  `CASE WHEN EXCLUDED.${side}_team_id IN (SELECT id FROM team WHERE normalised IN ('tbd', 'tba'))
        THEN game.${side}_team_id ELSE EXCLUDED.${side}_team_id END`;

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
  /** Games not found on ESPN's scoreboard for their date or the next. */
  unmatched: number;
  /** Of `filled`, games ESPN has on the next day, refiled there: CBBD's midnight placeholder without its TBD flag. */
  moved: number;
  /** Of `filled`, the games whose CBBD time ESPN's replaced. */
  disagree: TipoffDisagreement[];
  /** Bracket games CBBD still had as "<team> vs TBD", given ESPN's opponent. */
  opponents: number;
}

/** CBBD's stand-in for a bracket opponent not decided yet (its team 1543, "TBD"). */
export const isTbd = (normalised: string): boolean => normalised === "tbd" || normalised === "tba";

/** How far ESPN's tip-off may sit from CBBD's for a TBD game to count as the same game (Data espn_check.MAX_GAP). */
const MAX_GAP_MS = 3 * 3_600_000;

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

  const result: TipoffResult = {
    checked: rows.length, filled: 0, stillTbd: 0, unmatched: 0, moved: 0, disagree: [], opponents: 0,
  };
  let teamIdOf: Map<string, string> | undefined;
  const missed: typeof rows = [];
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
      // A TBD side is never a school to look up: ESPN lists its own undecided
      // bracket slots as "TBD" too, and one of those is not this game.
      const one = (k: string) => (!isTbd(k) && byTeam.get(k)?.length === 1 ? byTeam.get(k)![0] : undefined);
      const e = byPair.get(`${g.home_norm}|${g.away_norm}`) ?? one(g.home_norm) ?? one(g.away_norm);
      if (!e) {
        missed.push(g);
        continue;
      }

      // A tournament's later rounds sit in CBBD as "<team> vs TBD" until CBBD
      // catches up, often hours after the earlier round ends, and ESPN fills
      // its bracket as soon as it does (Data repo espn_check.fill_tbd, user
      // 2026-11-18: that morning's Players Era games came in as "Houston @
      // TBD"). The known school's one game that day, at about the same time,
      // names the opponent; the feed's upsert then keeps it until CBBD names
      // the team itself (forward.ts).
      const tbdSide = isTbd(g.home_norm) ? "home" : isTbd(g.away_norm) ? "away" : null;
      if (tbdSide !== null && !isTbd(tbdSide === "home" ? g.away_norm : g.home_norm)) {
        const known = tbdSide === "home" ? g.away_norm : g.home_norm;
        const other = e.teams.find((t) => normaliseTeam(t.location) !== known);
        const close = g.tipoff === null || Math.abs(Date.parse(e.start) - new Date(g.tipoff).getTime()) <= MAX_GAP_MS;
        if (other && close && !isTbd(normaliseTeam(other.location)) && !other.espnId.startsWith("-")) {
          teamIdOf ??= new Map((await db.query<{ id: string; normalised: string }>(
            "SELECT id, normalised FROM team")).rows.map((t) => [t.normalised, t.id]));
          const teamId = teamIdOf.get(normaliseTeam(other.location));
          if (teamId !== undefined) {
            await db.query(`UPDATE game SET ${tbdSide}_team_id = $2 WHERE id = $1`, [g.id, teamId]);
            result.opponents += 1;
          }
        }
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

  // CBBD sometimes gives a game its midnight-Eastern placeholder without the
  // TBD flag, which files it on the night before. ESPN then has it a day
  // later. Both schools must match there — a school can play on consecutive
  // days — and ESPN's time must be a real one; the game is refiled on its date.
  const nextDay = new Map<string, Promise<EspnLiveEvent[]>>();
  for (const g of missed) {
    const date = addDays(g.played_on, 1);
    if (!nextDay.has(date)) nextDay.set(date, scoreboard(date).catch(() => []));
    const e = (await nextDay.get(date)!).find((ev) => {
      const names = ev.teams.map((t) => normaliseTeam(t.location));
      return names.includes(g.home_norm) && names.includes(g.away_norm);
    });
    if (!e || !e.timeValid) {
      result.unmatched += 1;
      if (g.tipoff === null) result.stillTbd += 1;
      continue;
    }
    const ours = g.tipoff === null ? null : new Date(g.tipoff).toISOString();
    if (ours !== null && g.tipoff_source !== "espn") {
      result.disagree.push({ gameId: Number(g.id), playedOn: g.played_on, home: g.home, away: g.away, cbbd: ours, espn: e.start });
    }
    await db.query(`UPDATE game SET tipoff = $2, tipoff_source = 'espn', played_on = $3 WHERE id = $1`,
      [g.id, e.start, basketballDate(e.start)]);
    result.filled += 1;
    result.moved += 1;
  }
  return result;
}
