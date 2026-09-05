-- A matchup carries the settings it settled under.
--
-- `player_game_score` has always been versioned by `config_id`; `matchup` was
-- not, so every settle/score path re-read `league.config_id`/`league.settings`
-- live. That is why a games-cap change had to rewrite already-settled weeks
-- in place to keep the standings honest — there was nowhere on the row to
-- record what it had actually been scored under. Now there is.

ALTER TABLE matchup ADD COLUMN IF NOT EXISTS config_id bigint REFERENCES scoring_config(id);
ALTER TABLE matchup ADD COLUMN IF NOT EXISTS settings jsonb;

-- Nothing recorded what an already-settled matchup actually used, so the
-- closest honest answer is what the league is running today. Every settle
-- call from here on writes its own snapshot; this UPDATE is the one-time seam
-- between "derived live" and "recorded once," and is safe to re-run — it only
-- ever touches a row that has settled but has no snapshot yet.
UPDATE matchup m SET config_id = l.config_id, settings = l.settings
  FROM league l
 WHERE l.id = m.league_id AND m.settled_at IS NOT NULL AND m.config_id IS NULL;
