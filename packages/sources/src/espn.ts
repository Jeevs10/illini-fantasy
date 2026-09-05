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
