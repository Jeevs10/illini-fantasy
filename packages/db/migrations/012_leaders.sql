-- The stat surface. Two additions: bio columns on `player` (Torvik and CBBD
-- already fetch these; ingest just discarded them until now), and a rank
-- rollup, since "where does this player rank" is otherwise a full-table scan
-- of `player_game_score` on every page view.

-- No recruit_rank: Torvik's pslice column that looked like one (index 34,
-- named recRank in COL) turns out to hold a fractional rate stat on real
-- data, not an integer rank — getadvstats' CSV inserts hometown/weight at
-- 33-34 that pslice does not carry, and the label is a leftover from that
-- shape. A real recruit rank exists on CBBD's recruits() endpoint instead,
-- left for a later pass.
ALTER TABLE player
  ADD COLUMN height text,
  ADD COLUMN jersey text,
  ADD COLUMN weight integer,
  ADD COLUMN hometown text,
  ADD COLUMN date_of_birth date;

-- Season-to-date total and rank as of each played_on, one row per
-- (config, day, player). Rebuilt wholesale by one re-runnable INSERT ...
-- SELECT over player_game_score — never written incrementally, so a Torvik
-- revision or a re-score under a new config is a rebuild, not a repair.
CREATE TABLE IF NOT EXISTS player_rank (
  config_id     bigint NOT NULL REFERENCES scoring_config(id),
  played_on     date NOT NULL,
  player_id     bigint NOT NULL REFERENCES player(id),
  season_total  numeric NOT NULL,
  games         integer NOT NULL,
  rank_overall  integer NOT NULL,
  rank_role     integer NOT NULL,
  PRIMARY KEY (config_id, played_on, player_id)
);
CREATE INDEX IF NOT EXISTS player_rank_lookup_idx
  ON player_rank (player_id, config_id, played_on);
