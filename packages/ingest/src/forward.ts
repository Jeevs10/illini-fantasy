import { createHash } from "node:crypto";
import type { Db } from "@illini/db";
import { insertMany } from "@illini/db";
import { canonicaliseName, normaliseTeam } from "@illini/crosswalk";
import { basketballDate } from "./dates.ts";

/**
 * The Data repo's forward model, as illini-fantasy reads it.
 *
 * One feed a day (`Data/Scripts/forward_model/export_fantasy.py`, written by
 * the morning refresh): every player on a 2026-27 roster with his projected
 * Player Score, and every regular-season box line of the last week with its
 * opponent-adjusted box value — `valAdj`, the number the Daily Update ranks
 * performances by, and the number a fantasy game is worth here.
 *
 * Three rules, each for a reason.
 *
 *   - **A game's score is written once and never again.** The opponent
 *     defences behind `valAdj` are refit every morning, so the same box line
 *     reads a little differently each day. The first value received is the
 *     one the Daily Update showed that morning, and a settled week must not
 *     move because Tuesday's opponent got better in February. The feed resends
 *     the last week so a missed morning is filled by the next one; anything
 *     already stored is left alone.
 *   - **Identity is the forward-model key.** A 2026-27 player is a new
 *     `player` row linked by `player_source_id (forward, key)`, never merged
 *     onto a 2025-26 Torvik row by name: a wrong merge would hand one player's
 *     history and injuries to another, and the draft has no use for last
 *     season's per-game rows anyway. His school can change between feeds (a
 *     late transfer, a roster fix) and follows the feed.
 *   - **A line is matched through the schedule, not its date.** The feed
 *     carries CBBD's game id; the basketball date and both teams come from the
 *     stored `game` row, so a 9pm tip filed under the next UTC day lands on
 *     the night it was played.
 */

export interface ForwardPlayer {
  key: string;
  name: string;
  slug: string;
  team: string;
  cbbdTeamId: number | null;
  pos: string | null;
  yr: string | null;
  ht: string | null;
  status: string | null;
  score: number | null;
  scoreLo: number | null;
  scoreHi: number | null;
  mpg: number | null;
  valueRank: number | null;
  espn: string | null;
  /** Projected fantasy points over every game left on his schedule, and how many. Absent before 2026-10-30. */
  restPoints?: number | null;
  restGames?: number | null;
}

export interface ForwardLine {
  gameId: number;
  date: string;
  key: string | null;
  name: string;
  slug: string | null;
  cbbdTeamId: number | null;
  valAdj: number;
  val: number;
  /** The program terms (level discount and team credit) inside valAdj. Absent before 2026-10-30. */
  valProgram?: number | null;
  gs: number;
  oppDef: number;
  min: number | null;
  pts: number; reb: number; orb: number | null; drb: number | null;
  ast: number; stl: number; blk: number; tov: number; pf: number | null;
  fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
}

export interface ForwardInjury {
  key: string;
  /** The site's wording: "Out", "Out For Season", "Doubtful", "Questionable", "Game Time Decision", "Probable". */
  status: string | null;
  out: boolean;
  seasonOut: boolean;
  injury: string | null;
  since: string | null;
  source: string | null;
}

export interface ForwardFeed {
  season: number;
  asof: string;
  since: string;
  generated: string;
  players: ForwardPlayer[];
  lines: ForwardLine[];
  /** Absent from feeds written before 2026-10-29. */
  injuries?: ForwardInjury[];
  /** Projected valAdj for each upcoming game. Absent from feeds written before 2026-10-30. */
  projections?: ForwardProjection[];
  /** CBBD's whole schedule as of the feed, so conference slates published mid-season arrive. Absent before 2026-10-30. */
  games?: ForwardGame[];
}

export interface ForwardGame {
  gameId: number;
  /** Tip-off, ISO 8601 UTC. */
  start: string;
  homeId: number | null;
  awayId: number | null;
  homeName: string | null;
  awayName: string | null;
  neutral: boolean;
}

export interface ForwardProjection {
  gameId: number;
  date: string;
  key: string;
  cbbdTeamId: number | null;
  proj: number;
  mpg: number | null;
  poss: number;
  oppDef: number;
  /** Listed out on the morning's injury report, so projected at zero. */
  out?: boolean;
}

