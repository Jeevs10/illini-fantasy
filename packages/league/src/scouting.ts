import type { Queryable } from "./membership.ts";

/**
 * The forward model's view of a player and of a school, for the screens that
 * show the projection itself rather than a ranking built on it.
 *
 * Everything here is read from what the morning feed stored
 * (player_projection, player_game_projection, team.forward_slug) — nothing is
 * recomputed, so the player page and the school page cannot disagree with the
 * pool or the draft board about what a player is projected for.
 */

export interface ProjectionDay {
  asOf: string;
  score: number;
  lo: number | null;
  hi: number | null;
}

export interface ProjectedGame {
  playedOn: string;
  tipoff: string | null;
  opponent: string | null;
  /** The opponent's school slug here, for a link to its page. */
  opponentSlug: string | null;
  site: "home" | "away" | "neutral";
  projected: number;
  listedOut: boolean;
}

export interface School {
  teamId: number;
  name: string;
  /** Our slug: the crosswalk key with hyphens. */
  slug: string;
  conference: string | null;
  primaryColor: string | null;
  /** The Data repo site's slug, when the feed has named it. */
  forwardSlug: string | null;
}

export interface PlayerOutlook {
  /** The Data repo's player id, the key of his page on its site. */
  forwardKey: string | null;
  school: School | null;
  latest: (ProjectionDay & {
    mpg: number | null;
    valueRank: number | null;
    status: string | null;
    restPoints: number | null;
    restGames: number | null;
    /** Where his Player Score sits among everyone projected that morning. */
    rank: number;
    of: number;
    /** The best projected score that morning, the top of any scale drawn. */
    top: number;
  }) | null;
  /** One point per feed morning, oldest first. */
  history: ProjectionDay[];
  upcoming: ProjectedGame[];
}

/** "st johns" → "st-johns". The crosswalk key is unique and has no hyphens of its own. */
export const schoolSlug = (normalised: string) => normalised.replace(/ /g, "-");

const SCHOOL_COLUMNS = `t.id AS team_id, t.name AS team_name, t.normalised, t.conference,
  t.primary_color, t.forward_slug`;

interface SchoolRow {
  team_id: string; team_name: string; normalised: string; conference: string | null;
  primary_color: string | null; forward_slug: string | null;
}

const school = (r: SchoolRow): School => ({
  teamId: Number(r.team_id), name: r.team_name, slug: schoolSlug(r.normalised),
  conference: r.conference, primaryColor: r.primary_color, forwardSlug: r.forward_slug,
});

/** A tip time CBBD has not set yet is stored as midnight Eastern; it is no time at all. */
const TIPOFF = `CASE WHEN (g.tipoff AT TIME ZONE 'America/New_York')::time = '00:00' THEN NULL ELSE g.tipoff END`;

/** A school's games from `from`, as a list of nights — the player page and the school page read the same rows. */
const GAMES_SQL = `
  SELECT to_char(g.played_on, 'YYYY-MM-DD') AS played_on, ${TIPOFF} AS tipoff,
         o.name AS opponent, o.normalised AS opponent_normalised,
         CASE WHEN g.neutral_site THEN 'neutral' WHEN g.home_team_id = $1 THEN 'home' ELSE 'away' END AS site,
         g.id AS game_id
    FROM game g
    LEFT JOIN team o ON o.id = CASE WHEN g.home_team_id = $1 THEN g.away_team_id ELSE g.home_team_id END
   WHERE (g.home_team_id = $1 OR g.away_team_id = $1) AND g.season = $2 AND g.played_on >= $3::date`;

