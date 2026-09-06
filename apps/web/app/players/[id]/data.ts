import {
  availabilityOf, playerCard, playerRankTrend, playerWeekProjection, seasonAverages,
  statPercentiles, type PlayerAvailability, type PlayerCard, type RankPoint,
  type StatAverages, type StatKey, type StatPercentile, type WeekProjection,
} from "@illini/league";
import { db } from "../../../lib/db.ts";
import { viewDate } from "../../../lib/session.ts";

export interface PlayerCardData {
  card: PlayerCard;
  rankTrend: RankPoint[];
  averages: StatAverages | null;
  projection: WeekProjection;
  availability: PlayerAvailability | null;
  percentileOf: Map<StatKey, StatPercentile>;
}

function shiftDate(iso: string, byDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + byDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Everything the player card needs, one call for whichever shell renders it —
 * the full page or the intercepted modal. Kept here rather than duplicated in
 * both routes, since the two must show the same numbers for the same player.
 */
export async function loadPlayerCard(
  playerId: number, viewer: { leagueId: number; season: number; configId: number },
): Promise<PlayerCardData | null> {
  const { leagueId, season, configId } = viewer;
  const today = viewDate();
  const card = await playerCard(db, { playerId, configId, season, leagueId, asOf: today });
  if (!card) return null;

  const seasonStart = `${season - 1}-11-01`;
  const [rankTrend, averages, projection, availability] = await Promise.all([
    playerRankTrend(db, { playerId, configId, from: seasonStart, to: today }),
    seasonAverages(db, { playerId, season, asOf: today }),
    playerWeekProjection(db, { playerId, configId, from: today, to: shiftDate(today, 6) }),
    availabilityOf(db, playerId),
  ]);
  const percentiles = card.role
    ? await statPercentiles(db, { playerId, season, role: card.role, asOf: today })
    : [];

  return {
    card, rankTrend, averages, projection, availability,
    percentileOf: new Map(percentiles.map((p) => [p.stat, p])),
  };
}