/** The site's injury wording onto the app's five statuses. Unrecognised wording is questionable, as RotoWire's is. */
export function injuryStatus(i: Pick<ForwardInjury, "status" | "out">): string {
  if (i.out) return "out";
  const s = (i.status ?? "").toLowerCase();
  if (s.startsWith("out")) return "out";
  if (s.startsWith("doubt")) return "doubtful";
  if (s.startsWith("prob")) return "probable";
  if (s.startsWith("avail") || s === "active") return "available";
  return "questionable";
}

/**
 * The scoring config a forward-model league is scored under.
 *
 * Not a `ScoringConfig` — nothing in this app computes the score, the Data
 * repo does — so it is written straight to `scoring_config` rather than
 * through `upsertScoringConfig`. It exists so `player_game_score` rows have a
 * config to key on, the same as every Torvik config, and so a league can name
 * which number it is scored on.
 */
export const FORWARD_CONFIG = {
  model: "forward-valadj",
  version: 1,
  source: "Data/Scripts/forward_model/schedule.py value_adj",
  description: "Opponent-adjusted box value: the Player Score's box weights applied to one game's line, " +
    "plus the opponent's defence by the player's share of the game's possessions.",
} as const;

export const FORWARD_CONFIG_LABEL = "forward-valadj-v1";