export async function playerOutlook(
  db: Queryable,
  { playerId, season, from, games = 10 }: { playerId: number; season: number; from: string; games?: number },
): Promise<PlayerOutlook> {
  const [key, home, days, upcoming] = await Promise.all([
    db.query<{ source_id: string }>(
      "SELECT source_id FROM player_source_id WHERE player_id = $1 AND source = 'forward' LIMIT 1", [playerId]),
    db.query<SchoolRow>(
      `SELECT ${SCHOOL_COLUMNS} FROM player p JOIN team t ON t.id = p.team_id WHERE p.id = $1`, [playerId]),
    db.query<{
      as_of: string; score: number; score_lo: number | null; score_hi: number | null; mpg: number | null;
      value_rank: number | null; status: string | null; rest_points: number | null; rest_games: number | null;
    }>(
      `SELECT to_char(as_of, 'YYYY-MM-DD') AS as_of, score, score_lo, score_hi, mpg, value_rank, status,
              rest_points, rest_games
         FROM player_projection WHERE player_id = $1 AND season = $2 ORDER BY as_of`,
      [playerId, season]),
    db.query<{
      played_on: string; tipoff: Date | null; opponent: string | null; opponent_normalised: string | null;
      site: ProjectedGame["site"]; projected: number; listed_out: boolean;
    }>(
      `SELECT to_char(gp.played_on, 'YYYY-MM-DD') AS played_on, ${TIPOFF} AS tipoff,
              o.name AS opponent, o.normalised AS opponent_normalised,
              CASE WHEN g.neutral_site THEN 'neutral' WHEN g.home_team_id = p.team_id THEN 'home' ELSE 'away' END AS site,
              gp.projected, gp.listed_out
         FROM player_game_projection gp
         JOIN game g ON g.id = gp.game_id
         JOIN player p ON p.id = gp.player_id
         LEFT JOIN team o ON o.id = CASE WHEN g.home_team_id = p.team_id THEN g.away_team_id ELSE g.home_team_id END
        WHERE gp.player_id = $1 AND gp.played_on >= $2::date
        ORDER BY gp.played_on, g.tipoff NULLS LAST
        LIMIT $3`,
      [playerId, from, games]),
  ]);

  const history = days.rows.map((r) => ({ asOf: r.as_of, score: r.score, lo: r.score_lo, hi: r.score_hi }));
  const last = days.rows[days.rows.length - 1];
  let latest: PlayerOutlook["latest"] = null;
  if (last) {
    const { rows: [standing] } = await db.query<{ rank: string; of: string; top: number }>(
      `SELECT count(*) FILTER (WHERE score > $3) + 1 AS rank, count(*) AS of, max(score) AS top
         FROM player_projection WHERE season = $1 AND as_of = $2::date`,
      [season, last.as_of, last.score]);
    latest = {
      asOf: last.as_of, score: last.score, lo: last.score_lo, hi: last.score_hi, mpg: last.mpg,
      valueRank: last.value_rank, status: last.status, restPoints: last.rest_points, restGames: last.rest_games,
      rank: Number(standing!.rank), of: Number(standing!.of), top: standing!.top,
    };
  }

  return {
    forwardKey: key.rows[0]?.source_id ?? null,
    school: home.rows[0] ? school(home.rows[0]) : null,
    latest,
    history,
    upcoming: upcoming.rows.map((r) => ({
      playedOn: r.played_on, tipoff: r.tipoff ? new Date(r.tipoff).toISOString() : null,
      opponent: r.opponent, opponentSlug: r.opponent_normalised ? schoolSlug(r.opponent_normalised) : null,
      site: r.site, projected: r.projected, listedOut: r.listed_out,
    })),
  };
}

export interface SchoolPlayer {
  playerId: number;
  name: string;
  position: string | null;
  classYear: string | null;
  height: string | null;
  score: number | null;
  lo: number | null;
  hi: number | null;
  mpg: number | null;
  /** Fantasy points banked so far this season, and in how many games. */
  scored: number;
  games: number;
  /** Banked plus the projection for every game he has left. */
  seasonPoints: number | null;
  ownedBy: { fantasyTeamId: number; name: string } | null;
}

export interface SchoolGame {
  playedOn: string;
  tipoff: string | null;
  opponent: string | null;
  opponentSlug: string | null;
  site: ProjectedGame["site"];
  /** What the school's projected players add up to in it. */
  projected: number;
  /** Rostered in this league, playing in it. */
  owned: number;
}

export interface SchoolView {
  school: School;
  players: SchoolPlayer[];
  upcoming: SchoolGame[];
  /** The best projection in the pool, so a school's strips share one scale with the player card's. */
  top: number;
}

