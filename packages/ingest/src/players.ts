import { insertMany, type Db } from "@illini/db";
import { canonicaliseName, normaliseTeam, buildIndex, resolve, type SourceRecord } from "@illini/crosswalk";
import type { CbbdClient } from "@illini/sources";
import { teamMap } from "./teams.ts";

export type Source = "torvik" | "cbbd" | "espn" | "ncaa" | "rotowire";

export interface TorvikIdentity {
  pid: string;
  name: string;
  team: string;
  role: string | null;
  height: string | null;
  jersey: string | null;
  classYear: string | null;
}

/**
 * Resolves a night's worth of Torvik players in three statements rather than
 * four per player.
 *
 * Torvik is the identity spine because it is what scoring reads: every player
 * with a stat line gets a row keyed on their `pid`. Other sources crosswalk
 * onto these rows rather than minting their own.
 */
export async function resolveTorvikPlayers(
  db: Db, identities: TorvikIdentity[],
): Promise<Map<string, number>> {
  const known = new Map(
    (await db.query<{ source_id: string; player_id: string }>(
      "SELECT source_id, player_id FROM player_source_id WHERE source = 'torvik'")).rows
      .map((r) => [r.source_id, Number(r.player_id)]),
  );

  const missing = identities.filter((i) => !known.has(i.pid));
  if (missing.length > 0) {
    const teams = await ensureTeams(db, missing.map((m) => m.team));

    // Insert the new players, then read their ids back by their torvik pid,
    // which we stash on the player row's normalised name join below.
    const inserted = await db.query<{ id: string; normalised: string; team_id: string | null }>(
      `INSERT INTO player (name, normalised, team_id, position, class_year, height, jersey)
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::bigint[], $4::text[], $5::text[], $6::text[], $7::text[]
       )
       RETURNING id, normalised, team_id`,
      [
        missing.map((m) => m.name),
        missing.map((m) => canonicaliseName(m.name)),
        missing.map((m) => teams.get(normaliseTeam(m.team)) ?? null),
        missing.map((m) => m.role),
        missing.map((m) => m.classYear),
        missing.map((m) => m.height),
        missing.map((m) => m.jersey),
      ],
    );

    const links: unknown[][] = inserted.rows.map((row, i) => [
      Number(row.id), "torvik", missing[i]!.pid, "exact", "source of record",
    ]);
    await insertMany(db, {
      table: "player_source_id",
      columns: ["player_id", "source", "source_id", "confidence", "reason"],
      dedupeOn: [1, 2],
      rows: links,
      conflict: "(source, source_id) DO NOTHING",
    });

    for (const [i, row] of inserted.rows.entries()) known.set(missing[i]!.pid, Number(row.id));
  }

  await backfillBio(db, identities);
  return known;
}

/**
 * Fills bio columns for players resolved before this field existed.
 *
 * Fill-only — COALESCE only writes where the column is still null — the same
 * rule the rest of this row lives under: `position` is never rewritten after
 * insert either. Torvik's height/jersey/class are stable enough (no player
 * has ever changed role, per the crosswalk audit) that "first value wins" is
 * the right rule here too.
 */
async function backfillBio(db: Db, identities: TorvikIdentity[]): Promise<void> {
  const withBio = identities.filter(
    (i) => i.height !== null || i.jersey !== null || i.classYear !== null,
  );
  if (withBio.length === 0) return;
  await db.query(
    `UPDATE player p SET
       height = COALESCE(p.height, v.height),
       jersey = COALESCE(p.jersey, v.jersey),
       class_year = COALESCE(p.class_year, v.class_year)
     FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
       AS v(pid, height, jersey, class_year)
     JOIN player_source_id psi ON psi.source = 'torvik' AND psi.source_id = v.pid
     WHERE p.id = psi.player_id
       AND (p.height IS NULL OR p.jersey IS NULL OR p.class_year IS NULL)`,
    [
      withBio.map((i) => i.pid),
      withBio.map((i) => i.height),
      withBio.map((i) => i.jersey),
      withBio.map((i) => i.classYear),
    ],
  );
}

/** Creates any team we do not have yet, then returns the full name -> id map. */
export async function ensureTeams(db: Db, names: string[]): Promise<Map<string, number>> {
  const existing = await teamMap(db);
  const seen = new Map<string, unknown[]>();
  for (const name of names) {
    const normalised = normaliseTeam(name);
    if (!normalised || existing.has(normalised) || seen.has(normalised)) continue;
    seen.set(normalised, [name, normalised]);
  }
  if (seen.size === 0) return existing;

  await insertMany(db, {
    table: "team",
    columns: ["name", "normalised"],
    rows: [...seen.values()],
    conflict: "(normalised) DO NOTHING",
  });
  return teamMap(db);
}

export interface LinkResult { linked: number; queued: number }

/**
 * Crosswalks an external source onto players we already have.
 *
 * Anything below `strong` goes to `match_review` instead of being written, so a
 * bad guess never silently attaches an injury or box score to the wrong person.
 * A human-confirmed link is never overwritten by a later automatic one.
 */
export async function linkSource(
  db: Db, source: Exclude<Source, "torvik">, records: SourceRecord[],
): Promise<LinkResult> {
  const { rows } = await db.query<{ id: string; name: string; team: string | null }>(
    `SELECT p.id, p.name, COALESCE(t.name, '') AS team
       FROM player p LEFT JOIN team t ON t.id = p.team_id`,
  );
  const index = buildIndex(rows.map((r): SourceRecord => ({
    source: "internal", sourceId: r.id, name: r.name, team: r.team ?? "",
  })));

  const linked: unknown[][] = [];
  const queued: unknown[][] = [];
  for (const record of records) {
    const match = resolve(record, index);
    if (match.candidate && (match.confidence === "exact" || match.confidence === "strong")) {
      linked.push([Number(match.candidate.sourceId), source, record.sourceId,
                   match.confidence, match.reason]);
    } else {
      queued.push([source, record.sourceId, record.name, record.team,
                   match.candidate ? Number(match.candidate.sourceId) : null,
                   match.confidence, match.reason]);
    }
  }

  await insertMany(db, {
    table: "player_source_id",
    columns: ["player_id", "source", "source_id", "confidence", "reason"],
    rows: linked,
    conflict: `(source, source_id) DO UPDATE SET
      player_id = EXCLUDED.player_id,
      confidence = EXCLUDED.confidence,
      reason = EXCLUDED.reason
      WHERE player_source_id.confirmed_at IS NULL`,
  });
  await insertMany(db, {
    table: "match_review",
    columns: ["source", "source_id", "source_name", "source_team",
              "candidate_player_id", "confidence", "reason"],
dedupeOn: [0, 1],
    rows: queued,
    conflict: `(source, source_id) DO UPDATE SET
      candidate_player_id = EXCLUDED.candidate_player_id,
      confidence = EXCLUDED.confidence,
      reason = EXCLUDED.reason
      WHERE match_review.resolved_at IS NULL`,
  });

  return { linked: linked.length, queued: queued.length };
}

export async function linkCbbdRosters(
  db: Db, cbbd: CbbdClient, season: number,
): Promise<LinkResult> {
  const rosters = await cbbd.rosters(season);
  return linkSource(db, "cbbd", rosters.flatMap((r) =>
    r.players.map((p): SourceRecord => ({
      source: "cbbd", sourceId: String(p.id), name: p.name, team: r.team, position: p.position,
    }))));
}