export async function forwardConfigId(db: Db): Promise<number> {
  const digest = createHash("sha256").update(JSON.stringify(FORWARD_CONFIG)).digest("hex").slice(0, 32);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO scoring_config (label, config, digest, created_by)
     VALUES ($1, $2, $3, 'forward feed')
     ON CONFLICT (digest) DO UPDATE SET label = scoring_config.label
     RETURNING id`,
    [FORWARD_CONFIG_LABEL, JSON.stringify(FORWARD_CONFIG), digest],
  );
  return Number(rows[0]!.id);
}

export interface ForwardIngestResult {
  players: number;
  created: number;
  projections: number;
  lines: number;
  written: number;
  /** Lines with no forward key, or a key we have no player for. */
  unmatched: number;
  /** Lines whose CBBD game is not in the schedule yet. */
  unscheduled: number;
  /** Availability rows written: new statuses, plus `available` for players who came off the list. */
  injuries: number;
  configId: number;
  /** Game projections written or replaced. */
  gameProjections: number;
  /** Schedule rows added or changed from the feed's games. */
  scheduled: number;
}

/** Rejects a payload that is not a feed, naming what is wrong with it. */
export function assertFeed(value: unknown): asserts value is ForwardFeed {
  const f = value as Partial<ForwardFeed> | null;
  if (!f || typeof f !== "object") throw new Error("feed is not an object");
  if (!Number.isInteger(f.season)) throw new Error("feed has no season");
  if (typeof f.asof !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.asof)) throw new Error("feed has no asof date");
  if (!Array.isArray(f.players)) throw new Error("feed has no players");
  if (!Array.isArray(f.lines)) throw new Error("feed has no lines");
}

export async function ingestForwardFeed(db: Db, feed: ForwardFeed): Promise<ForwardIngestResult> {
  assertFeed(feed);
  const season = feed.season;
  const configId = await forwardConfigId(db);

  // ---- schools, by CBBD id (syncTeams has filled them)
  const loadTeams = async () => new Map(
    (await db.query<{ id: string; cbbd_id: number }>(
      "SELECT id, cbbd_id FROM team WHERE cbbd_id IS NOT NULL")).rows
      .map((r) => [r.cbbd_id, Number(r.id)]),
  );
  let teamOf = await loadTeams();

  // ---- the schedule, before anything is matched against it
  let scheduled = 0;
  if (feed.games !== undefined && feed.games.length > 0) {
    teamOf = await syncTeamsFrom(db, feed.games, teamOf);
    scheduled = await insertMany(db, {
      table: "game",
      columns: ["played_on", "season", "home_team_id", "away_team_id", "neutral_site", "cbbd_id", "tipoff"],
      rows: feed.games
        .filter((g) => g.homeId !== null && g.awayId !== null && teamOf.has(g.homeId) && teamOf.has(g.awayId))
        .map((g) => [basketballDate(g.start), season, teamOf.get(g.homeId!), teamOf.get(g.awayId!),
                     g.neutral, g.gameId, g.start]),
      dedupeOn: [5],
      conflict: `(cbbd_id) DO UPDATE SET played_on = EXCLUDED.played_on,
        home_team_id = EXCLUDED.home_team_id, away_team_id = EXCLUDED.away_team_id,
        neutral_site = EXCLUDED.neutral_site, tipoff = EXCLUDED.tipoff
        WHERE (game.played_on, game.home_team_id, game.away_team_id, game.neutral_site, game.tipoff)
          IS DISTINCT FROM (EXCLUDED.played_on, EXCLUDED.home_team_id, EXCLUDED.away_team_id,
                            EXCLUDED.neutral_site, EXCLUDED.tipoff)`,
    });
  }

  // ---- players: create the ones we have not seen, then bring every one up to date
  const known = async () => new Map(
    (await db.query<{ source_id: string; player_id: string }>(
      "SELECT source_id, player_id FROM player_source_id WHERE source = 'forward'")).rows
      .map((r) => [r.source_id, Number(r.player_id)]),
  );
  let ids = await known();
  const fresh = feed.players.filter((p) => !ids.has(p.key));
  if (fresh.length > 0) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO player (name, normalised, team_id, position, class_year, height)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::bigint[], $4::text[], $5::text[], $6::text[])
       RETURNING id`,
      [
        fresh.map((p) => p.name),
        fresh.map((p) => canonicaliseName(p.name)),
        fresh.map((p) => (p.cbbdTeamId === null ? null : teamOf.get(p.cbbdTeamId) ?? null)),
        fresh.map((p) => p.pos),
        fresh.map((p) => p.yr),
        fresh.map((p) => p.ht),
      ],
    );
    // UNNEST ... RETURNING keeps input order.
    await insertMany(db, {
      table: "player_source_id",
      columns: ["player_id", "source", "source_id", "confidence", "reason"],
      rows: inserted.rows.map((r, i) => [Number(r.id), "forward", fresh[i]!.key, "exact", "source of record"]),
      conflict: "(source, source_id) DO NOTHING",
    });
    ids = await known();
  }

  const current = feed.players.filter((p) => ids.has(p.key));
  if (current.length > 0) {
    await db.query(
      `UPDATE player p SET name = u.name, normalised = u.normalised,
              team_id = coalesce(u.team_id, p.team_id),
              position = coalesce(u.position, p.position),
              class_year = coalesce(u.class_year, p.class_year),
              height = coalesce(u.height, p.height)
         FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[])
              AS u(id, name, normalised, team_id, position, class_year, height)
        WHERE p.id = u.id`,
      [
        current.map((p) => ids.get(p.key)!),
        current.map((p) => p.name),
        current.map((p) => canonicaliseName(p.name)),
        current.map((p) => (p.cbbdTeamId === null ? null : teamOf.get(p.cbbdTeamId) ?? null)),
        current.map((p) => p.pos),
        current.map((p) => p.yr),
        current.map((p) => p.ht),
      ],
    );
  }

  // ESPN ids ride along for the headshots; a confirmed link elsewhere wins.
  await insertMany(db, {
    table: "player_source_id",
    columns: ["player_id", "source", "source_id", "confidence", "reason"],
    rows: current.filter((p) => p.espn).map((p) => [ids.get(p.key)!, "espn", String(p.espn), "exact", "forward feed"]),
    dedupeOn: [1, 2],
    conflict: `(source, source_id) DO UPDATE SET player_id = EXCLUDED.player_id
      WHERE player_source_id.confirmed_at IS NULL`,
  });

  // ---- projections, one row per player per feed day
  const projected = current.filter((p) => p.score !== null && Number.isFinite(p.score));
  await insertMany(db, {
    table: "player_projection",
    columns: ["player_id", "season", "as_of", "score", "score_lo", "score_hi", "mpg", "value_rank", "status",
              "rest_points", "rest_games"],
    rows: projected.map((p) => [ids.get(p.key)!, season, feed.asof, p.score, p.scoreLo, p.scoreHi,
                                p.mpg, p.valueRank, p.status, p.restPoints ?? null, p.restGames ?? null]),
    dedupeOn: [0],
    conflict: `(player_id, season, as_of) DO UPDATE SET score = EXCLUDED.score,
      score_lo = EXCLUDED.score_lo, score_hi = EXCLUDED.score_hi, mpg = EXCLUDED.mpg,
      value_rank = EXCLUDED.value_rank, status = EXCLUDED.status,
      rest_points = EXCLUDED.rest_points, rest_games = EXCLUDED.rest_games`,
  });

  // ---- game lines: through the schedule, written once
  const games = new Map(
    (await db.query<{ id: string; cbbd_id: number; played_on: string; home: string; away: string }>(
      `SELECT id, cbbd_id, to_char(played_on, 'YYYY-MM-DD') AS played_on,
              home_team_id AS home, away_team_id AS away
         FROM game WHERE cbbd_id = ANY($1::int[])`,
      [[...new Set(feed.lines.map((l) => l.gameId))]])).rows
      .map((r) => [r.cbbd_id, r]),
  );

  // The line carries no position; the player's own G / F / C does, and it is
  // what slot eligibility and the role filters read off a stat row.
  const position = new Map(feed.players.map((p) => [p.key, p.pos]));
  let unmatched = 0;
  let unscheduled = 0;
  const stats: unknown[][] = [];
  const scores: unknown[][] = [];
  for (const l of feed.lines) {
    const playerId = l.key === null ? undefined : ids.get(l.key);
    if (playerId === undefined) { unmatched += 1; continue; }
    const g = games.get(l.gameId);
    if (!g) { unscheduled += 1; continue; }
    const own = l.cbbdTeamId === null ? undefined : teamOf.get(l.cbbdTeamId);
    const opponent = own === undefined ? null
      : Number(g.home) === own ? Number(g.away) : Number(g.home);
    const minutes = l.min ?? 0;
    stats.push([
      playerId, g.played_on, season, Number(g.id), opponent, position.get(l.key!) ?? null, minutes,
      JSON.stringify({
        minutes, points: l.pts, rebounds: l.reb, assists: l.ast,
        // The shooting rates the stat surface averages, in Torvik's units
        // (eFG and TS as 0..100, 3P% and FT% as 0..1). Absent with no attempts,
        // so a night without a three does not drag a season 3P% to zero.
        ...(l.fga > 0 ? { effectiveFieldGoalPct: (100 * (l.fgm + 0.5 * l.tpm)) / l.fga } : {}),
        ...(l.fga + 0.44 * l.fta > 0 ? { trueShootingPct: (100 * l.pts) / (2 * (l.fga + 0.44 * l.fta)) } : {}),
        ...(l.tpa > 0 ? { threePointPct: l.tpm / l.tpa } : {}),
        ...(l.fta > 0 ? { freeThrowPct: l.ftm / l.fta } : {}),
        box: {
          steals: l.stl, blocks: l.blk, turnovers: l.tov, fouls: l.pf,
          offensiveRebounds: l.orb, defensiveRebounds: l.drb,
          fieldGoalsMade: l.fgm, fieldGoalsAttempted: l.fga,
          threesMade: l.tpm, threesAttempted: l.tpa,
          freeThrowsMade: l.ftm, freeThrowsAttempted: l.fta,
        },
        forward: { valAdj: l.valAdj, val: l.val, gs: l.gs, oppDef: l.oppDef, asof: feed.asof },
      }),
      "cbbd",
    ]);
    scores.push([
      playerId, g.played_on, configId, "forward",
      JSON.stringify({
        box: l.val,
        opponent: Math.round((l.valAdj - l.val - (l.valProgram ?? 0)) * 10) / 10,
        program: l.valProgram ?? 0,
      }),
      l.val, 1, 1, l.valAdj,
    ]);
  }

  await insertMany(db, {
    table: "player_game_stat",
    columns: ["player_id", "played_on", "season", "game_id", "opponent_team_id", "role", "minutes", "stats", "source"],
    rows: stats,
    dedupeOn: [0, 1],
    conflict: "(player_id, played_on) DO NOTHING",
  });
  const written = await insertMany(db, {
    table: "player_game_score",
    columns: ["player_id", "played_on", "config_id", "archetype", "blocks", "raw", "multiplier", "minutes_gate", "score"],
    rows: scores,
    dedupeOn: [0, 1, 2],
    conflict: "(player_id, played_on, config_id) DO NOTHING",
  });

  const injuries = feed.injuries === undefined ? 0 : await writeInjuries(db, feed.injuries, ids, feed.generated);
  const projections = feed.projections === undefined ? 0 : await writeProjections(db, feed.projections, ids, feed.asof);

  return {
    players: current.length, created: fresh.length, projections: projected.length,
    lines: feed.lines.length, written, unmatched, unscheduled, injuries, configId,
    gameProjections: projections, scheduled,
  };
}

