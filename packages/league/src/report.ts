import type { Db } from "@illini/db";

/**
 * The week in review: what happened in the last settled scoring week, read
 * back from what settlement and scoring already wrote. Nothing is stored —
 * the report is recomputed on every read, so it is ready the moment a week
 * settles and never disagrees with the matchups it describes.
 */

export interface ReportResult {
  matchupId: number;
  home: { fantasyTeamId: number; name: string; points: number };
  away: { fantasyTeamId: number; name: string; points: number };
}

export interface ReportTeamWeek {
  fantasyTeamId: number;
  name: string;
  points: number;
  /** 1 = the week's top score. */
  rank: number;
  won: boolean | null;
}

export interface ReportPerformer {
  playerId: number;
  playerName: string;
  schoolName: string | null;
  games: number;
  points: number;
  /** The fantasy team the points counted for; null on the wire. */
  fantasyTeamId: number | null;
  ownedBy: string | null;
}

/** A waiver or free-agent pickup, judged by what it scored for its team. */
export interface ReportAdd extends ReportPerformer {
  fantasyTeamId: number;
  ownedBy: string;
  addedOn: string;
}

/** A team's week against what the model projected for the same games. */
export interface ReportTeamVsProjection {
  fantasyTeamId: number;
  name: string;
  projected: number;
  actual: number;
  /** actual − projected. */
  diff: number;
}

export interface WeeklyReport {
  week: number;
  startsOn: string;
  endsOn: string;
  results: ReportResult[];
  /** Every team's score for the week, highest first. */
  teams: ReportTeamWeek[];
  /** Points that counted for a fantasy team, one row per player and team. */
  rostered: ReportPerformer[];
  /** Points scored while nobody in the league held the player. */
  unrostered: ReportPerformer[];
  /** The viewer's top scorer this week, when they have a team. */
  mvp: ReportPerformer | null;
  /** The pickup that scored the most for its team this week. */
  bestAdd: ReportAdd | null;
  /** The pickup that scored the least, among those that had a game to play. */
  worstAdd: ReportAdd | null;
  /** The team that beat its projection by the most points. */
  overperformer: ReportTeamVsProjection | null;
  /** The team that fell furthest short of its projection. */
  underperformer: ReportTeamVsProjection | null;
}

/**
 * The report for the most recently settled regular-season week, or a named
 * one. Null when no week has settled yet.
 */
