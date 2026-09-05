import type { Db } from "@illini/db";
import { GAME_CONFIG, archetypeFor, type Archetype, type ScoringConfig } from "@illini/scoring";
import {
  DEFAULT_SETTINGS, autoFill, validateLineup, type LeagueSettings, type LineupSlot, type Slot,
} from "./slots.ts";
import { InvalidLineupError, LineupLockedError, NotOnRosterError } from "./lineups.ts";

/**
 * The lineup as a decision about the week, not about a night.
 *
 * A manager picks seven players and those seven are their team for the period.
 * Everything each of them plays in it counts, which is what `scorePeriod` now
 * settles — so the question asked here and the question answered there are for
 * the first time the same question.
 *
 * The nightly module this sits beside is not gone and is not deprecated: a
 * night is still the unit a game is played on, still what locks, and still what
 * `/home` shows for tonight. What changed is who decides. A slot assignment is
 * made once for the period and then written across each of that player's game
 * nights inside it, so `lineup_entry` keeps its shape — one row per player per
 * night, carrying the game it was started for — while ceasing to be seven
 * separate decisions a manager has to remember to make.
 *
 * Storing it that way rather than in a new week-keyed table is deliberate.
 * Settlement, the outlook, the standings and five seasons of existing rows all
 * read lineups by date; a second source of truth for the same fact would have
 * to be reconciled with them on every read, and the reconciliation is where the
 * bugs would live. The period is the input, the nights are the storage.
 */

/** One of a starter's games inside the period. */
export interface PeriodGame {
  gameId: number;
  playedOn: string;
  /** ISO 8601, or null when the schedule carries a date but no tip-off time. */
  tipoff: string | null;
  opponent: string | null;
  opponentStrength: number | null;
  /** The filed box score, or null for a night not yet played or not yet in. */
  score: number | null;
  /** What form expects from this night, for the ones with no score. */
  projected: number;
}

export interface PeriodStarter {
  playerId: number;
  name: string;
  archetype: Archetype;
  /** The Torvik role string — what governs slot eligibility. */
  role: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  /** What he is set to for the period. */
  slot: Slot;
  /** His games inside the period, soonest first. */
  games: PeriodGame[];
  /** What he has actually banked so far. */
  scored: number;
  /**
   * Where his week lands — banked, plus form for the nights still to come.
   * This is what auto-fill ranks on, because it is what the week will be
   * scored on.
   */
  projected: number;
  /**
   * Frozen for the period. True once his first game in it has tipped off or
   * filed a box score: he has begun contributing, and a lineup decision cannot
   * be taken back after the points have started landing. Players who have not
   * played yet stay movable, so a Tuesday injury can still be answered with
   * somebody who plays on Thursday.
   */
  locked: boolean;
  /** The tip-off that locked him, when a clock is what did it. */
  lockedAt: string | null;
}

export interface PeriodLineupResult {
  from: string;
  to: string;
  entries: LineupSlot[];
  locked: number[];
}

/**
 * Everyone on the roster with at least one game in the period, and what they
 * are set to.
 *
 * A player whose real team does not play at all this period is not here: there
 * is no game for him to be started for, so he is bench by construction rather
 * than by decision. The screens list him separately.
 */
