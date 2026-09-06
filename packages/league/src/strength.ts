import type { Db } from "@illini/db";
import { upsertScoringConfig } from "@illini/db";
import { GAME_CONFIG, FLAT_GAME_CONFIG } from "@illini/scoring";
import { requireCommissioner, type Queryable } from "./membership.ts";

/**
 * Whether a league adjusts a score for who the player was playing.
 *
 * The Player-Score model ends in `raw × multiplier × minutesGate`, and the
 * multiplier is the whole strength-of-schedule story: opponent rating mapped
 * into a [2/3, 4/3] band, so thirty against Duke outscores thirty against a
 * bottom-100 team by a factor of two at the extremes. It is defensible and it
 * is not to everyone's taste — a league that wants the box score to be the box
 * score should be able to say so.
 *
 * Turning it off is not a rescore. `player_game_score` already stores `raw`,
 * `multiplier` and `minutes_gate` next to the total, so an unadjusted score is
 * `raw × minutes_gate` and is arithmetic on rows that already exist. And the
 * schema has always versioned scores by `config_id` precisely so that a
 * scoring change is a *different set of rows*, not an overwrite — which is why
 * this is a second config the league points at rather than a flag threaded
 * through the thirty-odd queries that read a score. Every one of those already
 * filters on `config_id` and is already correct; none of them has to change,
 * and none of them can be missed.
 *
 * History is safe for the same reason it is safe when the games cap moves:
 * `settleWeek` snapshots `config_id` onto the matchup, so a week already
 * settled keeps the rules it settled under. Weeks not yet settled re-read, and
 * will move — which is the point of changing the setting at all, and is worth
 * saying out loud on the screen that offers it.
 */
export interface StrengthAdjustment {
  /** True when the league scores with the opponent-strength multiplier. */
  on: boolean;
  /** The config the league currently points at. */
  configId: number;
  /** Weeks already settled, which keep the rules they settled under. */
  settledWeeks: number;
}

/** Both config versions, registered if this is the first time they are asked for. */
async function configPair(db: Db): Promise<{ adjusted: number; flat: number }> {
  const [adjusted, flat] = await Promise.all([
    upsertScoringConfig(db, "game", GAME_CONFIG),
    upsertScoringConfig(db, "game-flat", FLAT_GAME_CONFIG),
  ]);
  return { adjusted: adjusted.id, flat: flat.id };
}

export async function strengthAdjustment(
  db: Db, leagueId: number,
): Promise<StrengthAdjustment> {
  const { rows } = await db.query<{ config_id: string; settled: string }>(
    `SELECT l.config_id,
            (SELECT count(*) FROM matchup m
              WHERE m.league_id = l.id AND m.settled_at IS NOT NULL) AS settled
       FROM league l WHERE l.id = $1`,
    [leagueId]);
  const row = rows[0];
  if (row === undefined) throw new Error(`no league ${leagueId}`);

  const { flat } = await configPair(db);
  return {
    on: Number(row.config_id) !== flat,
    configId: Number(row.config_id),
    settledWeeks: Number(row.settled),
  };
}

/**
 * Fills in the unadjusted rows for every night the adjusted config has scored.
 *
 * Derived in SQL from the stored components rather than recomputed from the
 * box scores: the unadjusted score *is* `raw × minutes_gate`, exactly, and
 * re-deriving it from `player_game_stat` would be a second implementation of
 * the model that could drift from the first.
 *
 * `DO NOTHING` rather than `DO UPDATE`, so a night the ingest has already
 * written under the flat config is left alone. Safe to re-run, and re-run it
 * must be: a league that turns the setting off in January needs November
 * backfilled, and the nightly ingest keeps both versions current from then on.
 */
export async function backfillUnadjusted(
  db: Queryable, { from, to }: { from: number; to: number },
): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO player_game_score
       (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
     SELECT s.player_id, s.played_on, $2, s.archetype, s.blocks,
            s.raw, 1, s.minutes_gate, s.raw * s.minutes_gate
       FROM player_game_score s
      WHERE s.config_id = $1
     ON CONFLICT (player_id, played_on, config_id) DO NOTHING`,
    [from, to]);
  return rowCount ?? 0;
}

export interface StrengthChange {
  on: boolean;
  /** Whether the league actually moved, or was already set that way. */
  changed: boolean;
  /** Unadjusted rows derived to make the switch possible. */
  backfilled: number;
  /** Settled weeks that keep the rules they settled under. */
  settledWeeks: number;
}

/**
 * Turns the strength-of-schedule multiplier on or off for a league.
 *
 * The commissioner's, and it repoints `league.config_id` — one write, after
 * the rows it will point at are known to exist. Doing it the other way round
 * would leave a league briefly reading a config with no scores in it, which on
 * this schema is not an error but a season of zeroes.
 */
export async function setStrengthAdjustment(
  db: Db, { leagueId, byUserId, on }: { leagueId: number; byUserId: number; on: boolean },
): Promise<StrengthChange> {
  await requireCommissioner(db, leagueId, byUserId);
  const before = await strengthAdjustment(db, leagueId);
  if (before.on === on) {
    return { on, changed: false, backfilled: 0, settledWeeks: before.settledWeeks };
  }

  const { adjusted, flat } = await configPair(db);
  // The adjusted config is the one the ingest writes and the only one carrying
  // a real multiplier, so it is always the source. Turning the setting back on
  // needs no backfill at all — those rows are the originals.
  const backfilled = on ? 0 : await backfillUnadjusted(db, { from: adjusted, to: flat });

  await db.query("UPDATE league SET config_id = $2 WHERE id = $1",
    [leagueId, on ? adjusted : flat]);
  await db.query(
    `INSERT INTO transaction (league_id, kind, payload, created_by) VALUES ($1,'settings',$2,$3)`,
    [leagueId, JSON.stringify({
      changed: [{
        key: "strengthAdjustment",
        from: before.on ? "on" : "off",
        to: on ? "on" : "off",
      }],
    }), byUserId]);

  return { on, changed: true, backfilled, settledWeeks: before.settledWeeks };
}