/**
 * Any school on the feed's schedule we have no CBBD id for — a non-D1
 * opponent, mostly — added by name, so its games can be stored. A school we
 * already have under that name gains the id; one we have under the id keeps
 * its row.
 */
async function syncTeamsFrom(
  db: Db, games: ForwardGame[], known: Map<number, number>,
): Promise<Map<number, number>> {
  const missing = new Map<number, string>();
  for (const g of games) {
    if (g.homeId !== null && !known.has(g.homeId) && g.homeName) missing.set(g.homeId, g.homeName);
    if (g.awayId !== null && !known.has(g.awayId) && g.awayName) missing.set(g.awayId, g.awayName);
  }
  if (missing.size === 0) return known;
  await insertMany(db, {
    table: "team",
    columns: ["name", "normalised", "cbbd_id"],
    rows: [...missing].map(([id, name]) => [name, normaliseTeam(name), id]),
    dedupeOn: [1],
    conflict: "(normalised) DO UPDATE SET cbbd_id = coalesce(team.cbbd_id, EXCLUDED.cbbd_id)",
  });
  return new Map(
    (await db.query<{ id: string; cbbd_id: number }>(
      "SELECT id, cbbd_id FROM team WHERE cbbd_id IS NOT NULL")).rows
      .map((r) => [r.cbbd_id, Number(r.id)]),
  );
}

