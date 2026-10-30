import { buildIndex, normaliseTeam, resolve } from "@illini/crosswalk";
import type { LiveLine, LiveSource, MatchupView } from "@illini/league";
import { liveLines, withLive } from "@illini/league";
import { espnBox, espnScoreboard } from "@illini/sources";
import { db } from "./db.ts";

/**
 * A player with no ESPN id, found in his own school's box: the crosswalk's
 * resolver over just those dozen lines, where a fuzzy match is safe
 * (crosswalk/match.ts). Anything short of one clear candidate is no match.
 */
function pickByName(lines: { athleteId: string; name: string }[], name: string): string | null {
  const team = "box";
  const index = buildIndex(lines.map((l) => ({ source: "espn", sourceId: l.athleteId, name: l.name, team })));
  const m = resolve({ source: "player", sourceId: "", name, team }, index);
  return m.confidence === "none" || m.candidate === null ? null : m.candidate.sourceId;
}

/** ESPN's public scoreboard and box scores; schools matched with the crosswalk's normaliser. */
const espnLive: LiveSource = { scoreboard: espnScoreboard, box: espnBox, teamKey: normaliseTeam, pickByName };

/**
 * Matchups with tonight's games in them as they stand: every pending game that
 * has tipped off is looked up on ESPN and scored provisionally (see
 * @illini/league live.ts). A failure anywhere — ESPN down, a feed that has not
 * sent ratings yet — leaves the matchups exactly as they were.
 */
export async function liveMatchups(views: MatchupView[], now: Date): Promise<{
  views: MatchupView[]; live: Map<string, LiveLine>;
}> {
  const want = views
    .flatMap((v) => [...v.home.pending, ...v.away.pending])
    .filter((g) => g.tipoff !== null && new Date(g.tipoff) <= now)
    .map((g) => ({ playerId: g.playerId, playedOn: g.playedOn }));
  const live = await liveLines(db, espnLive, want).catch(() => new Map<string, LiveLine>());
  return { views: views.map((v) => withLive(v, live)), live };
}