/** The roster of one school as this league sees it, and the games it has coming. */
export async function schoolView(
  db: Queryable,
  { slug, leagueId, season, configId, from, games = 8 }: {
    slug: string; leagueId: number; season: number; configId: number; from: string; games?: number;
  },
): Promise<SchoolView | null> {
  const { rows: [found] } = await db.query<SchoolRow>(
    `SELECT ${SCHOOL_COLUMNS} FROM team t WHERE t.normalised = $1`, [slug.replace(/-/g, " ")]);
  if (!found) return null;
  const teamId = Number(found.team_id);

  const [players, nights, best] = await Promise.all([
    db.query<{
      player_id: string; name: string; position: string | null; class_year: string | null; height: string | null;
      score: number | null; score_lo: number | null; score_hi: number | null; mpg: number | null;
      rest_points: number | null; scored: number; games: string; owner_id: string | null; owner: string | null;
    }>(
      `WITH proj AS (
         SELECT DISTINCT ON (player_id) player_id, score, score_lo, score_hi, mpg, rest_points
           FROM player_projection WHERE season = $2
          ORDER BY player_id, as_of DESC
       ),
       banked AS (
         SELECT s.player_id, sum(s.score) AS scored, count(*) AS games
           FROM player_game_score s
           JOIN player_game_stat st ON st.player_id = s.player_id AND st.played_on = s.played_on
          WHERE s.config_id = $3 AND st.season = $2
          GROUP BY s.player_id
       )
       SELECT p.id AS player_id, p.name, p.position, p.class_year, p.height,
              proj.score, proj.score_lo, proj.score_hi, proj.mpg, proj.rest_points,
              coalesce(banked.scored, 0) AS scored, coalesce(banked.games, 0) AS games,
              ft.id AS owner_id, ft.name AS owner
         FROM player p
         LEFT JOIN proj ON proj.player_id = p.id
         LEFT JOIN banked ON banked.player_id = p.id
         LEFT JOIN roster_slot r ON r.player_id = p.id AND r.league_id = $4 AND r.released_on IS NULL
         LEFT JOIN fantasy_team ft ON ft.id = r.fantasy_team_id
        WHERE p.team_id = $1 AND (proj.player_id IS NOT NULL OR banked.player_id IS NOT NULL)
        ORDER BY proj.score DESC NULLS LAST, banked.scored DESC NULLS LAST, p.name`,
      [teamId, season, configId, leagueId]),
    db.query<{
      played_on: string; tipoff: Date | null; opponent: string | null; opponent_normalised: string | null;
      site: SchoolGame["site"]; game_id: string; projected: number | null; owned: string;
    }>(
      `WITH nights AS (${GAMES_SQL} ORDER BY g.played_on, g.tipoff NULLS LAST LIMIT $4)
       SELECT n.*, sum(gp.projected) AS projected,
              count(r.player_id) AS owned
         FROM nights n
         LEFT JOIN player_game_projection gp ON gp.game_id = n.game_id
           AND gp.player_id IN (SELECT id FROM player WHERE team_id = $1)
         LEFT JOIN roster_slot r ON r.player_id = gp.player_id AND r.league_id = $5 AND r.released_on IS NULL
        GROUP BY n.played_on, n.tipoff, n.opponent, n.opponent_normalised, n.site, n.game_id
        ORDER BY n.played_on, n.tipoff NULLS LAST`,
      [teamId, season, from, games, leagueId]),
    db.query<{ top: number | null }>(
      `SELECT max(score) AS top FROM player_projection
        WHERE season = $1 AND as_of = (SELECT max(as_of) FROM player_projection WHERE season = $1)`, [season]),
  ]);

  return {
    school: school(found),
    players: players.rows.map((r) => ({
      playerId: Number(r.player_id), name: r.name, position: r.position, classYear: r.class_year,
      height: r.height, score: r.score, lo: r.score_lo, hi: r.score_hi, mpg: r.mpg,
      scored: Number(r.scored), games: Number(r.games),
      seasonPoints: r.rest_points === null ? null : Number(r.scored) + r.rest_points,
      ownedBy: r.owner_id === null ? null : { fantasyTeamId: Number(r.owner_id), name: r.owner! },
    })),
    upcoming: nights.rows.map((r) => ({
      playedOn: r.played_on, tipoff: r.tipoff ? new Date(r.tipoff).toISOString() : null,
      opponent: r.opponent, opponentSlug: r.opponent_normalised ? schoolSlug(r.opponent_normalised) : null,
      site: r.site, projected: r.projected ?? 0, owned: Number(r.owned),
    })),
    top: best.rows[0]?.top ?? 100,
  };
}
