import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * ESPN client — the public teams list only.
 *
 * No key, like RotoWire: `site.api.espn.com` is the same public API the ESPN
 * app itself calls. `groups=50` is Division I; without it the endpoint returns
 * every level the sport has. One call returns all ~360 schools, each carrying
 * `color`/`alternateColor` (hex, no leading `#`, sometimes absent) and an
 * `abbreviation` — exactly the identity fields this league has nowhere else to
 * get, since Torvik and CBBD carry neither.
 */

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";

export interface EspnTeam {
  espnId: string;
  /** The school name alone — "Arizona State", not "Arizona State Sun Devils". */
  location: string;
  displayName: string;
  abbreviation: string | null;
  /** Hex, no leading '#'. Null when ESPN carries none for this school. */
  color: string | null;
  alternateColor: string | null;
}

interface RawTeamEntry {
  team: {
    id: string; location: string; displayName: string;
    abbreviation?: string; color?: string; alternateColor?: string;
  };
}

interface RawTeamsResponse {
  sports: [{ leagues: [{ teams: RawTeamEntry[] }] }];
}

export interface EspnOptions {
  /** Directory for cached responses. Set to null to disable caching. */
  cacheDir?: string | null;
}

export class EspnClient {
  #cacheDir: string | null;

  constructor(opts: EspnOptions = {}) {
    this.#cacheDir = opts.cacheDir === undefined ? ".cache/espn" : opts.cacheDir;
  }

  /**
   * Every Division I team ESPN carries. Cached indefinitely rather than by
   * day — colours and abbreviations do not change during a season, and a
   * conference realignment is a rare enough event that a stale cache is a
   * `rm` away, not a bug.
   */
  async teams(): Promise<EspnTeam[]> {
    if (this.#cacheDir) {
      const path = join(this.#cacheDir, "teams.json");
      try {
        return JSON.parse(await readFile(path, "utf8")) as EspnTeam[];
      } catch { /* fall through to fetch */ }
    }
    const teams = await this.#fetch();
    if (this.#cacheDir) {
      const path = join(this.#cacheDir, "teams.json");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(teams));
    }
    return teams;
  }

  async #fetch(): Promise<EspnTeam[]> {
    const url = `${BASE}/teams?limit=500&groups=50`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`espn ${res.status} for ${url}`);
    const data = (await res.json()) as RawTeamsResponse;
    return data.sports[0].leagues[0].teams.map(({ team: t }) => ({
      espnId: t.id,
      location: t.location,
      displayName: t.displayName,
      abbreviation: t.abbreviation ?? null,
      color: t.color ?? null,
      alternateColor: t.alternateColor ?? null,
    }));
  }
}

// ---------- live games ----------

/** A game on ESPN's scoreboard, as far as live scoring needs it. */
export interface EspnLiveEvent {
  eventId: string;
  /** ESPN's game state: before tip, in progress, over. */
  state: "pre" | "in" | "post";
  /** "2nd - 8:41", "Halftime", "Final", "Final/OT". */
  detail: string;
  /** Tip-off, ISO 8601 UTC. */
  start: string;
  /** False when ESPN's start is a placeholder (its 11:59pm Eastern) rather than an announced time. */
  timeValid: boolean;
  teams: { espnId: string; location: string; homeAway: "home" | "away"; score: number }[];
}

export interface EspnBoxLine {
  athleteId: string;
  name: string;
  min: number; pts: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  orb: number; drb: number; reb: number; ast: number; stl: number; blk: number; tov: number; pf: number;
}

export interface EspnBox {
  eventId: string;
  state: "pre" | "in" | "post";
  detail: string;
  teams: { espnId: string; location: string; players: EspnBoxLine[] }[];
}

