import type { Db } from "@illini/db";
import { KNOWN_ROLES, rolesFor, type PositionRole } from "./slots.ts";

/**
 * The stat surface.
 *
 * Everything here is a read against data other modules already write:
 * `player_game_score` (scored nights), `player_rank` (the rollup `npm run
 * ingest -- ranks` rebuilds), the `transaction` log, and the `box` sub-object
 * `ingestNight` now stores beside every game's stat line. Nothing here scores
 * anything or invents a number that is not already one of those.
 */

export interface TopPerformance {
  playerId: number;
  playerName: string;
  teamName: string | null;
  playedOn: string;
  role: string | null;
  archetype: string;
  score: number;
  ownedBy: string | null;
}

/**
 * The best single-game scores in a window, with owner attribution.
 *
 * Reads off `pgsc_score_idx (config_id, score DESC)` — exactly the shape a
 * top-N-by-score query wants. The role filter is expanded to Torvik's own
 * role strings the same way `playerPool`'s does, since that is what
 * `player_game_stat.role` actually stores.
 */
export async function topPerformances(
  db: Db,
  { leagueId, configId, from, to, roles, limit = 25 }: {
    leagueId: number; configId: number; from: string; to: string;
    roles?: PositionRole[]; limit?: number;
  },
): Promise<TopPerformance[]> {
  const rawRoles = roles && roles.length > 0
    ? KNOWN_ROLES.filter((raw) => rolesFor(raw).some((r) => roles.includes(r)))
    : null;

  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null;
    played_on: string; role: string | null; archetype: string; score: number;
    owned_by: string | null;
  }>(
    `SELECT s.player_id, p.name, t.name AS team_name,
            to_char(s.played_on, 'YYYY-MM-DD') AS played_on,
            st.role, s.archetype, s.score,
            (SELECT ft.name FROM roster_slot r JOIN fantasy_team ft ON ft.id = r.fantasy_team_id
              WHERE r.league_id = $6 AND r.player_id = p.id
                AND r.acquired_on <= s.played_on
                AND (r.released_on IS NULL OR r.released_on > s.played_on)
              LIMIT 1) AS owned_by
       FROM player_game_score s
       JOIN player p ON p.id = s.player_id
       JOIN player_game_stat st ON st.player_id = s.player_id AND st.played_on = s.played_on
       LEFT JOIN team t ON t.id = p.team_id
      WHERE s.config_id = $1 AND s.played_on BETWEEN $2 AND $3
        AND ($5::text[] IS NULL OR st.role = ANY($5))
      ORDER BY s.score DESC
      LIMIT $4`,
    [configId, from, to, limit, rawRoles, leagueId],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    playerName: r.name,
    teamName: r.team_name,
    playedOn: r.played_on,
    role: r.role,
    archetype: r.archetype,
    score: Number(r.score),
    ownedBy: r.owned_by,
  }));
}

export interface LeagueWeek {
  week: number;
  startsOn: string;
  endsOn: string;
}

/**
 * The scoring weeks this league has actually settled, oldest first — what a
 * week picker pages through. `round IS NULL` excludes the playoff bracket,
 * which numbers its own rounds starting back at 1 and would otherwise collide
 * with the regular season's week numbers.
 */
export async function playedWeeks(db: Db, { leagueId }: { leagueId: number }): Promise<LeagueWeek[]> {
  const { rows } = await db.query<{ week: number; starts_on: string; ends_on: string }>(
    `SELECT week, to_char(min(starts_on), 'YYYY-MM-DD') AS starts_on,
            to_char(max(ends_on), 'YYYY-MM-DD') AS ends_on
       FROM matchup
      WHERE league_id = $1 AND round IS NULL AND settled_at IS NOT NULL
      GROUP BY week
      ORDER BY week`,
    [leagueId],
  );
  return rows.map((r) => ({ week: Number(r.week), startsOn: r.starts_on, endsOn: r.ends_on }));
}

export interface WeeklyLeader {
  playerId: number;
  playerName: string;
  teamName: string | null;
  role: string | null;
  games: number;
  totalScore: number;
  ownedBy: string | null;
}

