import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Barttorvik client.
 *
 * playerstat.php is a shell; the data comes from an XHR to pslice.php. The
 * "Verifying Browser" interstitial is satisfied by a single POST of
 * `js_test_submitted=1`, which sets a `js_verified=true` cookie.
 *
 * pslice.php honours start/end date windows — a same-day window returns one row
 * per player-game. getadvstats.php ignores date parameters entirely no matter
 * which combination you pass, so it is only used for the season role table.
 */

const BASE = "https://barttorvik.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** pslice returns arrays, not objects. Column order verified against the repo CSV. */
export const COL = {
  name: 0, team: 1, conference: 2, games: 3, minutesPct: 4, offensiveRating: 5,
  usage: 6, effectiveFieldGoalPct: 7, trueShootingPct: 8, offensiveReboundPct: 9,
  defensiveReboundPct: 10, assistPct: 11, turnoverPct: 12, ftMade: 13, ftAtt: 14,
  freeThrowPct: 15, twoMade: 16, twoAtt: 17, twoPct: 18, threeMade: 19,
  threeAtt: 20, threePct: 21, blockPct: 22, stealPct: 23, ftRate: 24, year: 25,
  height: 26, jersey: 27, porpag: 28, adjOE: 29, foulRate: 30, season: 31,
  pid: 32, type: 33, recRank: 34, astToRatio: 35, rimMade: 36, rimAtt: 37,
  midMade: 38, midAtt: 39, rimPct: 40, midPct: 41, dunksMade: 42, dunksAtt: 43,
  dunkPct: 44, pick: 45, defensiveRating: 46, adjDRtg: 47, dporpag: 48,
  stops: 49, bpm: 50, obpm: 51, dbpm: 52, gbpm: 53, minutes: 54, ogbpm: 55,
  dgbpm: 56, offensiveRebounds: 57, defensiveRebounds: 58, rebounds: 59,
  assists: 60, steals: 61, blocks: 62, points: 63, role: 64,
} as const;

export type PsliceRow = (string | number | null)[];

/** `top` must be non-empty — an empty value returns []. "all" is every game. */
export type GameFilter = "all" | "H" | "A" | "AN" | "NC" | "ncaa";

export interface TorvikOptions {
  /** Directory for cached responses. Set to null to disable caching. */
  cacheDir?: string | null;
  /** Milliseconds to wait between uncached network calls. */
  throttleMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TorvikClient {
  #cookie: string | null = null;
  #cacheDir: string | null;
  #throttleMs: number;
  #lastCall = 0;

  constructor(opts: TorvikOptions = {}) {
    this.#cacheDir = opts.cacheDir === undefined ? ".cache/torvik" : opts.cacheDir;
    this.#throttleMs = opts.throttleMs ?? 900;
  }

  /** POST once to clear the JS check; the resulting cookie is reused. */
  async #authorize(): Promise<string> {
    if (this.#cookie) return this.#cookie;
    const res = await fetch(`${BASE}/playerstat.php`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "js_test_submitted=1",
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = /js_verified=([^;]+)/.exec(setCookie);
    this.#cookie = `js_verified=${match?.[1] ?? "true"}`;
    return this.#cookie;
  }

  async #throttle(): Promise<void> {
    const wait = this.#throttleMs - (Date.now() - this.#lastCall);
    if (wait > 0) await sleep(wait);
    this.#lastCall = Date.now();
  }

  async #cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    if (!this.#cacheDir) return fetcher();
    const path = join(this.#cacheDir, `${key}.json`);
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      const value = await fetcher();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value));
      return value;
    }
  }

  async #get(url: string): Promise<string> {
    const cookie = await this.#authorize();
    await this.#throttle();
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: cookie, Referer: `${BASE}/playerstat.php` },
    });
    if (!res.ok) throw new Error(`torvik ${res.status} for ${url}`);
    return res.text();
  }

  /**
   * Advanced stats for a date window. `start`/`end` are YYYYMMDD.
   * A same-day window yields one row per player-game.
   */
  async slice(
    season: number, start: string, end: string, top: GameFilter = "all",
  ): Promise<PsliceRow[]> {
    return this.#cached(`slice/${season}-${start}-${end}-${top}`, async () => {
      const url = `${BASE}/pslice.php?year=${season}&top=${top}&start=${start}&end=${end}`;
      const body = await this.#get(url);
      const rows = JSON.parse(body) as PsliceRow[];
      if (!Array.isArray(rows)) throw new Error(`pslice returned non-array for ${url}`);
      return rows;
    });
  }

  /**
   * Season table. The only reason to call this: pslice returns role as "N/A"
   * for every row, and role selects the weight vector. Join on pid.
   */
  async roles(season: number): Promise<Map<string, string>> {
    const rows = await this.#cached(`roles/${season}`, async () => {
      const csv = await this.#get(`${BASE}/getadvstats.php?year=${season}&csv=1`);
      return csv.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
    });
    const out = new Map<string, string>();
    for (const row of rows) {
      const pid = row[COL.pid];
      const role = row[COL.role];
      if (pid && role && role !== "N/A") out.set(String(pid), role);
    }
    return out;
  }
}

export function parseCsvRow(row: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === '"') {
      if (quoted && row[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { values.push(value); value = ""; }
    else value += ch;
  }
  values.push(value);
  return values;
}

export const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
