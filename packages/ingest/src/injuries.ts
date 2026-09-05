import type { Db } from "@illini/db";
import { insertMany } from "@illini/db";
import type { SourceRecord } from "@illini/crosswalk";
import type { RotoWireClient } from "@illini/sources";
import { linkSource, type LinkResult } from "./players.ts";

/**
 * The fixed vocabulary `player_availability.status` is written under.
 *
 * RotoWire's own `status` column is free text ("Out", "Out For Season",
 * "Day-To-Day", "GTD", ...) — normalised here so every reader checks one of
 * five values instead of guessing at RotoWire's wording. Kept independent of
 * `packages/league/src/availability.ts`'s copy of the same type rather than a
 * shared import: ingest and league share no dependency edge today, the same
 * boundary reason `RoleTag` keeps its own copy of the role table instead of
 * importing `@illini/league`.
 */
export type AvailabilityStatus = "out" | "doubtful" | "questionable" | "probable" | "available";

const STATUS_ALIASES: Record<string, AvailabilityStatus> = {
  "out": "out", "out for season": "out", "out indefinitely": "out",
  "ir": "out", "injured reserve": "out", "suspended": "out",
  "doubtful": "doubtful",
  "questionable": "questionable", "day-to-day": "questionable", "day to day": "questionable",
  "game-time decision": "questionable", "game time decision": "questionable", "gtd": "questionable",
  "probable": "probable",
  "available": "available", "active": "available", "healthy": "available",
};

/**
 * Unrecognised wording defaults to `questionable`, not `available` — RotoWire
 * only lists a player at all because something is being said about him, so
 * the safe reading of an unmapped status is doubt, not health.
 */
export function normaliseStatus(raw: string): AvailabilityStatus {
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? "questionable";
}

export interface InjuryIngestResult extends LinkResult {
  written: number;
  /** Of `written`, how many are a player who dropped off today's report. */
  cleared: number;
}

/**
 * Crosswalks the day's RotoWire injury report onto known players and writes
 * `player_availability`.
 *
 * `player_availability` is append-only, one row per `(player_id, as_of)` — so
 * a player who recovers and drops off RotoWire's list has to be told so
 * explicitly, or his last reported status ("out") stands forever. Anyone
 * whose latest row is not already `available` and who is absent from today's
 * report gets one written here, same `as_of`, status `available`.
 */
export async function ingestInjuries(
  db: Db, rotowire: RotoWireClient, asOf: Date = new Date(),
): Promise<InjuryIngestResult> {
  const report = await rotowire.injuries();
  const records: SourceRecord[] = report.map((r) => ({
    source: "rotowire", sourceId: r.id, name: r.player, team: r.team, position: r.position,
  }));
  const link = await linkSource(db, "rotowire", records);

  const { rows: sourced } = await db.query<{ source_id: string; player_id: string }>(
    `SELECT source_id, player_id FROM player_source_id
      WHERE source = 'rotowire' AND source_id = ANY($1)`,
    [report.map((r) => r.id)],
  );
  const playerIdBySource = new Map(sourced.map((r) => [r.source_id, Number(r.player_id)]));

  const reported: unknown[][] = [];
  const reportedIds = new Set<number>();
  for (const row of report) {
    const playerId = playerIdBySource.get(row.id);
    if (playerId === undefined) continue;
    reportedIds.add(playerId);
    reported.push([playerId, asOf, normaliseStatus(row.status), row.injury || null, null]);
  }

  const { rows: lastKnown } = await db.query<{ player_id: string; status: string }>(
    `SELECT DISTINCT ON (player_id) player_id, status
       FROM player_availability
      ORDER BY player_id, as_of DESC`,
  );
  const cleared: unknown[][] = lastKnown
    .filter((r) => r.status !== "available" && !reportedIds.has(Number(r.player_id)))
    .map((r) => [Number(r.player_id), asOf, "available", null, "cleared from RotoWire's report"]);

  const rows = [...reported, ...cleared];
  const written = await insertMany(db, {
    table: "player_availability",
    columns: ["player_id", "as_of", "status", "injury", "note"],
    dedupeOn: [0, 1],
    rows,
    conflict: `(player_id, as_of) DO UPDATE SET
      status = EXCLUDED.status, injury = EXCLUDED.injury, note = EXCLUDED.note`,
  });

  return { ...link, written, cleared: cleared.length };
}