/**
 * Cumulative score over one scoring week, not a single night's best — the
 * other half of `topPerformances`. `ownedBy` is evaluated as of the week's
 * last day, same reasoning `topPerformances` uses per night.
 */
export async function weeklyLeaders(
  db: Db,
  { leagueId, configId, from, to, roles, limit = 25 }: {
    leagueId: number; configId: number; from: string; to: string;
    roles?: PositionRole[]; limit?: number;
  },
): Promise<WeeklyLeader[]> {
  const rawRoles = roles && roles.length > 0
    ? KNOWN_ROLES.filter((raw) => rolesFor(raw).some((r) => roles.includes(r)))
    : null;

  const { rows } = await db.query<{
    player_id: string; name: string; team_name: string | null; role: string | null;
    games: string; total_score: string; owned_by: string | null;
  }>(
    `SELECT s.player_id, p.name, t.name AS team_name, max(st.role) AS role,
            count(*) AS games, sum(s.score) AS total_score,
            (SELECT ft.name FROM roster_slot r JOIN fantasy_team ft ON ft.id = r.fantasy_team_id
              WHERE r.league_id = $6 AND r.player_id = s.player_id
                AND r.acquired_on <= $3
                AND (r.released_on IS NULL OR r.released_on > $3)
              LIMIT 1) AS owned_by
       FROM player_game_score s
       JOIN player p ON p.id = s.player_id
       JOIN player_game_stat st ON st.player_id = s.player_id AND st.played_on = s.played_on
       LEFT JOIN team t ON t.id = p.team_id
      WHERE s.config_id = $1 AND s.played_on BETWEEN $2 AND $3
        AND ($5::text[] IS NULL OR st.role = ANY($5))
      GROUP BY s.player_id, p.name, t.name
      ORDER BY total_score DESC
      LIMIT $4`,
    [configId, from, to, limit, rawRoles, leagueId],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    playerName: r.name,
    teamName: r.team_name,
    role: r.role,
    games: Number(r.games),
    totalScore: Number(r.total_score),
    ownedBy: r.owned_by,
  }));
}

export interface TrendingPlayer {
  playerId: number;
  playerName: string;
  moves: number;
  lastKind: string;
  lastAt: string;
}

/**
 * Who the league has been moving lately.
 *
 * Counts roster moves per player off the transaction log over a window — a
 * claim, a drop, a trade, a draft pick. `kind` alone cannot always say which
 * direction a move went (a traded player's row is written by both
 * `claimPlayer` and `releasePlayer`, both under kind `trade`), so this counts
 * activity rather than invent an add/drop split the log does not reliably
 * support.
 */
export async function trendingPlayers(
  db: Db, { leagueId, since, limit = 10 }: { leagueId: number; since: string; limit?: number },
): Promise<TrendingPlayer[]> {
  const { rows } = await db.query<{
    player_id: string; name: string; moves: string; last_kind: string; last_at: Date;
  }>(
    `SELECT (t.payload->>'playerId')::bigint AS player_id, p.name, count(*) AS moves,
            (array_agg(t.kind ORDER BY t.created_at DESC))[1] AS last_kind,
            max(t.created_at) AS last_at
       FROM transaction t
       JOIN player p ON p.id = (t.payload->>'playerId')::bigint
      WHERE t.league_id = $1
        AND t.kind IN ('draft', 'waiver', 'free_agent', 'trade', 'release')
        AND t.created_at >= $2
      GROUP BY (t.payload->>'playerId')::bigint, p.name
      ORDER BY moves DESC, last_at DESC
      LIMIT $3`,
    [leagueId, since, limit],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    playerName: r.name,
    moves: Number(r.moves),
    lastKind: r.last_kind,
    lastAt: r.last_at.toISOString(),
  }));
}

export interface RankPoint {
  playedOn: string;
  seasonTotal: number;
  games: number;
  rankOverall: number;
  rankRole: number;
}

