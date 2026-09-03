import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * CollegeBasketballData client.
 *
 * The free tier allows 1,000 calls a month and the server reports what is left
 * in `x-calllimit-remaining` on every response. That budget is small enough
 * that caching is not an optimisation here, it is a correctness requirement:
 * a single careless backfill loop can burn a third of the month. So every
 * response is written to disk gzipped, cached reads never touch the network,
 * and the client refuses to proceed past `minRemaining`.
 *
 * Payloads are large — one date of shooting plays is ~29 MB of JSON, and all
 * plays for a date is roughly 2.4x that.
 */

const BASE = "https://api.collegebasketballdata.com";

export interface CbbdOptions {
  apiKey?: string;
  cacheDir?: string | null;
  /** Refuse to spend the budget below this many remaining calls. */
  minRemaining?: number;
  throttleMs?: number;
}

export interface CbbdUsage {
  /** Calls this client actually sent, excluding cache hits. */
  spent: number;
  /** Cache hits, which cost nothing. */
  cached: number;
  /** Server-reported remaining calls, from the most recent response. */
  remaining: number | null;
}

export class CbbdQuotaError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CbbdClient {
  #key: string;
  #cacheDir: string | null;
  #minRemaining: number;
  #throttleMs: number;
  #lastCall = 0;
  #usage: CbbdUsage = { spent: 0, cached: 0, remaining: null };

  constructor(opts: CbbdOptions = {}) {
    const key = opts.apiKey ?? process.env.CBBD_API_KEY;
    if (!key) throw new Error("CBBD_API_KEY is not set (put it in .env.local)");
    this.#key = key;
    this.#cacheDir = opts.cacheDir === undefined ? ".cache/cbbd" : opts.cacheDir;
    this.#minRemaining = opts.minRemaining ?? 50;
    this.#throttleMs = opts.throttleMs ?? 400;
  }

