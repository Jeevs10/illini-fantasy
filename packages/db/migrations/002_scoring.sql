-- Scoring. The design constraint: a scoring change must be replayable and
-- auditable, so scores are versioned by the config that produced them rather
-- than overwritten in place.

-- A frozen copy of the ScoringConfig. Editing weights in the commissioner UI
-- inserts a new row; it never mutates an existing one, because settled
-- matchups reference the version that scored them.
CREATE TABLE IF NOT EXISTS scoring_config (
  id            bigserial PRIMARY KEY,
  label         text NOT NULL,
  config        jsonb NOT NULL,
  -- Digest of `config`, so an identical config is never stored twice and a
  -- replay can prove it used the same rules.
  digest        text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

CREATE TABLE IF NOT EXISTS player_game_score (
  player_id     bigint NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  played_on     date NOT NULL,
  config_id     bigint NOT NULL REFERENCES scoring_config(id),

  archetype     text NOT NULL,
  -- The six blocks, kept so a manager can see why a game scored what it did.
  blocks        jsonb NOT NULL,
  raw           double precision NOT NULL,
  multiplier    double precision NOT NULL,
  minutes_gate  double precision NOT NULL,
  score         double precision NOT NULL,

  scored_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, played_on, config_id),
  FOREIGN KEY (player_id, played_on) REFERENCES player_game_stat (player_id, played_on) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pgsc_date_config_idx ON player_game_score (played_on, config_id);
CREATE INDEX IF NOT EXISTS pgsc_score_idx ON player_game_score (config_id, score DESC);

-- Which config a league scores by. Changing it re-reads existing scores rather
-- than recomputing them, because every config's scores are already stored.
CREATE TABLE IF NOT EXISTS ingest_run (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL,
  target_date   date,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rows_written  integer,
  status        text NOT NULL DEFAULT 'running',
  error         text
);
CREATE INDEX IF NOT EXISTS ingest_run_kind_date_idx ON ingest_run (kind, target_date);