interface RawCompetitor { homeAway: "home" | "away"; score?: string; team: { id: string; location: string } }
interface RawStatus { type: { state: "pre" | "in" | "post"; detail?: string; shortDetail?: string } }
interface RawScoreboard {
  events: { id: string; date: string; competitions: { competitors: RawCompetitor[]; status: RawStatus; timeValid?: boolean }[] }[];
}
interface RawSummary {
  header: { id: string; competitions: { status: RawStatus }[] };
  boxscore?: {
    players?: {
      team: { id: string; location: string };
      statistics: { names: string[]; athletes: { athlete: { id: string; displayName: string }; stats: string[] }[] }[];
    }[];
  };
}

/**
 * Live games for scoring in progress. No file cache, unlike `teams()`: a box
 * score is stale in seconds. Responses are kept in memory for LIVE_TTL_MS so a
 * busy page (every matchup asking about the same games) costs one fetch per
 * game per window, which keeps a full Saturday slate well inside what the
 * public API tolerates.
 */
const LIVE_TTL_MS = 20_000;
const liveCache = new Map<string, { at: number; value: Promise<unknown> }>();

async function liveJson<T>(url: string): Promise<T> {
  const hit = liveCache.get(url);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.value as Promise<T>;
  const value = fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`espn ${res.status} for ${url}`);
    return res.json() as Promise<T>;
  });
  liveCache.set(url, { at: Date.now(), value });
  value.catch(() => liveCache.delete(url));
  return value;
}

const made = (s: string | undefined): [number, number] => {
  const [m, a] = (s ?? "0-0").split("-").map((x) => Number(x) || 0);
  return [m ?? 0, a ?? 0];
};

/** Every D1 game ESPN lists for a date (YYYY-MM-DD, ESPN's own day). */
export async function espnScoreboard(date: string): Promise<EspnLiveEvent[]> {
  const data = await liveJson<RawScoreboard>(
    `${BASE}/scoreboard?dates=${date.replaceAll("-", "")}&groups=50&limit=500`);
  return data.events.map((e) => {
    const c = e.competitions[0]!;
    return {
      eventId: e.id,
      state: c.status.type.state,
      detail: c.status.type.shortDetail ?? c.status.type.detail ?? "",
      start: new Date(e.date).toISOString(),
      timeValid: c.timeValid !== false,
      teams: c.competitors.map((t) => ({
        espnId: t.team.id, location: t.team.location, homeAway: t.homeAway, score: Number(t.score ?? 0),
      })),
    };
  });
}

/** One game's box score so far, player by player. */
export async function espnBox(eventId: string): Promise<EspnBox> {
  const data = await liveJson<RawSummary>(`${BASE}/summary?event=${eventId}`);
  const status = data.header.competitions[0]!.status.type;
  return {
    eventId,
    state: status.state,
    detail: status.shortDetail ?? status.detail ?? "",
    teams: (data.boxscore?.players ?? []).map((t) => {
      const block = t.statistics[0];
      const col = (name: string) => block?.names.indexOf(name) ?? -1;
      const [iMin, iPts, iFg, i3, iFt, iReb, iAst, iTo, iStl, iBlk, iOr, iDr, iPf] =
        ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF"].map(col);
      return {
        espnId: t.team.id,
        location: t.team.location,
        players: (block?.athletes ?? []).filter((a) => a.stats.length > 0).map((a) => {
          const n = (i: number | undefined) => (i === undefined || i < 0 ? 0 : Number(a.stats[i]) || 0);
          const [fgm, fga] = made(a.stats[iFg!]);
          const [tpm, tpa] = made(a.stats[i3!]);
          const [ftm, fta] = made(a.stats[iFt!]);
          return {
            athleteId: a.athlete.id, name: a.athlete.displayName,
            min: n(iMin), pts: n(iPts), fgm, fga, tpm, tpa, ftm, fta,
            orb: n(iOr), drb: n(iDr), reb: n(iReb), ast: n(iAst), stl: n(iStl), blk: n(iBlk), tov: n(iTo), pf: n(iPf),
          };
        }),
      };
    }),
  };
}