export async function startableInPeriod(
  db: Db,
  { fantasyTeamId, from, to, configId, config = GAME_CONFIG, now = new Date() }: {
    fantasyTeamId: number; from: string; to: string; configId: number;
    config?: ScoringConfig; now?: Date;
  },
): Promise<PeriodStarter[]> {
  const today = now.toISOString().slice(0, 10);
  // Whose roster: the one that applies inside the period. A finished week is
  // read with the players who were actually owned then — a March trade must not
  // rewrite who was starting in January — and a week still ahead with the
  // roster as it stands now, which is the only one anybody could be picking.
  const asOf = today < from ? from : today > to ? to : today;

  const { rows } = await db.query<{
    player_id: string; name: string; role: string | null; archetype: Archetype | null;
    primary_color: string | null; secondary_color: string | null; slot: Slot | null;
    game_id: string; played_on: string; tipoff: Date | null;
    opponent: string | null; opponent_strength: number | null;
    score: number | null; projected: number | null;
  }>(
    `WITH roster AS (
       SELECT r.player_id, p.name, p.team_id
         FROM roster_slot r
         JOIN player p ON p.id = r.player_id
        WHERE r.fantasy_team_id = $1
          AND r.acquired_on <= $4
          AND (r.released_on IS NULL OR r.released_on > $4)
     ),
     slate AS (
       SELECT g.id AS game_id, g.played_on, g.tipoff, g.season,
              g.home_team_id AS team_id, g.away_team_id AS opponent_id
         FROM game g WHERE g.played_on BETWEEN $2 AND $3
       UNION ALL
       SELECT g.id, g.played_on, g.tipoff, g.season, g.away_team_id, g.home_team_id
         FROM game g WHERE g.played_on BETWEEN $2 AND $3
     )
     SELECT roster.player_id, roster.name,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = roster.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role,
            form.archetype,
            own.primary_color, own.secondary_color,
            l.slot,
            slate.game_id, to_char(slate.played_on, 'YYYY-MM-DD') AS played_on, slate.tipoff,
            opp.name AS opponent, rating.strength AS opponent_strength,
            -- A score dated after today is the season's future, not this
            -- night's result: the same barrier the outlook reads under.
            CASE WHEN slate.played_on <= $6 THEN filed.score ELSE NULL END AS score,
            form.projected
       FROM roster
       JOIN slate ON slate.team_id = roster.team_id
       LEFT JOIN team opp ON opp.id = slate.opponent_id
       LEFT JOIN team own ON own.id = roster.team_id
       LEFT JOIN player_game_score filed
         ON filed.player_id = roster.player_id AND filed.played_on = slate.played_on
        AND filed.config_id = $5
       LEFT JOIN lineup_entry l
         ON l.fantasy_team_id = $1 AND l.player_id = roster.player_id
        AND l.played_on = slate.played_on
       LEFT JOIN LATERAL (
         SELECT strength FROM team_rating tr
          WHERE tr.team_id = slate.opponent_id AND tr.season = slate.season
            AND tr.as_of <= slate.played_on
          ORDER BY tr.as_of DESC LIMIT 1
       ) rating ON true
       LEFT JOIN LATERAL (
         SELECT avg(sc.score) AS projected,
                (array_agg(sc.archetype ORDER BY sc.played_on DESC))[1] AS archetype
           FROM player_game_score sc
          WHERE sc.player_id = roster.player_id AND sc.config_id = $5
            AND sc.played_on < LEAST(slate.played_on, $6::date)
       ) form ON true
      ORDER BY roster.player_id, slate.played_on, slate.tipoff NULLS LAST`,
    [fantasyTeamId, from, to, asOf, configId, today],
  );

  const byPlayer = new Map<number, PeriodStarter>();
  for (const r of rows) {
    const playerId = Number(r.player_id);
    const projected = r.projected === null ? 0 : Number(r.projected);
    const game: PeriodGame = {
      gameId: Number(r.game_id),
      playedOn: r.played_on,
      tipoff: r.tipoff === null ? null : r.tipoff.toISOString(),
      opponent: r.opponent,
      opponentStrength: r.opponent_strength === null ? null : Number(r.opponent_strength),
      score: r.score === null ? null : Number(r.score),
      projected,
    };

    const held = byPlayer.get(playerId);
    if (held === undefined) {
      byPlayer.set(playerId, {
        playerId,
        name: r.name,
        archetype: r.archetype ?? archetypeFor(r.role, config),
        role: r.role,
        primaryColor: r.primary_color,
        secondaryColor: r.secondary_color,
        // The period's slot is whatever his nights already say. They are
        // written together, so the first one is as good as any — and a player
        // with no row yet has not been picked, which is bench.
        slot: r.slot ?? "BENCH",
        games: [game],
        scored: 0,
        projected: 0,
        locked: false,
        lockedAt: null,
      });
      continue;
    }
    // One row per player per night: a team on the schedule twice that day is
    // one game night, and the earlier tip is the one whose clock matters.
    if (!held.games.some((g) => g.playedOn === game.playedOn)) held.games.push(game);
  }

  for (const starter of byPlayer.values()) {
    starter.games.sort((a, b) => (a.playedOn === b.playedOn
      ? (a.tipoff ?? "~").localeCompare(b.tipoff ?? "~")
      : a.playedOn.localeCompare(b.playedOn)));

    starter.scored = starter.games.reduce((a, g) => a + (g.score ?? 0), 0);
    starter.projected = starter.games.reduce((a, g) => a + (g.score ?? g.projected), 0);

    // His first night is the one that freezes him. A filed score counts as
    // played whatever the clock says, for the same reason it does nightly:
    // box scores arrive a day at a time and can land before a pinned clock
    // reaches the tip-off.
    const first = starter.games[0];
    if (first !== undefined) {
      const tipped = first.tipoff !== null && new Date(first.tipoff) <= now;
      const played = first.score !== null;
      const behindUs = first.playedOn < today;
      starter.locked = tipped || played || behindUs;
      starter.lockedAt = starter.locked ? first.tipoff : null;
    }
  }

  return [...byPlayer.values()];
}

