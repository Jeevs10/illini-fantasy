import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * RotoWire client — the injury report only.
 *
 * No key and no auth handshake, unlike Torvik: a single GET returns the whole
 * day's injury report, every team and position, as JSON. Already proven in
 * this repo (`scripts/crosswalk.ts`), which measured this repo's crosswalk
 * against it at 92.5% matched, 4.9% genuinely unexplained.
 */

const BASE = "https://www.rotowire.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface RotowireInjury {
  id: string;
  player: string;
  team: string;
  position: string;
  injury: string;
  status: string;
}

interface RawInjuryRow {
  ID: string;
  player: string;
  team: string;
  position: string;
  injury: string;
  status: string;
}

export interface RotoWireOptions {
  /** Directory for cached responses. Set to null to disable caching. */
  cacheDir?: string | null;
  throttleMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RotoWireClient {
  #cacheDir: string | null;
  #throttleMs: number;
  #lastCall = 0;

  constructor(opts: RotoWireOptions = {}) {
    this.#cacheDir = opts.cacheDir === undefined ? ".cache/rotowire" : opts.cacheDir;
    this.#throttleMs = opts.throttleMs ?? 500;
  }

  async #throttle(): Promise<void> {
    const wait = this.#throttleMs - (Date.now() - this.#lastCall);
    if (wait > 0) await sleep(wait);
    this.#lastCall = Date.now();
  }

  /**
   * The full injury report. Cached by calendar day — the point of a re-run
   * within a day is replaying the crosswalk against a stable list, not
   * catching an intraday status change.
   */
  async injuries(day: string = new Date().toISOString().slice(0, 10)): Promise<RotowireInjury[]> {
    if (!this.#cacheDir) return this.#fetch();
    const path = join(this.#cacheDir, `injuries-${day}.json`);
    try {
      return JSON.parse(await readFile(path, "utf8")) as RotowireInjury[];
    } catch {
      const rows = await this.#fetch();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(rows));
      return rows;
    }
  }

  async #fetch(): Promise<RotowireInjury[]> {
    await this.#throttle();
    const url = `${BASE}/cbasketball/tables/injury-report.php?team=ALL&pos=ALL&conf=ALL&site=other&slateID=null`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: `${BASE}/cbasketball/injury-report.php` },
    });
    if (!res.ok) throw new Error(`rotowire ${res.status} for ${url}`);
    const rows = (await res.json()) as RawInjuryRow[];
    return rows.map((r) => ({
      id: r.ID, player: r.player, team: r.team, position: r.position,
      injury: r.injury, status: r.status,
    }));
  }
}