/**
 * The morning's game projections, replacing the last ones for the same games.
 * A game already played keeps the projection it had at tip-off: the feed only
 * sends games that are not final, so nothing overwrites it afterwards.
 */
async function writeProjections(
  db: Db, list: ForwardProjection[], ids: Map<string, number>, asof: string,
): Promise<number> {
  if (list.length === 0) return 0;
  const games = new Map(
    (await db.query<{ id: string; cbbd_id: number; played_on: string }>(
      `SELECT id, cbbd_id, to_char(played_on, 'YYYY-MM-DD') AS played_on
         FROM game WHERE cbbd_id = ANY($1::int[])`,
      [[...new Set(list.map((p) => p.gameId))]])).rows
      .map((r) => [r.cbbd_id, r]),
  );
  const rows: unknown[][] = [];
  for (const p of list) {
    const playerId = ids.get(p.key);
    const g = games.get(p.gameId);
    if (playerId === undefined || !g) continue;
    rows.push([playerId, Number(g.id), g.played_on, p.proj, p.mpg, p.out === true, asof]);
  }
  return insertMany(db, {
    table: "player_game_projection",
    columns: ["player_id", "game_id", "played_on", "projected", "mpg", "listed_out", "as_of"],
    rows,
    dedupeOn: [0, 1],
    conflict: `(player_id, game_id) DO UPDATE SET played_on = EXCLUDED.played_on,
      projected = EXCLUDED.projected, mpg = EXCLUDED.mpg, listed_out = EXCLUDED.listed_out,
      as_of = EXCLUDED.as_of
      WHERE player_game_projection.as_of <= EXCLUDED.as_of`,
  });
}

/**
 * The injury list onto `player_availability`, the table RotoWire's ingest
 * writes and every screen reads. Same two rules as `ingestInjuries`: a status
 * is only written when it changed, and a forward-model player who has dropped
 * off the list gets an explicit `available`, because the table is append-only
 * and his last `out` would otherwise stand all season.
 */
async function writeInjuries(
  db: Db, list: ForwardInjury[], ids: Map<string, number>, generated: string,
): Promise<number> {
  const latest = new Map(
    (await db.query<{ player_id: string; status: string }>(
      `SELECT DISTINCT ON (a.player_id) a.player_id, a.status
         FROM player_availability a
         JOIN player_source_id s ON s.player_id = a.player_id AND s.source = 'forward'
        ORDER BY a.player_id, a.as_of DESC`)).rows
      .map((r) => [Number(r.player_id), r.status]),
  );
  const listed = new Map<number, ForwardInjury>();
  for (const i of list) {
    const id = ids.get(i.key);
    if (id !== undefined) listed.set(id, i);
  }
  const rows: unknown[][] = [];
  for (const [id, i] of listed) {
    const status = injuryStatus(i);
    if (latest.get(id) === status) continue;
    rows.push([id, generated, status, i.injury, i.seasonOut ? "out for the season" : (i.source ?? null)]);
  }
  for (const [id, status] of latest) {
    if (!listed.has(id) && status !== "available") rows.push([id, generated, "available", null, "off the injury list"]);
  }
  return insertMany(db, {
    table: "player_availability",
    columns: ["player_id", "as_of", "status", "injury", "note"],
    rows,
    conflict: "(player_id, as_of) DO NOTHING",
  });
}
