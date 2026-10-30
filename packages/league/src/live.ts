import type { Db } from "@illini/db";
import type { MatchupView } from "./views.ts";

/**
 * Live scoring: what a game still being played is worth so far.
 *
 * The number is valAdj — the forward model's game score (Data/Scripts/
 * forward_model/schedule.py value_adj) — computed on the box score as it
 * stands, with this morning's team ratings from the feed (migration 020).
 * The morning feed then files the real valAdj for the game, and that stored
 * score is what a week settles on: nothing here is ever written down or
 * summed into a settled total. The two differ only by possessions (the model
 * reads CBBD's team box; this estimates them from the live line) and by the
 * ratings moving overnight, so the live figure lands within a few tenths.
 *
 * Box scores arrive through `LiveSource`, so this package stays free of the
 * network: the web app hands it ESPN's scoreboard and summary endpoints
 * (@illini/sources espnScoreboard / espnBox) and the crosswalk's team
 * normaliser, the same name match `syncTeamIdentity` uses for ESPN schools.
 */

export interface LiveBoxLine {
  athleteId: string;
  /** ESPN's display name, for players the crosswalk has no ESPN id for. */
  name?: string;
  min: number; pts: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  orb: number; drb: number; reb: number; ast: number; stl: number; blk: number; tov: number; pf: number;
}

type GameStateCode = "pre" | "in" | "post";

export interface LiveSource {
  scoreboard(date: string): Promise<{
    eventId: string; state: GameStateCode; detail: string;
    teams: { location: string; score: number }[];
  }[]>;
  box(eventId: string): Promise<{
    eventId: string; state: GameStateCode; detail: string;
    teams: { location: string; players: LiveBoxLine[] }[];
  }>;
  /** A school name as ESPN writes it -> team.normalised. */
  teamKey(location: string): string;
  /**
   * Which of one school's box lines is this player, for players the crosswalk
   * has no ESPN id for: an athlete id, or null when no single line is a safe
   * match. The web app answers with the crosswalk's team-scoped resolver
   * (exact name, first initial + surname, then spelling drift).
   */
  pickByName(lines: { athleteId: string; name: string }[], name: string): string | null;
}

/** schedule.py live_scoring(), as the feed sends it. */
export interface LiveParams {
  box: Record<"pts" | "shots" | "ast" | "tov" | "orb" | "drb" | "stl" | "blk" | "pf", number>;
  oppDefK: number;
  levelK: number;
  levelRef: number;
  teamW: number;
  ftPoss: number;
  worstDef: number;
}

export interface LiveLine {
  playerId: number;
  playedOn: string;
  /** Provisional valAdj so far; null when no feed has sent the ratings to score with. */
  points: number | null;
  /** The game is over; the morning feed has not filed it yet. */
  final: boolean;
  /** ESPN's clock: "2nd - 8:41", "Halftime", "Final". */
  detail: string;
  /** Score as his school sees it, and the opponent. */
  us: number; them: number; opponent: string;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number;
}

export const liveKey = (playerId: number, playedOn: string) => `${playerId}|${playedOn}`;

/**
 * value_adj for one line: the box weights, plus the opponent's defence by the
 * player's share of the game's possessions, less the program terms at his own
 * school (level discount below `levelRef`, team credit above it).
 */
export function liveValue(
  l: LiveBoxLine,
  ctx: { oppDef: number; poss: number; teamMin: number; net: number },
  p: LiveParams,
): number {
  const w = p.box;
  const box = (w.pts * l.pts + w.shots * (l.fga + 0.44 * l.fta) + w.ast * l.ast + w.tov * l.tov + w.orb * l.orb
    + w.drb * l.drb + w.stl * l.stl + w.blk * l.blk + w.pf * l.pf) / 100;
  const share = (ctx.poss * 5 * l.min) / (ctx.teamMin || 200) / 100;
  const level = p.levelK * Math.max(0, p.levelRef - ctx.net) - p.teamW * (ctx.net - p.levelRef);
  return box + p.oppDefK * ctx.oppDef * share - level * share;
}