  get usage(): Readonly<CbbdUsage> { return { ...this.#usage }; }

  async #read<T>(key: string): Promise<T | null> {
    if (!this.#cacheDir) return null;
    try {
      const buf = await readFile(join(this.#cacheDir, `${key}.json.gz`));
      return JSON.parse(gunzipSync(buf).toString("utf8")) as T;
    } catch { return null; }
  }

  async #write(key: string, value: unknown): Promise<void> {
    if (!this.#cacheDir) return;
    const path = join(this.#cacheDir, `${key}.json.gz`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, gzipSync(Buffer.from(JSON.stringify(value), "utf8")));
  }

  async #get<T>(
    path: string, params: Record<string, string | number | boolean | undefined>, cacheKey: string,
  ): Promise<T> {
    const hit = await this.#read<T>(cacheKey);
    if (hit !== null) { this.#usage.cached += 1; return hit; }

    if (this.#usage.remaining !== null && this.#usage.remaining <= this.#minRemaining) {
      throw new CbbdQuotaError(
        `refusing to call ${path}: ${this.#usage.remaining} calls left, floor is ${this.#minRemaining}`,
      );
    }

    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const wait = this.#throttleMs - (Date.now() - this.#lastCall);
    if (wait > 0) await sleep(wait);
    this.#lastCall = Date.now();

    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.#key}` } });
    this.#usage.spent += 1;
    const remaining = res.headers.get("x-calllimit-remaining");
    if (remaining !== null) this.#usage.remaining = Number(remaining);

    if (!res.ok) {
      throw new Error(`cbbd ${res.status} ${res.statusText} for ${url.pathname}${url.search}`);
    }
    const body = (await res.json()) as T;
    await this.#write(cacheKey, body);
    return body;
  }

  teams(season: number): Promise<CbbdTeam[]> {
    return this.#get("/teams", { season }, `teams/${season}`);
  }

  /** `team` is optional — omitting it returns every roster in one call. */
  rosters(season: number, team?: string): Promise<CbbdRoster[]> {
    return this.#get("/teams/roster", { season, team }, `rosters/${season}${team ? `-${team}` : ""}`);
  }

  /** Adjusted efficiency — the opponent-strength input for the multiplier. */
  ratings(season: number): Promise<CbbdRating[]> {
    return this.#get("/ratings/adjusted", { season }, `ratings/${season}`);
  }

  games(season: number, opts: { startDateRange?: string; endDateRange?: string } = {}): Promise<CbbdGame[]> {
    const key = `games/${season}${opts.startDateRange ? `-${opts.startDateRange}-${opts.endDateRange}` : ""}`;
    return this.#get("/games", { season, ...opts }, key);
  }

  /** Transfer portal entries for a recruiting year. */
  portal(year: number): Promise<CbbdTransfer[]> {
    return this.#get("/recruiting/portal", { year }, `portal/${year}`);
  }

  /** Incoming recruits for a year, with stars and composite rating. */
  recruits(year: number): Promise<CbbdRecruit[]> {
    return this.#get("/recruiting/players", { year }, `recruits/${year}`);
  }

  /** One ISO date, e.g. "2026-02-14". `utcOffset` keeps late games on the right day. */
  playsByDate(
    date: string, { shootingPlaysOnly = true, utcOffset }: { shootingPlaysOnly?: boolean; utcOffset?: number } = {},
  ): Promise<CbbdPlay[]> {
    return this.#get(
      "/plays/date",
      { date, shootingPlaysOnly, utcOffset },
      `plays/${date}${shootingPlaysOnly ? "-shots" : "-all"}${utcOffset === undefined ? "" : `-utc${utcOffset}`}`,
    );
  }
}

export interface CbbdTeam {
  id: number; sourceId: string; school: string; mascot: string | null;
  abbreviation: string | null; displayName: string;
  conference: string | null; conferenceId: number | null;
}
export interface CbbdRosterPlayer {
  id: number; sourceId: string | null; name: string;
  firstName: string | null; lastName: string | null;
  jersey: string | null; position: string | null;
  height: number | null; weight: number | null;
  hometown: string | null; dateOfBirth: string | null;
  startSeason: number | null; endSeason: number | null;
}
export interface CbbdRoster {
  teamId: number; teamSourceId: string; team: string;
  conference: string | null; season: number; players: CbbdRosterPlayer[];
}
export interface CbbdRating {
  season: number; teamId: number; team: string; conference: string | null;
  offensiveRating: number | null; defensiveRating: number | null; netRating: number | null;
}
export interface CbbdGame {
  id: number; sourceId: string; startDate: string; season: number;
  homeTeamId: number; homeTeam: string; awayTeamId: number; awayTeam: string;
  neutralSite: boolean; conferenceGame: boolean;
  homePoints: number | null; awayPoints: number | null;
}
export interface CbbdShotInfo {
  shooter: { id: number | null; name: string | null } | null;
  made: boolean | null; range: string | null; assisted: boolean | null;
  assistedBy: { id: number | null; name: string | null } | null;
  location: { x: number | null; y: number | null } | null;
}
export interface CbbdPlay {
  id: number; gameId: number; gameSourceId: string; gameStartDate: string;
  playType: string; teamId: number; team: string; opponent: string;
  period: number; secondsRemaining: number;
  scoringPlay: boolean; shootingPlay: boolean; scoreValue: number | null;
  playText: string | null;
  shotInfo: CbbdShotInfo | null;
  onFloor: { id: number; name: string; team: string }[] | null;
}
export interface CbbdTransfer {
  id: number; sourceId: string | null; year: number;
  firstName: string | null; lastName: string | null; position: string | null;
  origin: string | null; destination: string | null;
  eligibility: string | null; yearsRemaining: number | null;
  stars: number | null; rating: number | null;
}
export interface CbbdRecruit {
  id: number; sourceId: string | null; year: number; name: string;
  position: string | null; school: string | null; committedTo: string | null;
  hometown: string | null; heightInches: number | null; weightPounds: number | null;
  stars: number | null; rating: number | null; ranking: number | null;
}