/** A player's rank rollup over a date range, oldest first. */
export async function playerRankTrend(
  db: Db, { playerId, configId, from, to }: {
    playerId: number; configId: number; from: string; to: string;
  },
): Promise<RankPoint[]> {
  const { rows } = await db.query<{
    played_on: string; season_total: number; games: number;
    rank_overall: number; rank_role: number;
  }>(
    `SELECT to_char(played_on, 'YYYY-MM-DD') AS played_on, season_total, games,
            rank_overall, rank_role
       FROM player_rank
      WHERE player_id = $1 AND config_id = $2 AND played_on BETWEEN $3 AND $4
      ORDER BY played_on`,
    [playerId, configId, from, to],
  );
  return rows.map((r) => ({
    playedOn: r.played_on,
    seasonTotal: Number(r.season_total),
    games: Number(r.games),
    rankOverall: Number(r.rank_overall),
    rankRole: Number(r.rank_role),
  }));
}

export interface WeekProjection {
  gamesScheduled: number;
  /** Average under this config before `from`. Zero for a player with none. */
  average: number;
  projectedTotal: number;
}

/**
 * A player's projected total over a date range — the scheduled game count
 * times their own average under this config before the range starts. The
 * same average `startableOn`'s `form` CTE and `periodOutlook`'s `form`
 * LATERAL already rank auto-fill and outlook by; nothing new invented.
 */
export async function playerWeekProjection(
  db: Db, { playerId, configId, from, to }: {
    playerId: number; configId: number; from: string; to: string;
  },
): Promise<WeekProjection> {
  const { rows } = await db.query<{ average: string | null; games_scheduled: string }>(
    `WITH form AS (
       SELECT avg(score) AS average FROM player_game_score
        WHERE player_id = $1 AND config_id = $2 AND played_on < $3
     ),
     sched AS (
       SELECT count(*) AS games_scheduled
         FROM game g JOIN player p ON p.id = $1
        WHERE g.played_on BETWEEN $3 AND $4
          AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
     )
     SELECT form.average, sched.games_scheduled FROM form, sched`,
    [playerId, configId, from, to],
  );
  const row = rows[0];
  const average = row?.average == null ? 0 : Number(row.average);
  const gamesScheduled = row ? Number(row.games_scheduled) : 0;
  return { gamesScheduled, average, projectedTotal: average * gamesScheduled };
}

/**
 * Season per-game averages, in three groups.
 *
 * BOX and the shooting/advanced rate stats all come from one place: the whole
 * `PlayerLine` the scorer read has been stored in `player_game_stat.stats`
 * since Phase 2 — only the counting stats under `box` are new. Nothing here
 * needed a second ingest widening; it needed someone to read the column.
 */
export interface StatAverages {
  games: number;
  // box
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  // shooting
  fieldGoalsMade: number;
  threesMade: number;
  freeThrowsMade: number;
  effectiveFieldGoalPct: number;
  trueShootingPct: number;
  threePointPct: number;
  freeThrowPct: number;
  // advanced
  usage: number;
  bpm: number;
  obpm: number;
  dbpm: number;
  porpag: number;
}

export const STAT_GROUPS: { label: string; stats: (keyof Omit<StatAverages, "games">)[] }[] = [
  { label: "Box", stats: ["points", "rebounds", "assists", "steals", "blocks", "offensiveRebounds", "defensiveRebounds"] },
  { label: "Shooting", stats: ["fieldGoalsMade", "threesMade", "freeThrowsMade", "effectiveFieldGoalPct", "trueShootingPct", "threePointPct", "freeThrowPct"] },
  { label: "Advanced", stats: ["usage", "bpm", "obpm", "dbpm", "porpag"] },
];

