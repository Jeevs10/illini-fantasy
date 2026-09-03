import type { Db } from "@illini/db";
import { GAME_CONFIG, archetypeFor, type Archetype, type ScoringConfig } from "@illini/scoring";
import {
  DEFAULT_SETTINGS, autoFill, validateLineup, type LeagueSettings, type LineupSlot, type Slot,
} from "./slots.ts";

export interface Startable {
  playerId: number;
  name: string;
  archetype: Archetype;
  gameId: number;
  /** ISO 8601, or null when the schedule carries a date but no tip-off time. */
  tipoff: string | null;
  opponent: string | null;
  opponentStrength: number | null;
  /** Season average under the league's config — the auto-fill ordering. */
  projected: number;
  slot: Slot;
  locked: boolean;
}

export class LineupLockedError extends Error {
  constructor(readonly playerId: number, readonly tipoff: string) {
    super(`player ${playerId} tipped off at ${tipoff} and can no longer be moved`);
    this.name = "LineupLockedError";
  }
}

export class NotOnRosterError extends Error {
  constructor(readonly playerId: number, readonly fantasyTeamId: number) {
    super(`player ${playerId} is not on team ${fantasyTeamId}`);
    this.name = "NotOnRosterError";
  }
}

export class InvalidLineupError extends Error {
  constructor(readonly violations: { slot: Slot; message: string }[]) {
    super(violations.map((v) => v.message).join("; "));
    this.name = "InvalidLineupError";
  }
}

/**
 * Everyone on the roster with a real game that night, and what they are set to.
 *
 * Startability comes from the *schedule* — `game` joined on the player's real
 * team — not from `player_game_stat`, which only exists once a box score has
 * been filed. Reading availability from the stat table is what made lineups
 * settable in hindsight only.
 */
export async function startableOn(
  db: Db,
  { fantasyTeamId, day, configId, config = GAME_CONFIG, now = new Date() }: {
    fantasyTeamId: number; day: string; configId: number;
    config?: ScoringConfig; now?: Date;
  },
): Promise<Startable[]> {
  const { rows } = await db.query<{
    player_id: string; name: string; archetype: Archetype | null; role: string | null;
    game_id: string; tipoff: Date | null; opponent: string | null;
    opponent_strength: number | null; projected: number | null; slot: Slot | null;
  }>(
    `WITH roster AS (
       SELECT r.player_id, p.name, p.team_id
         FROM roster_slot r
         JOIN player p ON p.id = r.player_id
        WHERE r.fantasy_team_id = $1
          AND r.acquired_on <= $2
          AND (r.released_on IS NULL OR r.released_on > $2)
     ),
     tonight AS (
       SELECT g.id AS game_id, g.tipoff, g.season, g.home_team_id AS team_id,
              g.away_team_id AS opponent_id
         FROM game g WHERE g.played_on = $2
       UNION ALL
       SELECT g.id, g.tipoff, g.season, g.away_team_id, g.home_team_id
         FROM game g WHERE g.played_on = $2
     ),
     form AS (
       SELECT s.player_id, avg(s.score) AS projected,
              (array_agg(s.archetype ORDER BY s.played_on DESC))[1] AS archetype
         FROM player_game_score s
        WHERE s.config_id = $3 AND s.played_on < $2
        GROUP BY s.player_id
     )
     SELECT roster.player_id, roster.name, form.archetype, form.projected,
            tonight.game_id, tonight.tipoff,
            opp.name AS opponent, rating.strength AS opponent_strength,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = roster.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role,
            l.slot
       FROM roster
       JOIN tonight ON tonight.team_id = roster.team_id
       LEFT JOIN form ON form.player_id = roster.player_id
       LEFT JOIN team opp ON opp.id = tonight.opponent_id
       LEFT JOIN LATERAL (
         SELECT strength FROM team_rating tr
          WHERE tr.team_id = tonight.opponent_id AND tr.season = tonight.season
            AND tr.as_of <= $2
          ORDER BY tr.as_of DESC LIMIT 1
       ) rating ON true
       LEFT JOIN lineup_entry l
         ON l.fantasy_team_id = $1 AND l.played_on = $2 AND l.player_id = roster.player_id
      ORDER BY form.projected DESC NULLS LAST, roster.name`,
    [fantasyTeamId, day, configId],
  );

  return rows.map((r) => ({
    playerId: Number(r.player_id),
    name: r.name,
    archetype: r.archetype ?? archetypeFor(r.role, config),
    gameId: Number(r.game_id),
    tipoff: r.tipoff === null ? null : r.tipoff.toISOString(),
    opponent: r.opponent,
    opponentStrength: r.opponent_strength === null ? null : Number(r.opponent_strength),
    projected: r.projected === null ? 0 : Number(r.projected),
    slot: r.slot ?? "BENCH",
    locked: r.tipoff !== null && r.tipoff <= now,
  }));
}

export interface LineupResult {
  day: string;
  entries: LineupSlot[];
  locked: number[];
}