/**
 * Sets one lineup for a whole period.
 *
 * `entries` is a patch, for the same reason the nightly version is: a player it
 * does not name keeps the slot he has, so a manager who opened the page on
 * Monday and submitted on Wednesday does not silently bench whoever started
 * playing in between.
 */
export async function setPeriodLineup(
  db: Db,
  { fantasyTeamId, from, to, entries, configId, config = GAME_CONFIG,
    settings = DEFAULT_SETTINGS, now = new Date() }: {
    fantasyTeamId: number; from: string; to: string;
    entries: { playerId: number; slot: Slot }[];
    configId: number; config?: ScoringConfig; settings?: LeagueSettings; now?: Date;
  },
): Promise<PeriodLineupResult> {
  const startable = await startableInPeriod(db, { fantasyTeamId, from, to, configId, config, now });
  const byId = new Map(startable.map((s) => [s.playerId, s]));

  for (const entry of entries) {
    if (!byId.has(entry.playerId)) throw new NotOnRosterError(entry.playerId, fantasyTeamId);
  }

  const desired = new Map(entries.map((e) => [e.playerId, e.slot]));
  for (const player of startable) {
    const want = desired.get(player.playerId) ?? player.slot;
    if (player.locked && want !== player.slot) {
      throw new LineupLockedError(player.playerId, player.lockedAt);
    }
  }

  const lineup: LineupSlot[] = startable.map((s) => ({
    playerId: s.playerId,
    role: s.role,
    slot: desired.get(s.playerId) ?? s.slot,
  }));

  const violations = validateLineup(lineup, settings);
  if (violations.length > 0) throw new InvalidLineupError(violations);

  await writePeriodLineup(db, fantasyTeamId, lineup, byId);
  return {
    from, to, entries: lineup,
    locked: startable.filter((s) => s.locked).map((s) => s.playerId),
  };
}

/**
 * Fans one period decision out across the nights it applies to.
 *
 * A row per player per game night, carrying the game he was started for — the
 * shape settlement already reads. A player's nights all get the same slot,
 * because that is what "set for the week" means.
 */
async function writePeriodLineup(
  db: Db, fantasyTeamId: number, lineup: LineupSlot[],
  starters: Map<number, PeriodStarter>,
): Promise<void> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const entry of lineup) {
    const starter = starters.get(entry.playerId);
    if (starter === undefined) continue;
    for (const game of starter.games) {
      values.push(fantasyTeamId, game.playedOn, entry.playerId, entry.slot, game.gameId);
      const base = values.length - 5;
      tuples.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
    }
  }
  if (tuples.length === 0) return;

  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
     VALUES ${tuples.join(",")}
     ON CONFLICT (fantasy_team_id, played_on, player_id) DO UPDATE SET
       slot = EXCLUDED.slot, game_id = EXCLUDED.game_id, locked_at = now()`,
    values,
  );
}

/**
 * The best legal lineup for a period, ranked on where each player's whole week
 * is expected to land rather than on any one night.
 *
 * That ranking is the point of doing it per period: a player with two games is
 * worth more than an equal player with one, and under cumulative scoring the
 * auto-fill should say so. Locked players keep what they are in.
 */
export async function autoFillPeriod(
  db: Db,
  { fantasyTeamId, from, to, configId, config = GAME_CONFIG,
    settings = DEFAULT_SETTINGS, now = new Date() }: {
    fantasyTeamId: number; from: string; to: string; configId: number;
    config?: ScoringConfig; settings?: LeagueSettings; now?: Date;
  },
): Promise<PeriodLineupResult> {
  const startable = await startableInPeriod(db, { fantasyTeamId, from, to, configId, config, now });
  if (startable.length === 0) return { from, to, entries: [], locked: [] };

  const locked = startable.filter((s) => s.locked);
  const open = startable.filter((s) => !s.locked);

  const remaining = settings.starters.map(({ slot, count }) => ({
    slot,
    count: count - locked.filter((l) => l.slot === slot).length,
  })).filter((s) => s.count > 0);

  const filled = autoFill(
    open.map((s) => ({ playerId: s.playerId, role: s.role, projected: s.projected })),
    { ...settings, starters: remaining },
  );

  const lineup: LineupSlot[] = [
    ...locked.map((l) => ({ playerId: l.playerId, role: l.role, slot: l.slot })),
    ...filled,
  ];

  await writePeriodLineup(db, fantasyTeamId, lineup, new Map(startable.map((s) => [s.playerId, s])));
  return { from, to, entries: lineup, locked: locked.map((l) => l.playerId) };
}
