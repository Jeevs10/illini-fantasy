import type { ScoredLine } from "@illini/scoring";
import type { Db } from "./client.ts";

export interface StoredScore extends ScoredLine {
  playedOn: string;
}

/**
 * Writes scores for one config version.
 *
 * Idempotent by construction: the primary key is (player, date, config), so
 * re-running a night overwrites that night's rows for that config and leaves
 * every other config untouched. That is what makes a Torvik revision safe to
 * replay, and what lets a scoring change be compared against the old one
 * instead of destroying it.
 */
export async function writeScores(
  db: Db, configId: number, playedOn: string, scores: StoredScore[],
): Promise<number> {
  if (scores.length === 0) return 0;

  const columns = 9;
  const values: unknown[] = [];
  const tuples = scores.map((s, i) => {
    values.push(
      Number(s.playerId), playedOn, configId, s.archetype,
      JSON.stringify(s.blocks), s.raw, s.multiplier, s.minutesGate, s.score,
    );
    const base = i * columns;
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},` +
      `$${base + 6},$${base + 7},$${base + 8},$${base + 9})`;
  });

  const { rowCount } = await db.query(
    `INSERT INTO player_game_score
       (player_id, played_on, config_id, archetype, blocks, raw, multiplier, minutes_gate, score)
     VALUES ${tuples.join(",")}
     ON CONFLICT (player_id, played_on, config_id) DO UPDATE SET
       archetype = EXCLUDED.archetype,
       blocks = EXCLUDED.blocks,
       raw = EXCLUDED.raw,
       multiplier = EXCLUDED.multiplier,
       minutes_gate = EXCLUDED.minutes_gate,
       score = EXCLUDED.score,
       scored_at = now()`,
    values,
  );
  return rowCount ?? 0;
}

/** A fantasy team's total for a scoring period, from started players only. */
export async function matchupTotal(
  db: Db, fantasyTeamId: number, configId: number, from: string, to: string,
): Promise<number> {
  const { rows } = await db.query<{ total: string | null }>(
    `SELECT sum(s.score) AS total
       FROM lineup_entry l
       JOIN player_game_score s
         ON s.player_id = l.player_id
        AND s.played_on = l.played_on
        AND s.config_id = $2
      WHERE l.fantasy_team_id = $1
        AND l.played_on BETWEEN $3 AND $4`,
    [fantasyTeamId, configId, from, to],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Compare two config versions over the same games — the commissioner's diff. */
export async function compareConfigs(
  db: Db, baseConfigId: number, candidateConfigId: number, season: number,
): Promise<{ players: number; meanDelta: number; maxDelta: number }> {
  const { rows } = await db.query<{ players: string; mean_delta: string | null; max_delta: string | null }>(
    `SELECT count(*) AS players,
            avg(c.score - b.score) AS mean_delta,
            max(abs(c.score - b.score)) AS max_delta
       FROM player_game_score b
       JOIN player_game_score c
         ON c.player_id = b.player_id AND c.played_on = b.played_on
       JOIN player_game_stat st
         ON st.player_id = b.player_id AND st.played_on = b.played_on
      WHERE b.config_id = $1 AND c.config_id = $2 AND st.season = $3`,
    [baseConfigId, candidateConfigId, season],
  );
  const r = rows[0];
  return {
    players: Number(r?.players ?? 0),
    meanDelta: Number(r?.mean_delta ?? 0),
    maxDelta: Number(r?.max_delta ?? 0),
  };
}
