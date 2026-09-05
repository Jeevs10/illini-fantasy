import type { Db } from "@illini/db";
import { autoFill, DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";
import { scorePeriod, standings, type StandingsRow, type TeamPeriod } from "./settle.ts";

/**
 * What a scoring period looks like while it is still running.
 *
 * `scorePeriod` answers the settled question — what has been scored, and what
 * counts under the cap. It is deliberately blind to everything that has not
 * happened yet, because settlement must be. A screen is not: a manager on a
 * Wednesday night needs to know how many of their starters have not tipped
 * off, which of them are on the floor right now, and roughly where the week
 * lands if form holds.
 *
 * Nothing here invents a number. A pending game's projection is the player's
 * own average under this league's config before that night — the same figure
 * the auto-fill already ranks by — and the projected total applies the same
 * games cap to the same pool. If the model is wrong about a player, this is
 * wrong in exactly the way the rest of the app already is, which is the only
 * honest kind of projection to show.
 *
 * Everything here is answered as of a single night — `now`'s date. Two
 * questions that look the same are not: "has a box score been filed?" and "has
 * this game happened?" A database can hold the whole season at once, so a game
 * three weeks out can have a filed score sitting in it. Reading that score
 * would show a manager next month's result; refusing to project *because* the
 * score exists leaves the same matchup reading 0.0. So a night after `now` is
 * projected from form and its score is never read, and a night before `now` is
 * over — a starter with no box score that night did not play, which is zero
 * points, not a game still to come. Only tonight is genuinely in between, and
 * only tonight is decided by comparing tip-off to the clock.
 *
 * A night nobody has set a lineup for yet — most of a week still to come —
 * has no `lineup_entry` row to read a slot from. Rather than call that "no
 * game" and let the projection go quiet exactly where it matters most, such a
 * night is filled in from the roster's *current* starters — today's actual
 * slots, or the same `autoFill` a manager would run right now if today is
 * also undecided — and only those specific players are projected forward.
 * A different, currently-benched player having a great matchup on some later
 * night is not substituted in: the projection follows the team a manager has
 * actually assembled, not a fresh optimal lineup re-guessed one night at a
 * time, which by the end of a week would have cycled through most of the
 * roster and stopped meaning "the starters." Only nights still ahead of `now`
 * are filled in this way — a past night with no lineup is a settled fact
 * (nobody started anyone), not a gap to fill in after the fact.
 */

export type GameState = "upcoming" | "live" | "final";

export interface PendingGame {
  playerId: number;
  playerName: string;
  playedOn: string;
  slot: string;
  /** ISO 8601, or null when the schedule carries a date but no tip-off time. */
  tipoff: string | null;
  opponent: string | null;
  /** Average under this config before this night. Zero for a player with none. */
  projected: number;
}

export interface TeamOutlook extends TeamPeriod {
  /** Started games with no box score filed yet, soonest first. */
  pending: PendingGame[];
  /** Of those, the ones whose game has tipped off. */
  live: number;
  /** And the ones still to come. */
  upcoming: number;
  /**
   * Where the period lands if every pending game scores its projection —
   * the best `gamesCap` of what is scored plus what is expected.
   */
  projected: number;
}

/** Whether a night has tipped off, is under way, or has been filed. */
export function gameState(
  game: { tipoff: string | null; score: number | null }, now: Date,
): GameState {
  if (game.score !== null) return "final";
  if (game.tipoff !== null && new Date(game.tipoff) <= now) return "live";
  return "upcoming";
}

/**
 * Where the period lands if every pending game scores its projection — each
 * player's own best value this week, played or projected, ranked against
 * every other starter's best and cut off at `cap`. Mirrors `scorePeriod`'s
 * per-player cap exactly, so a live total never implies a different rule than
 * the one the week actually settles under.
 */
function bestPerPlayer(entries: { playerId: number; value: number }[], cap: number): number {
  const byPlayer = new Map<number, number>();
  for (const { playerId, value } of entries) {
    const best = byPlayer.get(playerId);
    if (best === undefined || value > best) byPlayer.set(playerId, value);
  }
  return [...byPlayer.values()].sort((a, b) => b - a).slice(0, cap).reduce((a, b) => a + b, 0);
}

interface FrozenStarter { name: string; slot: string }

/**
 * The team's current starters — a fixed set of named players, not a nightly
 * re-optimisation.
 *
 * If today's lineup has already been decided, that decision *is* the current
 * roster; no guessing required. Otherwise this runs the same `autoFill` a
 * manager would run right now, but over the whole roster rather than
 * tonight's slate — a depth chart ranked by production, independent of
 * whether tonight happens to be one of this team's game nights.
 */
async function currentStarters(
  db: Db, { fantasyTeamId, configId, settings, now }: {
    fantasyTeamId: number; configId: number; settings: LeagueSettings; now: Date;
  },
): Promise<Map<number, FrozenStarter>> {
  const today = now.toISOString().slice(0, 10);

  const { rows: decidedToday } = await db.query<{ player_id: string; name: string; slot: string }>(
    `SELECT l.player_id, p.name, l.slot
       FROM lineup_entry l JOIN player p ON p.id = l.player_id
      WHERE l.fantasy_team_id = $1 AND l.played_on = $2 AND l.slot NOT IN ('BENCH', 'IR')`,
    [fantasyTeamId, today],
  );
  if (decidedToday.length > 0) {
    return new Map(decidedToday.map((r) => [Number(r.player_id), { name: r.name, slot: r.slot }]));
  }

  const { rows: roster } = await db.query<{
    player_id: string; name: string; role: string | null; projected: number | null;
  }>(
    `SELECT r.player_id, p.name,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = r.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role,
            (SELECT avg(sc.score) FROM player_game_score sc
              WHERE sc.player_id = r.player_id AND sc.config_id = $2 AND sc.played_on < $3) AS projected
       FROM roster_slot r JOIN player p ON p.id = r.player_id
      WHERE r.fantasy_team_id = $1
        AND r.acquired_on <= $3
        AND (r.released_on IS NULL OR r.released_on > $3)`,
    [fantasyTeamId, configId, today],
  );

  const filled = autoFill(
    roster.map((r) => ({
      playerId: Number(r.player_id), role: r.role,
      projected: r.projected === null ? 0 : Number(r.projected),
    })),
    settings,
  );
  const names = new Map(roster.map((r) => [Number(r.player_id), r.name]));
  const starters = new Map<number, FrozenStarter>();
  for (const f of filled) {
    if (f.slot === "BENCH" || f.slot === "IR") continue;
    starters.set(f.playerId, { name: names.get(f.playerId)!, slot: f.slot });
  }
  return starters;
}

/**
 * The current starters' remaining games in a range that no lineup has been
 * set for yet — nothing invented for a player outside that fixed set, even
 * one whose real team plays that night.
 */
async function pendingForCurrentStarters(
  db: Db, { fantasyTeamId, configId, from, to, today, starters }: {
    fantasyTeamId: number; configId: number; from: string; to: string; today: string;
    starters: Map<number, FrozenStarter>;
  },
): Promise<PendingGame[]> {
  const playerIds = [...starters.keys()];
  if (playerIds.length === 0) return [];

  const { rows } = await db.query<{
    player_id: string; played_on: string; tipoff: Date | null;
    opponent: string | null; projected: number | null;
  }>(
    `SELECT player_id, played_on, tipoff, opponent, projected FROM (
       SELECT DISTINCT ON (p.id, g.played_on)
              p.id AS player_id, to_char(g.played_on, 'YYYY-MM-DD') AS played_on,
              g.tipoff, opp.name AS opponent, form.projected
         FROM player p
         JOIN game g ON (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
         LEFT JOIN player_game_score s
           ON s.player_id = p.id AND s.played_on = g.played_on AND s.config_id = $2
         LEFT JOIN team opp
           ON opp.id = CASE WHEN g.home_team_id = p.team_id THEN g.away_team_id ELSE g.home_team_id END
         LEFT JOIN LATERAL (
           -- Form is what is known *now*, not what the season will know by the
           -- night in question: averaging up to a future game date would price
           -- that game off results nobody has seen yet.
           SELECT avg(sc.score) AS projected FROM player_game_score sc
            WHERE sc.player_id = p.id AND sc.config_id = $2
              AND sc.played_on < LEAST(g.played_on, $6::date)
         ) form ON true
        WHERE p.id = ANY($3::bigint[])
          AND g.played_on BETWEEN $4 AND $5
          -- A filed score only settles a night that has actually arrived. On a
          -- night still ahead of us the score is the season's own future and
          -- must not stop the projection, or a week the database already holds
          -- the answer to reads as nothing to play for.
          AND (s.score IS NULL OR g.played_on > $6)
          AND NOT EXISTS (
            SELECT 1 FROM lineup_entry le
             WHERE le.fantasy_team_id = $1 AND le.played_on = g.played_on
          )
        ORDER BY p.id, g.played_on, g.tipoff NULLS LAST
     ) t`,
    [fantasyTeamId, configId, playerIds, from, to, today],
  );

  return rows.map((r) => {
    const starter = starters.get(Number(r.player_id))!;
    return {
      playerId: Number(r.player_id),
      playerName: starter.name,
      playedOn: r.played_on,
      slot: starter.slot,
      tipoff: r.tipoff === null ? null : r.tipoff.toISOString(),
      opponent: r.opponent,
      projected: r.projected === null ? 0 : Number(r.projected),
    };
  });
}

export async function periodOutlook(
  db: Db,
  { fantasyTeamId, configId, from, to, settings = DEFAULT_SETTINGS, now = new Date() }: {
    fantasyTeamId: number; configId: number; from: string; to: string;
    settings?: LeagueSettings; now?: Date;
  },
): Promise<TeamOutlook> {
  const today = now.toISOString().slice(0, 10);
  const scored = await scorePeriod(db, { fantasyTeamId, configId, from, to, settings, asOf: today });

  const { rows } = await db.query<{
    player_id: string; name: string; played_on: string; slot: string;
    tipoff: Date | null; opponent: string | null; projected: number | null;
  }>(
    `SELECT l.player_id, p.name, to_char(l.played_on, 'YYYY-MM-DD') AS played_on, l.slot,
            sched.tipoff, opp.name AS opponent, form.projected
       FROM lineup_entry l
       JOIN player p ON p.id = l.player_id
       LEFT JOIN player_game_score s
         ON s.player_id = l.player_id AND s.played_on = l.played_on AND s.config_id = $2
       LEFT JOIN LATERAL (
         SELECT g.tipoff,
                CASE WHEN g.home_team_id = p.team_id THEN g.away_team_id ELSE g.home_team_id END AS opp_id
           FROM game g
          WHERE g.played_on = l.played_on
            AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
          LIMIT 1
       ) sched ON true
       LEFT JOIN team opp ON opp.id = sched.opp_id
       LEFT JOIN LATERAL (
         SELECT avg(sc.score) AS projected
           FROM player_game_score sc
          WHERE sc.player_id = l.player_id AND sc.config_id = $2
            AND sc.played_on < LEAST(l.played_on, $5::date)
       ) form ON true
      WHERE l.fantasy_team_id = $1
        AND l.played_on BETWEEN $3 AND $4
        AND l.slot NOT IN ('BENCH', 'IR')
        -- Tonight and later only. A started night already behind us is over
        -- whatever the box score says: a starter with no line that night did
        -- not play, and a DNP is zero points, not a game still to come. Left
        -- pending it would read as "live" for the rest of the season and hold
        -- a finished week open behind it.
        AND l.played_on >= $5
        AND (s.score IS NULL OR l.played_on > $5)
      ORDER BY sched.tipoff NULLS LAST, p.name`,
    [fantasyTeamId, configId, from, to, today],
  );

  const decided: PendingGame[] = rows.map((r) => ({
    playerId: Number(r.player_id),
    playerName: r.name,
    playedOn: r.played_on,
    slot: r.slot,
    tipoff: r.tipoff === null ? null : r.tipoff.toISOString(),
    opponent: r.opponent,
    projected: r.projected === null ? 0 : Number(r.projected),
  }));

  const frozen = today > to ? [] : await currentStarters(db, { fantasyTeamId, configId, settings, now })
    .then((starters) => pendingForCurrentStarters(db, {
      fantasyTeamId, configId, from: today > from ? today : from, to, today, starters,
    }));

  const pending = [...decided, ...frozen].sort((a, b) => {
    if (a.tipoff === b.tipoff) return a.playerName.localeCompare(b.playerName);
    if (a.tipoff === null) return 1;
    if (b.tipoff === null) return -1;
    return a.tipoff.localeCompare(b.tipoff);
  });

  const live = pending.filter((g) => g.tipoff !== null && new Date(g.tipoff) <= now).length;

  return {
    ...scored,
    pending,
    live,
    upcoming: pending.length - live,
    projected: bestPerPlayer(
      [
        ...scored.games.map((g) => ({ playerId: g.playerId, value: g.score })),
        ...pending.map((g) => ({ playerId: g.playerId, value: g.projected })),
      ],
      settings.gamesCap,
    ),
  };
}

/** One player's score on one night, for everyone on a roster. */
export async function scoresOn(
  db: Db,
  { fantasyTeamId, day, configId }: { fantasyTeamId: number; day: string; configId: number },
): Promise<Map<number, number>> {
  const { rows } = await db.query<{ player_id: string; score: number }>(
    `SELECT s.player_id, s.score
       FROM player_game_score s
       JOIN roster_slot r ON r.player_id = s.player_id
      WHERE r.fantasy_team_id = $1
        AND r.acquired_on <= $2
        AND (r.released_on IS NULL OR r.released_on > $2)
        AND s.played_on = $2 AND s.config_id = $3`,
    [fantasyTeamId, day, configId],
  );
  return new Map(rows.map((r) => [Number(r.player_id), Number(r.score)]));
}

export interface RankedTeam extends StandingsRow {
  rank: number;
  /** Places gained since the week before last settled. Null with no history. */
  movement: number | null;
}

/**
 * The table, plus which way each team is going.
 *
 * Movement is the current table against the table as it stood one settled week
 * ago — recomputed rather than stored, because standings themselves are. With
 * only one settled week there is nothing to have moved from, and the column
 * says so by being absent rather than by claiming everybody held station.
 */
export async function rankedStandings(db: Db, leagueId: number): Promise<RankedTeam[]> {
  const table = await standings(db, leagueId);

  const { rows } = await db.query<{ week: number }>(
    `SELECT DISTINCT week FROM matchup
      WHERE league_id = $1 AND settled_at IS NOT NULL AND round IS NULL
      ORDER BY week DESC LIMIT 2`,
    [leagueId],
  );
  const previousWeek = rows[1]?.week ?? null;

  if (previousWeek === null) {
    return table.map((row, i) => ({ ...row, rank: i + 1, movement: null }));
  }

  const { rows: before } = await db.query<{ id: string; wins: string; points_for: string | null }>(
    `WITH sides AS (
       SELECT home_team_id AS team_id, home_points AS pf, away_points AS pa
         FROM matchup WHERE league_id = $1 AND settled_at IS NOT NULL AND round IS NULL AND week <= $2
       UNION ALL
       SELECT away_team_id, away_points, home_points
         FROM matchup WHERE league_id = $1 AND settled_at IS NOT NULL AND round IS NULL AND week <= $2
     )
     SELECT t.id,
            count(*) FILTER (WHERE s.pf > s.pa) AS wins,
            sum(s.pf) AS points_for
       FROM fantasy_team t LEFT JOIN sides s ON s.team_id = t.id
      WHERE t.league_id = $1
      GROUP BY t.id, t.name
      ORDER BY wins DESC, points_for DESC NULLS LAST`,
    [leagueId, previousWeek],
  );
  const wasRanked = new Map(before.map((r, i) => [Number(r.id), i + 1]));

  return table.map((row, i) => {
    const was = wasRanked.get(row.fantasyTeamId);
    return {
      ...row,
      rank: i + 1,
      movement: was === undefined ? null : was - (i + 1),
    };
  });
}

/**
 * How many of a roster's players have a game on each night in a range.
 *
 * The day strip is a navigation control, and a navigation control that cannot
 * say which nights are worth visiting is a row of identical buttons. College
 * schedules are uneven enough that most of them are empty.
 */
export async function slateByDay(
  db: Db,
  { fantasyTeamId, from, to }: { fantasyTeamId: number; from: string; to: string },
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ played_on: string; games: string }>(
    `SELECT to_char(g.played_on, 'YYYY-MM-DD') AS played_on, count(*) AS games
       FROM roster_slot r
       JOIN player p ON p.id = r.player_id
       JOIN game g
         ON g.played_on BETWEEN $2 AND $3
        AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
      WHERE r.fantasy_team_id = $1
        AND r.acquired_on <= g.played_on
        AND (r.released_on IS NULL OR r.released_on > g.played_on)
      GROUP BY 1`,
    [fantasyTeamId, from, to],
  );
  return new Map(rows.map((r) => [r.played_on, Number(r.games)]));
}