/** A team's possessions from its live line, the estimate schedule.py falls back on. */
export function livePossessions(players: LiveBoxLine[], ftPoss: number): number {
  const t = players.reduce((a, x) => ({
    fga: a.fga + x.fga, orb: a.orb + x.orb, tov: a.tov + x.tov, fta: a.fta + x.fta,
  }), { fga: 0, orb: 0, tov: 0, fta: 0 });
  return t.fga - t.orb + t.tov + ftPoss * t.fta;
}

/**
 * Live lines for the given player-nights: every one whose game ESPN shows in
 * progress or over. A night whose game has not tipped, or that ESPN does not
 * carry, or a player it cannot place (no ESPN id, or a school name the
 * crosswalk misses) is simply absent — the page keeps showing the projection.
 */
export async function liveLines(
  db: Db, source: LiveSource, want: { playerId: number; playedOn: string }[],
): Promise<Map<string, LiveLine>> {
  const out = new Map<string, LiveLine>();
  if (want.length === 0) return out;
  const playerIds = [...new Set(want.map((w) => w.playerId))];
  const dates = [...new Set(want.map((w) => w.playedOn))].sort();
  const lastDate = dates[dates.length - 1]!;

  const [players, params, ratings] = await Promise.all([
    db.query<{ id: string; espn: string | null; team: string | null; name: string }>(
      `SELECT p.id, s.source_id AS espn, t.normalised AS team, p.name
         FROM player p
         LEFT JOIN team t ON t.id = p.team_id
         LEFT JOIN player_source_id s ON s.player_id = p.id AND s.source = 'espn'
        WHERE p.id = ANY($1::bigint[])`,
      [playerIds],
    ),
    db.query<{ params: LiveParams }>(
      `SELECT params FROM forward_live_params WHERE as_of <= $1 ORDER BY as_of DESC LIMIT 1`, [lastDate]),
    db.query<{ normalised: string; def: number | null; net: number | null }>(
      `SELECT DISTINCT ON (r.team_id) t.normalised, r.def, r.net
         FROM forward_team_rating r JOIN team t ON t.id = r.team_id
        WHERE r.as_of <= $1
        ORDER BY r.team_id, r.as_of DESC`,
      [lastDate],
    ),
  ]);
  const p = params.rows[0]?.params ?? null;
  const rating = new Map(ratings.rows.map((r) => [r.normalised, r]));
  const byEspn = new Map<string, number[]>();
  const teamOf = new Map<number, string>();
  // No ESPN id (about a fifth of rotation players): matched by name inside his
  // own school's box instead (source.pickByName), among the lines no ESPN id
  // has already claimed, so two players can never share one line.
  const byName = new Map<string, { id: number; name: string }[]>();
  for (const r of players.rows) {
    if (r.team) teamOf.set(Number(r.id), r.team);
    if (r.espn) byEspn.set(r.espn, [...(byEspn.get(r.espn) ?? []), Number(r.id)]);
    else if (r.team) byName.set(r.team, [...(byName.get(r.team) ?? []), { id: Number(r.id), name: r.name }]);
  }
  const wanted = new Set(want.map((w) => liveKey(w.playerId, w.playedOn)));

  for (const date of dates) {
    const schools = new Set(want.filter((w) => w.playedOn === date).map((w) => teamOf.get(w.playerId)).filter(Boolean));
    if (schools.size === 0) continue;
    const events = (await source.scoreboard(date).catch(() => []))
      .filter((e) => e.state !== "pre" && e.teams.some((t) => schools.has(source.teamKey(t.location))));
    const boxes = await Promise.all(events.map((e) => source.box(e.eventId).catch(() => null)));
    boxes.forEach((box, i) => {
      if (box === null || box.teams.length !== 2) return;
      const ev = events[i]!;
      box.teams.forEach((side, s) => {
        const other = box.teams[1 - s]!;
        const ownKey = source.teamKey(side.location);
        const oppKey = source.teamKey(other.location);
        const poss = livePossessions(side.players, p?.ftPoss ?? 0.475);
        const teamMin = side.players.reduce((a, x) => a + x.min, 0);
        const oppDef = rating.get(oppKey)?.def ?? p?.worstDef ?? 0;
        const net = rating.get(ownKey)?.net ?? p?.levelRef ?? 15;
        const sb = ev.teams.find((t) => source.teamKey(t.location) === ownKey);
        const sbOpp = ev.teams.find((t) => source.teamKey(t.location) === oppKey);
        const named = new Map<string, number[]>();
        const open = side.players
          .filter((l) => l.name && !byEspn.has(l.athleteId))
          .map((l) => ({ athleteId: l.athleteId, name: l.name! }));
        for (const x of byName.get(ownKey) ?? []) {
          const hit = open.length > 0 ? source.pickByName(open, x.name) : null;
          if (hit !== null && !named.has(hit)) named.set(hit, [x.id]);
        }
        for (const line of side.players) {
          for (const playerId of [...(byEspn.get(line.athleteId) ?? []), ...(named.get(line.athleteId) ?? [])]) {
            const k = liveKey(playerId, date);
            if (!wanted.has(k)) continue;
            out.set(k, {
              playerId, playedOn: date,
              points: p && line.min > 0 ? Math.round(liveValue(line, { oppDef, poss, teamMin, net }, p) * 10) / 10
                : p ? 0 : null,
              final: box.state === "post",
              detail: box.detail || ev.detail,
              us: sb?.score ?? 0, them: sbOpp?.score ?? 0, opponent: other.location,
              min: line.min, pts: line.pts, reb: line.reb, ast: line.ast, stl: line.stl, blk: line.blk, tov: line.tov,
            });
          }
        }
      });
    });
  }
  return out;
}

