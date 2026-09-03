-- League data. Never written by ingest.

CREATE TABLE IF NOT EXISTS app_user (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  season        integer NOT NULL,
  config_id     bigint NOT NULL REFERENCES scoring_config(id),
  -- Roster slots, waiver rules, playoff weeks, games cap.
  settings      jsonb NOT NULL,
  commissioner_id bigint REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fantasy_team (
  id            bigserial PRIMARY KEY,
  league_id     bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  owner_id      bigint REFERENCES app_user(id),
  name          text NOT NULL,
  UNIQUE (league_id, name)
);

-- A player's tenure on a fantasy team. Closed rows are history, so a trade or
-- waiver claim never destroys the record of who owned whom on a given night.
CREATE TABLE IF NOT EXISTS roster_slot (
  id            bigserial PRIMARY KEY,
  fantasy_team_id bigint NOT NULL REFERENCES fantasy_team(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES player(id),
  acquired_on   date NOT NULL,
  released_on   date,
  acquired_via  text NOT NULL
);
CREATE INDEX IF NOT EXISTS roster_slot_team_idx ON roster_slot (fantasy_team_id);
CREATE UNIQUE INDEX IF NOT EXISTS roster_slot_active_idx
  ON roster_slot (fantasy_team_id, player_id) WHERE released_on IS NULL;

-- Which players were started, per scoring day. Written at lock, never after.
CREATE TABLE IF NOT EXISTS lineup_entry (
  fantasy_team_id bigint NOT NULL REFERENCES fantasy_team(id) ON DELETE CASCADE,
  played_on     date NOT NULL,
  player_id     bigint NOT NULL REFERENCES player(id),
  slot          text NOT NULL,
  locked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fantasy_team_id, played_on, player_id)
);

CREATE TABLE IF NOT EXISTS matchup (
  id            bigserial PRIMARY KEY,
  league_id     bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  week          integer NOT NULL,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  home_team_id  bigint NOT NULL REFERENCES fantasy_team(id),
  away_team_id  bigint NOT NULL REFERENCES fantasy_team(id),
  home_points   double precision,
  away_points   double precision,
  settled_at    timestamptz,
  UNIQUE (league_id, week, home_team_id)
);

CREATE TABLE IF NOT EXISTS transaction (
  id            bigserial PRIMARY KEY,
  league_id     bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES app_user(id)
);
CREATE INDEX IF NOT EXISTS transaction_league_idx ON transaction (league_id, created_at DESC);
