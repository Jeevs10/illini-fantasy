import type { Db } from "@illini/db";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";

/**
 * One team's week in an `everyone` league, as its manager needs to read it.
 *
 * There is no lineup: a game counts for the team that held the player at its
 * tip-off. So the page is "who is on the roster now, and who scored for me
 * this week", in three groups, all from tenures:
 *
 *   - **held**: on the roster now, off IR. Every game still to come counts.
 *   - **gone**: let go this week after scoring for the team. The games he
 *     played while held stay counted; nothing after the drop does.
 *   - **IR**: on injured reserve now; nothing played there scores.
 *
 * Each game's `counted` comes straight from the `fielded` view, so this page
 * and the matchup cannot disagree about the week.
 */

export interface WeekGame {
  playedOn: string;
  tipoff: string | null;
  opponent: string | null;
  /** The game's valAdj once its line is in, else null. */
  score: number | null;
  /** The model's projection for the game, when the feed has one. */
  projected: number | null;
  /**
   * Whether the game counts for this team: held off IR at its tip-off. For a
   * game still to come, whether it will if nothing changes.
   */
  counted: boolean;
}

export interface WeekPlayer {
  playerId: number;
  name: string;
  teamName: string | null;
  primaryColor: string | null;
  role: string | null;
  projected: number | null;
  /** On the roster and off IR now: his games still to come will count. */
  counting: boolean;
  /** Still held now. False for a player let go this week, whose games before the drop still count. */
  held: boolean;
  /** On IR now. */
  reserve: boolean;
  games: WeekGame[];
  /** What his counted games have banked for this team. */
  scored: number;
  /** Where his week lands: what he has banked, plus the projection for every counted game not yet in. */
  projectedWeek: number;
}

/** The instant a period starts: its first day at the waiver hour, UTC. */
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
  // Anyone held at some point in the week, as of now. A tenure opened after
  // the week, or closed before it, is somebody else's week.
  const weekStart = lockOf(from, settings);
  const nextStart = new Date(lockOf(to, settings).getTime() + 86_400_000);
  const asOf = now < nextStart ? now : nextStart;
  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null; primary_color: string | null;
    role: string | null; projected: number | null; held: boolean; reserve_now: boolean;
  }>(
    `WITH tenure AS (
       SELECT r.player_id, r.reserve,
              coalesce(r.acquired_at, r.acquired_on::timestamp AT TIME ZONE 'UTC') AS opened,
              r.released_at AS closed, r.released_on
         FROM roster_slot r WHERE r.fantasy_team_id = $1
     ),
     during AS (
       SELECT DISTINCT player_id FROM tenure
        WHERE opened < $3 AND (closed IS NULL OR closed > $2)
          AND (released_on IS NULL OR closed IS NOT NULL OR released_on >= $4::date)
     ),
     held AS (
       SELECT player_id, bool_or(reserve) AS reserve FROM tenure
        WHERE opened <= $3 AND (closed IS NULL OR closed > $3)
          AND (released_on IS NULL OR closed IS NOT NULL)
        GROUP BY player_id
     )
     SELECT p.id AS player_id, p.name, t.name AS team_name, t.primary_color,
            coalesce((SELECT st.role FROM player_game_stat st
                       WHERE st.player_id = p.id AND st.role IS NOT NULL
                       ORDER BY st.played_on DESC LIMIT 1), p.position) AS role,
            (SELECT pp.score FROM player_projection pp
              WHERE pp.player_id = p.id AND pp.season = $5 ORDER BY pp.as_of DESC LIMIT 1) AS projected,
            held.player_id IS NOT NULL AS held,
            coalesce(held.reserve, false) AS reserve_now
       FROM during
       JOIN player p ON p.id = during.player_id
       LEFT JOIN team t ON t.id = p.team_id
       LEFT JOIN held ON held.player_id = during.player_id`,
    [fantasyTeamId, weekStart, asOf, from, season],
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => Number(r.player_id));
  const { rows: games } = await db.query<{
    player_id: string; played_on: string; tipoff: Date | null; opponent: string | null; score: number | null;
    projected: number | null; counted: boolean;
  }>(
    `SELECT DISTINCT ON (p.id, g.played_on) p.id AS player_id,
            to_char(g.played_on, 'YYYY-MM-DD') AS played_on, g.tipoff,
            opp.name AS opponent,
            CASE WHEN g.played_on <= $5::date THEN s.score END AS score,
            gp.projected,
            EXISTS (SELECT 1 FROM fielded f
                     WHERE f.fantasy_team_id = $6 AND f.player_id = p.id
                       AND f.played_on = g.played_on AND f.slot <> 'IR') AS counted
       FROM player p
       JOIN game g ON (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
                  AND g.played_on BETWEEN $2 AND $3
       LEFT JOIN team opp ON opp.id = CASE WHEN g.home_team_id = p.team_id THEN g.away_team_id ELSE g.home_team_id END
       LEFT JOIN player_game_score s ON s.player_id = p.id AND s.played_on = g.played_on AND s.config_id = $4
       LEFT JOIN player_game_projection gp ON gp.player_id = p.id AND gp.game_id = g.id
      WHERE p.id = ANY($1::bigint[])
      ORDER BY p.id, g.played_on, g.tipoff NULLS LAST`,
    [ids, from, to, configId, today, fantasyTeamId],
  );
  const byPlayer = new Map<number, WeekGame[]>();
  for (const g of games) {
    const list = byPlayer.get(Number(g.player_id)) ?? [];
    list.push({
      playedOn: g.played_on, tipoff: g.tipoff === null ? null : g.tipoff.toISOString(),
      opponent: g.opponent, score: g.score === null ? null : Number(g.score),
      projected: g.projected === null ? null : Number(g.projected),
      counted: g.counted,
    });
    byPlayer.set(Number(g.player_id), list);
  }

  return rows.map((r) => {
    const list = byPlayer.get(Number(r.player_id)) ?? [];
    const counted = list.filter((g) => g.counted);
    return {
      playerId: Number(r.player_id),
      name: r.name,
      teamName: r.team_name,
      primaryColor: r.primary_color,
      role: r.role,
      projected: r.projected === null ? null : Number(r.projected),
      counting: r.held && !r.reserve_now,
      held: r.held,
      reserve: r.reserve_now,
      games: list,
      scored: counted.reduce((a, g) => a + (g.score ?? 0), 0),
      // A game before today with no line is a night he did not play: zero, not a projection.
      projectedWeek: counted.reduce((a, g) => a + (g.score ?? (g.playedOn >= today ? g.projected ?? 0 : 0)), 0),
    };
  })
    // Somebody held for part of the week who never scored for it is noise.
    .filter((p) => p.held || p.games.some((g) => g.counted))
    .sort((a, b) => Number(b.counting) - Number(a.counting)
      || (b.projected ?? -1e9) - (a.projected ?? -1e9) || a.name.localeCompare(b.name));
}