export async function weeklyReport(
  db: Db,
  { leagueId, configId, week, fantasyTeamId = null, limit = 5 }: {
    leagueId: number; configId: number; week?: number;
    fantasyTeamId?: number | null; limit?: number;
  },
): Promise<WeeklyReport | null> {
  const { rows: matchups } = await db.query<{
    id: string; week: number; starts_on: string; ends_on: string;
    home_team_id: string; away_team_id: string; home_name: string; away_name: string;
    home_points: number | null; away_points: number | null;
  }>(
    `WITH target AS (
       SELECT coalesce($2::int, max(week)) AS week FROM matchup
        WHERE league_id = $1 AND round IS NULL AND settled_at IS NOT NULL
     )
     SELECT m.id, m.week, to_char(m.starts_on,'YYYY-MM-DD') AS starts_on,
            to_char(m.ends_on,'YYYY-MM-DD') AS ends_on,
            m.home_team_id, m.away_team_id, h.name AS home_name, a.name AS away_name,
            m.home_points, m.away_points
       FROM matchup m
       JOIN target ON target.week = m.week
       JOIN fantasy_team h ON h.id = m.home_team_id
       JOIN fantasy_team a ON a.id = m.away_team_id
      WHERE m.league_id = $1 AND m.round IS NULL AND m.settled_at IS NOT NULL
      ORDER BY m.id`,
    [leagueId, week ?? null],
  );
  if (matchups.length === 0) return null;

  const first = matchups[0]!;
  const startsOn = matchups.reduce((a, m) => (m.starts_on < a ? m.starts_on : a), first.starts_on);
  const endsOn = matchups.reduce((a, m) => (m.ends_on > a ? m.ends_on : a), first.ends_on);

  const results: ReportResult[] = matchups.map((m) => ({
    matchupId: Number(m.id),
    home: { fantasyTeamId: Number(m.home_team_id), name: m.home_name, points: Number(m.home_points ?? 0) },
    away: { fantasyTeamId: Number(m.away_team_id), name: m.away_name, points: Number(m.away_points ?? 0) },
  }));

  const teams: ReportTeamWeek[] = results
    .flatMap((r) => [
      { ...r.home, won: r.home.points === r.away.points ? null : r.home.points > r.away.points },
      { ...r.away, won: r.home.points === r.away.points ? null : r.away.points > r.home.points },
    ])
    .sort((a, b) => b.points - a.points)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  const performerRow = (r: {
    player_id: string; name: string; school: string | null; games: string; points: string;
    fantasy_team_id: string | null; owned_by: string | null;
  }): ReportPerformer => ({
    playerId: Number(r.player_id),
    playerName: r.name,
    schoolName: r.school,
    games: Number(r.games),
    points: Number(r.points),
    fantasyTeamId: r.fantasy_team_id === null ? null : Number(r.fantasy_team_id),
    ownedBy: r.owned_by,
  });

  // What counted: the same `fielded` rows settlement summed, so a benched or
  // reserved night is not credited, and a player traded mid-week shows once
  // for each team he scored for.
  const fieldedQuery = (onlyTeam: boolean) =>
    `SELECT f.player_id, p.name, t.name AS school, count(*) AS games, sum(s.score) AS points,
            f.fantasy_team_id, ft.name AS owned_by
       FROM fielded f
       JOIN fantasy_team ft ON ft.id = f.fantasy_team_id AND ft.league_id = $1
       JOIN player p ON p.id = f.player_id
       LEFT JOIN team t ON t.id = p.team_id
       JOIN player_game_score s
         ON s.player_id = f.player_id AND s.played_on = f.played_on AND s.config_id = $2
      WHERE f.played_on BETWEEN $3 AND $4
        AND f.slot NOT IN ('BENCH', 'IR')
        ${onlyTeam ? "AND f.fantasy_team_id = $6" : ""}
      GROUP BY f.player_id, p.name, t.name, f.fantasy_team_id, ft.name
      ORDER BY points DESC
      LIMIT $5`;

  // Pickups belong to the week they were made for: dated from the day before
  // it starts (a Saturday grab is for Sunday) through the day before it ends,
  // so no add shows up in two reports. Only adds that had a game while held
  // are judged — a player with nothing scheduled was never a bad pick yet.
  const addsQuery = `
    WITH adds AS (
      SELECT DISTINCT ON (r.fantasy_team_id, r.player_id)
             r.fantasy_team_id, r.player_id, r.acquired_on
        FROM roster_slot r
       WHERE r.league_id = $1 AND r.acquired_via IN ('waiver', 'free_agent')
         AND r.acquired_on BETWEEN $3::date - 1 AND $4::date - 1
       ORDER BY r.fantasy_team_id, r.player_id, r.acquired_on
    )
    SELECT a.player_id, p.name, t.name AS school, to_char(a.acquired_on, 'YYYY-MM-DD') AS added_on,
           count(s.score) FILTER (WHERE f.slot NOT IN ('BENCH', 'IR')) AS games,
           coalesce(sum(s.score) FILTER (WHERE f.slot NOT IN ('BENCH', 'IR')), 0) AS points,
           a.fantasy_team_id, ft.name AS owned_by
      FROM adds a
      JOIN fantasy_team ft ON ft.id = a.fantasy_team_id
      JOIN player p ON p.id = a.player_id
      LEFT JOIN team t ON t.id = p.team_id
      JOIN fielded f
        ON f.fantasy_team_id = a.fantasy_team_id AND f.player_id = a.player_id
       AND f.played_on BETWEEN greatest($3::date, a.acquired_on) AND $4
      LEFT JOIN player_game_score s
        ON s.player_id = f.player_id AND s.played_on = f.played_on AND s.config_id = $2
     GROUP BY a.player_id, p.name, t.name, a.acquired_on, a.fantasy_team_id, ft.name
     ORDER BY points DESC, games ASC`;

  type Row = Parameters<typeof performerRow>[0];
  // Every game that counted for a team, against the projection it carried at
  // tip-off (the feed stops rewriting a game once it is final). Only games
  // with a projection are compared, so a game the model never saw cannot
  // read as a surprise either way; a projected starter who did not play
  // counts as zero, which is exactly the shortfall it was.
  const projectionQuery = `
    SELECT f.fantasy_team_id, ft.name, sum(gp.projected) AS projected,
           sum(coalesce(s.score, 0)) AS actual
      FROM fielded f
      JOIN fantasy_team ft ON ft.id = f.fantasy_team_id AND ft.league_id = $1
      JOIN player_game_projection gp
        ON gp.player_id = f.player_id
       AND (CASE WHEN f.game_id IS NULL THEN gp.played_on = f.played_on ELSE gp.game_id = f.game_id END)
      LEFT JOIN player_game_score s
        ON s.player_id = f.player_id AND s.played_on = f.played_on AND s.config_id = $2
     WHERE f.played_on BETWEEN $3 AND $4
       AND f.slot NOT IN ('BENCH', 'IR')
     GROUP BY f.fantasy_team_id, ft.name`;

  const [rostered, unrostered, mvp, adds, projections] = await Promise.all([
    db.query(fieldedQuery(false), [leagueId, configId, startsOn, endsOn, limit]),
    // The wire: nights the player scored while no team in the league held him.
    db.query(
      `SELECT s.player_id, p.name, t.name AS school, count(*) AS games, sum(s.score) AS points,
              NULL::bigint AS fantasy_team_id, NULL::text AS owned_by
         FROM player_game_score s
         JOIN player p ON p.id = s.player_id
         LEFT JOIN team t ON t.id = p.team_id
        WHERE s.config_id = $2 AND s.played_on BETWEEN $3 AND $4
          AND NOT EXISTS (
            SELECT 1 FROM roster_slot r
             WHERE r.league_id = $1 AND r.player_id = s.player_id
               AND r.acquired_on <= s.played_on
               AND (r.released_on IS NULL OR r.released_on > s.played_on))
        GROUP BY s.player_id, p.name, t.name
        ORDER BY points DESC
        LIMIT $5`,
      [leagueId, configId, startsOn, endsOn, limit],
    ),
    fantasyTeamId === null
      ? Promise.resolve({ rows: [] })
      : db.query(fieldedQuery(true), [leagueId, configId, startsOn, endsOn, 1, fantasyTeamId]),
    db.query(addsQuery, [leagueId, configId, startsOn, endsOn]),
    db.query<{ fantasy_team_id: string; name: string; projected: string; actual: string }>(
      projectionQuery, [leagueId, configId, startsOn, endsOn]),
  ]);

  const versus: ReportTeamVsProjection[] = projections.rows
    .map((r) => ({
      fantasyTeamId: Number(r.fantasy_team_id), name: r.name,
      projected: Number(r.projected), actual: Number(r.actual),
      diff: Number(r.actual) - Number(r.projected),
    }))
    .filter((t) => t.projected > 0)
    .sort((a, b) => b.diff - a.diff);
  // With a single team projected there is no one to compare it against.
  const overperformer = versus.length > 1 ? versus[0]! : null;
  const underperformer = versus.length > 1 ? versus[versus.length - 1]! : null;

  const addRows = (adds.rows as (Row & { added_on: string })[]).map((r) => ({
    ...performerRow(r), addedOn: r.added_on,
  }) as ReportAdd);
  const bestAdd = addRows[0] ?? null;
  // One pickup is the best and the worst at once; call it only the best.
  const worstAdd = addRows.length > 1 ? addRows[addRows.length - 1]! : null;

  return {
    week: first.week,
    startsOn,
    endsOn,
    results,
    teams,
    rostered: (rostered.rows as Row[]).map(performerRow),
    unrostered: (unrostered.rows as Row[]).map(performerRow),
    mvp: mvp.rows[0] ? performerRow(mvp.rows[0] as Row) : null,
    bestAdd,
    worstAdd,
    overperformer,
    underperformer,
  };
}