/**
 * Writes a lineup for one night, rejecting anything already under way.
 *
 * `entries` is a patch, not a replacement: a player it does not name keeps the
 * slot he has. Replacement semantics would mean a manager who opened the page
 * at six and submitted at eight silently benched whoever tipped off in between,
 * which is precisely the move the lock exists to refuse.
 *
 * The league locks per game at tip-off rather than once a week, so a night is
 * only partly frozen — a manager whose late game has not started is still free
 * to move. Sliding someone into a slot a locked player holds is refused too,
 * but as an overfilled slot rather than a lock violation: the lock is about
 * moving a player who has played, and that player has not moved.
 */
export async function setLineup(
  db: Db,
  { fantasyTeamId, day, entries, configId, config = GAME_CONFIG,
    settings = DEFAULT_SETTINGS, now = new Date() }: {
    fantasyTeamId: number; day: string; entries: { playerId: number; slot: Slot }[];
    configId: number; config?: ScoringConfig; settings?: LeagueSettings; now?: Date;
  },
): Promise<LineupResult> {
  const startable = await startableOn(db, { fantasyTeamId, day, configId, config, now });
  const byId = new Map(startable.map((s) => [s.playerId, s]));

  for (const entry of entries) {
    if (!byId.has(entry.playerId)) throw new NotOnRosterError(entry.playerId, fantasyTeamId);
  }

  const desired = new Map(entries.map((e) => [e.playerId, e.slot]));
  for (const player of startable) {
    const to = desired.get(player.playerId) ?? player.slot;
    if (player.locked && to !== player.slot) {
      throw new LineupLockedError(player.playerId, player.tipoff!);
    }
  }

  const lineup: LineupSlot[] = startable.map((s) => ({
    playerId: s.playerId,
    archetype: s.archetype,
    slot: desired.get(s.playerId) ?? s.slot,
  }));

  const violations = validateLineup(lineup, settings);
  if (violations.length > 0) throw new InvalidLineupError(violations);

  await writeLineup(db, fantasyTeamId, day, lineup, byId);
  return {
    day,
    entries: lineup,
    locked: startable.filter((s) => s.locked).map((s) => s.playerId),
  };
}

async function writeLineup(
  db: Db, fantasyTeamId: number, day: string, lineup: LineupSlot[],
  startable: Map<number, Startable>,
): Promise<void> {
  if (lineup.length === 0) return;
  const values: unknown[] = [];
  const tuples = lineup.map((l, i) => {
    values.push(fantasyTeamId, day, l.playerId, l.slot, startable.get(l.playerId)?.gameId ?? null);
    const base = i * 5;
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
  });
  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
     VALUES ${tuples.join(",")}
     ON CONFLICT (fantasy_team_id, played_on, player_id) DO UPDATE SET
       slot = EXCLUDED.slot, game_id = EXCLUDED.game_id, locked_at = now()`,
    values,
  );
}

/**
 * Sets the best legal lineup a manager has not already set.
 *
 * The safety net for a manager who never logs in, and the seed a manager edits
 * from. Locked players keep the slot they tipped off in — auto-fill cannot undo
 * a decision the clock has already made.
 */
export async function autoFillDay(
  db: Db,
  { fantasyTeamId, day, configId, config = GAME_CONFIG, settings = DEFAULT_SETTINGS,
    now = new Date() }: {
    fantasyTeamId: number; day: string; configId: number;
    config?: ScoringConfig; settings?: LeagueSettings; now?: Date;
  },
): Promise<LineupResult> {
  const startable = await startableOn(db, { fantasyTeamId, day, configId, config, now });
  if (startable.length === 0) return { day, entries: [], locked: [] };

  const locked = startable.filter((s) => s.locked);
  const open = startable.filter((s) => !s.locked);

  // Whatever the locked players are already in is spent; auto-fill competes for
  // what is left.
  const remaining = settings.starters.map(({ slot, count }) => ({
    slot,
    count: count - locked.filter((l) => l.slot === slot).length,
  })).filter((s) => s.count > 0);

  const filled = autoFill(
    open.map((s) => ({ playerId: s.playerId, archetype: s.archetype, projected: s.projected })),
    { ...settings, starters: remaining },
  );

  const lineup: LineupSlot[] = [
    ...locked.map((l) => ({ playerId: l.playerId, archetype: l.archetype, slot: l.slot })),
    ...filled,
  ];

  await writeLineup(db, fantasyTeamId, day, lineup, new Map(startable.map((s) => [s.playerId, s])));
  return { day, entries: lineup, locked: locked.map((l) => l.playerId) };
}

/** Auto-fills every team in a league for one night. */
export async function autoFillLeague(
  db: Db, leagueId: number, day: string, now = new Date(),
): Promise<{ teams: number; started: number }> {
  const { rows } = await db.query<{ id: string; config_id: string; settings: LeagueSettings }>(
    `SELECT t.id, l.config_id, l.settings
       FROM fantasy_team t JOIN league l ON l.id = t.league_id
      WHERE t.league_id = $1 ORDER BY t.id`,
    [leagueId],
  );

  let started = 0;
  for (const row of rows) {
    const result = await autoFillDay(db, {
      fantasyTeamId: Number(row.id),
      day,
      configId: Number(row.config_id),
      settings: { ...DEFAULT_SETTINGS, ...(row.settings ?? {}) },
      now,
    });
    started += result.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR").length;
  }
  return { teams: rows.length, started };
}