export interface Activity {
  id: number;
  kind: string;
  at: string;
  fantasyTeamId: number | null;
  teamName: string | null;
  playerId: number | null;
  playerName: string | null;
  byName: string | null;
}

/**
 * What has happened in the league, newest first.
 *
 * Read straight off the transaction log rather than reconstructed from rosters,
 * because the log is the only place that knows *why* a tenure opened or closed
 * — a player who was traded was not released, and a feed that says otherwise is
 * the one thing a manager came to it to check.
 *
 * The wording is the caller's job. This returns the facts the log holds and
 * nothing else: no event is synthesised for something the league did not write
 * down.
 */
export async function leagueActivity(
  db: Db, { leagueId, limit = 12 }: { leagueId: number; limit?: number },
): Promise<Activity[]> {
  const { rows } = await db.query<{
    id: string; kind: string; created_at: Date;
    team_id: string | null; team_name: string | null;
    player_id: string | null; player_name: string | null; by_name: string | null;
  }>(
    `SELECT t.id, t.kind, t.created_at,
            (t.payload->>'fantasyTeamId') AS team_id, ft.name AS team_name,
            (t.payload->>'playerId') AS player_id, p.name AS player_name,
            u.display_name AS by_name
       FROM transaction t
       LEFT JOIN fantasy_team ft ON ft.id = (t.payload->>'fantasyTeamId')::bigint
       LEFT JOIN player p ON p.id = (t.payload->>'playerId')::bigint
       LEFT JOIN app_user u ON u.id = t.created_by
      WHERE t.league_id = $1
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $2`,
    [leagueId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    at: r.created_at.toISOString(),
    fantasyTeamId: r.team_id === null ? null : Number(r.team_id),
    teamName: r.team_name,
    playerId: r.player_id === null ? null : Number(r.player_id),
    playerName: r.player_name,
    byName: r.by_name,
  }));
}
