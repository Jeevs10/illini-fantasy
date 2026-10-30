import type { Db } from "@illini/db";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

/**
 * One team's week in an `everyone` league, as its manager needs to read it.
 *
 * There is no lineup, so the page is not "who do I start" but "who is
 * counting, and what changes on Sunday". Three groups, all from tenures:
 *
 *   - **counting**: held at the lock that opened the period, off IR. Every
 *     game they play this week scores — including a player since dropped or
 *     traded away, who is still this team's until Saturday.
 *   - **next week**: held now but not at the lock — a waiver win, a pickup,
 *     a trade, a return from IR. Nothing they play this week counts here.
 *   - **IR**: on injured reserve at the lock, or moved there since; neither
 *     scores.
 *
 * The same rule the `fielded` view applies, so this page and the matchup
 * cannot disagree about the week.
 */

export interface WeekGame {
  playedOn: string;
  tipoff: string | null;
  opponent: string | null;
  /** The game's valAdj once its line is in, else null. */
  score: number | null;
  /** The model's projection for the game, when the feed has one. */
  projected: number | null;
}

export interface WeekPlayer {
  playerId: number;
  name: string;
  teamName: string | null;
  primaryColor: string | null;
  role: string | null;
  projected: number | null;
  /** Counting this week. */
  counting: boolean;
  /** Still held now. False for a player let go since the lock, who counts through Saturday. */
  held: boolean;
  /** On IR now. */
  reserve: boolean;
  games: WeekGame[];
  scored: number;
  /** Where his week lands: what he has scored, plus the projection for every game not yet in. Zero if not counting. */
  projectedWeek: number;
}

/** The instant a period locks: its first day at the waiver hour, UTC. */
export function lockOf(startsOn: string, settings: LeagueSettings = DEFAULT_SETTINGS): Date {
  return new Date(Date.UTC(
    Number(startsOn.slice(0, 4)), Number(startsOn.slice(5, 7)) - 1, Number(startsOn.slice(8, 10)),
    settings.waiverHour, 0, 0, 0));
}

export async function weekRoster(
  db: Db, { fantasyTeamId, from, to, configId, season, settings, now = new Date(), today }: {
    fantasyTeamId: number; from: string; to: string; configId: number; season: number;
    settings: LeagueSettings; now?: Date;
    /** The viewing date: a score dated after it is the future and not shown. */
    today: string;
  },
): Promise<WeekPlayer[]> {
  const lock = lockOf(from, settings);
  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null; primary_color: string | null;
    role: string | null; projected: number | null;
    counting: boolean; held: boolean; reserve_now: boolean;
  }>(
    `WITH tenure AS (
       SELECT r.player_id, r.reserve,
              coalesce(r.acquired_at, r.acquired_on::timestamp AT TIME ZONE 'UTC') AS opened,
              r.released_at AS closed, r.released_on
         FROM roster_slot r WHERE r.fantasy_team_id = $1
     ),
     at_lock AS (
       SELECT player_id, bool_or(NOT reserve) AS counting FROM tenure
        WHERE opened <= $2 AND (closed IS NULL OR closed > $2)
          AND (released_on IS NULL OR closed IS NOT NULL OR released_on > $4::date)
        GROUP BY player_id
     ),
     held AS (
       SELECT player_id, bool_or(reserve) AS reserve FROM tenure
        WHERE closed IS NULL AND released_on IS NULL AND opened <= $3
        GROUP BY player_id
     ),
     who AS (SELECT player_id FROM at_lock UNION SELECT player_id FROM held)
     SELECT p.id AS player_id, p.name, t.name AS team_name, t.primary_color,
            coalesce((SELECT st.role FROM player_game_stat st
                       WHERE st.player_id = p.id AND st.role IS NOT NULL
                       ORDER BY st.played_on DESC LIMIT 1), p.position) AS role,
            (SELECT pp.score FROM player_projection pp
              WHERE pp.player_id = p.id AND pp.season = $5 ORDER BY pp.as_of DESC LIMIT 1) AS projected,
            coalesce(at_lock.counting, false) AS counting,
            held.player_id IS NOT NULL AS held,
            coalesce(held.reserve, false) AS reserve_now
       FROM who
       JOIN player p ON p.id = who.player_id
       LEFT JOIN team t ON t.id = p.team_id
       LEFT JOIN at_lock ON at_lock.player_id = who.player_id
       LEFT JOIN held ON held.player_id = who.player_id`,
    [fantasyTeamId, lock, now, from, season],
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => Number(r.player_id));
  const { rows: games } = await db.query<{
    player_id: string; played_on: string; tipoff: Date | null; opponent: string | null; score: number | null;
    projected: number | null;
  }>(
    `SELECT DISTINCT ON (p.id, g.played_on) p.id AS player_id,
            to_char(g.played_on, 'YYYY-MM-DD') AS played_on, g.tipoff,
            opp.name AS opponent,
            CASE WHEN g.played_on <= $5::date THEN s.score END AS score,
            gp.projected
       FROM player p
       JOIN game g ON (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
                  AND g.played_on BETWEEN $2 AND $3
       LEFT JOIN team opp ON opp.id = CASE WHEN g.home_team_id = p.team_id THEN g.away_team_id ELSE g.home_team_id END
       LEFT JOIN player_game_score s ON s.player_id = p.id AND s.played_on = g.played_on AND s.config_id = $4
       LEFT JOIN player_game_projection gp ON gp.player_id = p.id AND gp.game_id = g.id
      WHERE p.id = ANY($1::bigint[])
      ORDER BY p.id, g.played_on, g.tipoff NULLS LAST`,
    [ids, from, to, configId, today],
  );
  const byPlayer = new Map<number, WeekGame[]>();
  for (const g of games) {
    const list = byPlayer.get(Number(g.player_id)) ?? [];
    list.push({
      playedOn: g.played_on, tipoff: g.tipoff === null ? null : g.tipoff.toISOString(),
      opponent: g.opponent, score: g.score === null ? null : Number(g.score),
      projected: g.projected === null ? null : Number(g.projected),
    });
    byPlayer.set(Number(g.player_id), list);
  }

  return rows.map((r) => {
    const list = byPlayer.get(Number(r.player_id)) ?? [];
    return {
      playerId: Number(r.player_id),
      name: r.name,
      teamName: r.team_name,
      primaryColor: r.primary_color,
      role: r.role,
      projected: r.projected === null ? null : Number(r.projected),
      counting: r.counting,
      held: r.held,
      reserve: r.reserve_now,
      games: list,
      scored: r.counting ? list.reduce((a, g) => a + (g.score ?? 0), 0) : 0,
      // A game before today with no line is a night he did not play: zero, not a projection.
      projectedWeek: r.counting
        ? list.reduce((a, g) => a + (g.score ?? (g.playedOn >= today ? g.projected ?? 0 : 0)), 0) : 0,
    };
  }).sort((a, b) => Number(b.counting) - Number(a.counting)
    || (b.projected ?? -1e9) - (a.projected ?? -1e9) || a.name.localeCompare(b.name));
}
