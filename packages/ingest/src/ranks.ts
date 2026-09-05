import type { Db } from "@illini/db";
import { upsertScoringConfig } from "@illini/db";
import { GAME_CONFIG, type ScoringConfig } from "@illini/scoring";

export interface RankRebuildResult {
  configId: number;
  rowsWritten: number;
}

/**
 * Rebuilds the season-to-date rank rollup for one scoring config.
 *
 * One INSERT ... SELECT over player_game_score, window functions doing the
 * running total and the rank — never written incrementally, so a Torvik
 * revision or a re-score under a new config is a rebuild, not a repair, and
 * always safe to run again. No Torvik call: everything it reads is already
 * in the database.
 */
export async function rebuildPlayerRanks(
  db: Db,
  { config = GAME_CONFIG, configLabel = "game" }: { config?: ScoringConfig; configLabel?: string } = {},
): Promise<RankRebuildResult> {
  const { id: configId } = await upsertScoringConfig(db, configLabel, config);
  const { rowCount } = await db.query(
    `INSERT INTO player_rank (config_id, played_on, player_id, season_total, games, rank_overall, rank_role)
     SELECT config_id, played_on, player_id, season_total, games,
            RANK() OVER (PARTITION BY played_on ORDER BY season_total DESC) AS rank_overall,
            RANK() OVER (PARTITION BY played_on, role ORDER BY season_total DESC) AS rank_role
       FROM (
         SELECT s.config_id, s.played_on, s.player_id, p.position AS role,
                SUM(s.score) OVER (PARTITION BY s.player_id ORDER BY s.played_on) AS season_total,
                COUNT(*) OVER (PARTITION BY s.player_id ORDER BY s.played_on) AS games
           FROM player_game_score s
           JOIN player p ON p.id = s.player_id
          WHERE s.config_id = $1
       ) totals
     ON CONFLICT (config_id, played_on, player_id) DO UPDATE SET
       season_total = EXCLUDED.season_total,
       games = EXCLUDED.games,
       rank_overall = EXCLUDED.rank_overall,
       rank_role = EXCLUDED.rank_role`,
    [configId],
  );
  return { configId, rowsWritten: rowCount ?? 0 };
}