const AVERAGE_SELECT = `
  count(*) AS games,
  avg((stats->>'points')::numeric) AS points,
  avg((stats->>'rebounds')::numeric) AS rebounds,
  avg((stats->>'assists')::numeric) AS assists,
  avg((stats->'box'->>'steals')::numeric) AS steals,
  avg((stats->'box'->>'blocks')::numeric) AS blocks,
  avg((stats->'box'->>'offensiveRebounds')::numeric) AS oreb,
  avg((stats->'box'->>'defensiveRebounds')::numeric) AS dreb,
  avg((stats->'box'->>'fieldGoalsMade')::numeric) AS fg_made,
  avg((stats->'box'->>'threesMade')::numeric) AS threes,
  avg((stats->'box'->>'freeThrowsMade')::numeric) AS ft_made,
  avg((stats->>'effectiveFieldGoalPct')::numeric) AS efg_pct,
  avg((stats->>'trueShootingPct')::numeric) AS ts_pct,
  avg((stats->>'threePointPct')::numeric) AS three_pct,
  avg((stats->>'freeThrowPct')::numeric) AS ft_pct,
  avg((stats->>'usage')::numeric) AS usage,
  avg((stats->>'bpm')::numeric) AS bpm,
  avg((stats->>'obpm')::numeric) AS obpm,
  avg((stats->>'dbpm')::numeric) AS dbpm,
  avg((stats->>'porpag')::numeric) AS porpag
`;

type AverageRow = {
  games: string;
  points: string | null; rebounds: string | null; assists: string | null;
  steals: string | null; blocks: string | null; oreb: string | null; dreb: string | null;
  fg_made: string | null; threes: string | null; ft_made: string | null;
  efg_pct: string | null; ts_pct: string | null; three_pct: string | null; ft_pct: string | null;
  usage: string | null; bpm: string | null; obpm: string | null; dbpm: string | null; porpag: string | null;
};

function toAverages(r: AverageRow): StatAverages {
  const n = (v: string | null): number => Number(v ?? 0);
  return {
    games: Number(r.games),
    points: n(r.points), rebounds: n(r.rebounds), assists: n(r.assists),
    steals: n(r.steals), blocks: n(r.blocks),
    offensiveRebounds: n(r.oreb), defensiveRebounds: n(r.dreb),
    fieldGoalsMade: n(r.fg_made), threesMade: n(r.threes), freeThrowsMade: n(r.ft_made),
    effectiveFieldGoalPct: n(r.efg_pct), trueShootingPct: n(r.ts_pct),
    threePointPct: n(r.three_pct), freeThrowPct: n(r.ft_pct),
    usage: n(r.usage), bpm: n(r.bpm), obpm: n(r.obpm), dbpm: n(r.dbpm), porpag: n(r.porpag),
  };
}

/** A player's season averages, box/shooting/advanced together. */
export async function seasonAverages(
  db: Db, { playerId, season }: { playerId: number; season: number },
): Promise<StatAverages | null> {
  const { rows } = await db.query<AverageRow>(
    `SELECT ${AVERAGE_SELECT} FROM player_game_stat WHERE player_id = $1 AND season = $2`,
    [playerId, season],
  );
  const r = rows[0];
  if (!r || Number(r.games) === 0) return null;
  return toAverages(r);
}

const STAT_KEYS = STAT_GROUPS.flatMap((g) => g.stats);
export type StatKey = typeof STAT_KEYS[number];

export interface StatPercentile {
  stat: StatKey;
  value: number;
  /** Share of role peers this player's average is at or above, 0..1. */
  percentile: number;
}

/**
 * Where a player's season averages sit against everyone who played the same
 * role that season. Computed in JS over one query's worth of peer averages
 * rather than a percentile-per-stat SQL query, since a role's pool is at most
 * a few hundred players.
 */
export async function statPercentiles(
  db: Db, { playerId, season, role }: { playerId: number; season: number; role: string },
): Promise<StatPercentile[]> {
  const { rows } = await db.query<{ player_id: string } & AverageRow>(
    `SELECT player_id, ${AVERAGE_SELECT}
       FROM player_game_stat
      WHERE season = $1 AND role = $2
      GROUP BY player_id`,
    [season, role],
  );
  const mine = rows.find((r) => Number(r.player_id) === playerId);
  if (!mine) return [];

  const averages = rows.map(toAverages);
  const mineAvg = toAverages(mine);

  return STAT_KEYS.map((stat) => {
    const values = averages.map((a) => a[stat]);
    const value = mineAvg[stat];
    const below = values.filter((v) => v <= value).length;
    return { stat, value, percentile: values.length <= 1 ? 1 : below / values.length };
  });
}