// ---------- folding live lines into a matchup ----------

/**
 * How much of a game is still to play, from ESPN's clock: "1st - 12:00" is 32
 * of 40 minutes, "Halftime" half, "2nd - 8:41" 8.7 of 40, overtime or a final
 * nothing. A clock it cannot read counts as half, so the projection neither
 * vanishes nor doubles.
 */
export function remainingShare(detail: string, final: boolean): number {
  if (final) return 0;
  const d = detail.toLowerCase();
  if (d.includes("half") && !d.includes("2nd") && !d.includes("1st")) return 0.5;
  if (d.includes("ot")) return 0;
  const m = d.match(/(1st|2nd)\D*?(\d{1,2}):(\d{2})/);
  if (!m) return 0.5;
  const left = Number(m[2]) + Number(m[3]) / 60;
  return Math.max(0, Math.min(1, ((m[1] === "1st" ? 20 : 0) + left) / 40));
}

type Side = MatchupView["home"];

function sideWithLive(side: Side, live: Map<string, LiveLine>): Side {
  let add = 0;
  let projDelta = 0;
  const perPlayer = new Map<number, { points: number; projDelta: number }>();
  for (const g of side.pending) {
    const l = live.get(liveKey(g.playerId, g.playedOn));
    if (!l || l.points === null) continue;
    const expected = l.points + g.projected * remainingShare(l.detail, l.final);
    add += l.points;
    projDelta += expected - g.projected;
    const p = perPlayer.get(g.playerId) ?? { points: 0, projDelta: 0 };
    perPlayer.set(g.playerId, { points: p.points + l.points, projDelta: p.projDelta + expected - g.projected });
  }
  if (perPlayer.size === 0) return side;
  return {
    ...side,
    total: side.total + add,
    projected: side.projected + projDelta,
    liveTotal: add,
    players: side.players.map((p) => {
      const l = perPlayer.get(p.playerId);
      return l ? { ...p, total: p.total + l.points, projected: (p.projected ?? p.total) + l.projDelta, live: l.points } : p;
    }),
  };
}

/**
 * A matchup with tonight's live points in it: each side's total carries them
 * (marked by `liveTotal`, so a screen can say how much is provisional), and
 * its projection swaps a live game's pregame projection for what is banked so
 * far plus the projection's share of the time left. Settlement never reads
 * this; it is for display.
 */
export function withLive(view: MatchupView, live: Map<string, LiveLine>): MatchupView {
  if (live.size === 0) return view;
  return { ...view, home: sideWithLive(view.home, live), away: sideWithLive(view.away, live) };
}
