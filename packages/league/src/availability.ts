import type { Db } from "@illini/db";

/**
 * Mirrors `packages/ingest/src/injuries.ts`'s `AvailabilityStatus` rather than
 * importing it — ingest and league share no dependency edge, the same
 * boundary reason `RoleTag` in `app/ui/bits.tsx` keeps its own copy of the
 * role table instead of pulling one in from `@illini/league`.
 */
export type AvailabilityStatus = "out" | "doubtful" | "questionable" | "probable" | "available";

export interface PlayerAvailability {
  playerId: number;
  status: AvailabilityStatus;
  injury: string | null;
  note: string | null;
  asOf: string;
}

/**
 * The latest `player_availability` row for each of a set of players.
 *
 * A player absent from the returned map is not "available" — he is a player
 * nothing has ever reported on, which `npm run ingest -- injuries` only ever
 * does for someone RotoWire has mentioned. Reading that as health would claim
 * a fact the ingest never established.
 */
export async function availabilityFor(
  db: Db, playerIds: number[],
): Promise<Map<number, PlayerAvailability>> {
  if (playerIds.length === 0) return new Map();
  const { rows } = await db.query<{
    player_id: string; status: AvailabilityStatus; injury: string | null;
    note: string | null; as_of: Date;
  }>(
    `SELECT DISTINCT ON (player_id) player_id, status, injury, note, as_of
       FROM player_availability
      WHERE player_id = ANY($1)
      ORDER BY player_id, as_of DESC`,
    [playerIds],
  );
  return new Map(rows.map((r) => [Number(r.player_id), {
    playerId: Number(r.player_id), status: r.status, injury: r.injury, note: r.note,
    asOf: r.as_of.toISOString(),
  }]));
}

/** One player's own latest row, or null if nothing has ever been reported. */
export async function availabilityOf(db: Db, playerId: number): Promise<PlayerAvailability | null> {
  return (await availabilityFor(db, [playerId])).get(playerId) ?? null;
}
