-- Source data: everything ingested from Torvik, CBBD, ESPN and RotoWire.
-- Kept separate from league data so a re-ingest can never touch a roster.

CREATE TABLE IF NOT EXISTS team (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  normalised    text NOT NULL UNIQUE,   -- crosswalk key; see @illini/crosswalk
  conference    text,
  cbbd_id       integer UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per real human. Source ids hang off it, never the other way round.
CREATE TABLE IF NOT EXISTS player (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  normalised    text NOT NULL,
  team_id       bigint REFERENCES team(id),
  position      text,
  class_year    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_normalised_idx ON player (normalised);
CREATE INDEX IF NOT EXISTS player_team_idx ON player (team_id);

-- The crosswalk. Four ID spaces share nothing, so every join runs through here.
CREATE TYPE source_kind AS ENUM ('torvik', 'cbbd', 'espn', 'ncaa', 'rotowire');
CREATE TYPE match_confidence AS ENUM ('exact', 'strong', 'weak', 'manual', 'none');

CREATE TABLE IF NOT EXISTS player_source_id (
  player_id     bigint NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  source        source_kind NOT NULL,
  source_id     text NOT NULL,
  confidence    match_confidence NOT NULL,
  reason        text,
  -- Set when a human resolves a review-queue entry; blocks automatic overwrite.
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS player_source_player_idx ON player_source_id (player_id);

-- Unresolved matches, for the commissioner UI.
CREATE TABLE IF NOT EXISTS match_review (
  id            bigserial PRIMARY KEY,
  source        source_kind NOT NULL,
  source_id     text NOT NULL,
  source_name   text NOT NULL,
  source_team   text NOT NULL,
  candidate_player_id bigint REFERENCES player(id),
  confidence    match_confidence NOT NULL,
  reason        text NOT NULL,
  resolved_at   timestamptz,
  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS game (
  id            bigserial PRIMARY KEY,
  played_on     date NOT NULL,
  season        integer NOT NULL,
  home_team_id  bigint REFERENCES team(id),
  away_team_id  bigint REFERENCES team(id),
  neutral_site  boolean NOT NULL DEFAULT false,
  cbbd_id       integer UNIQUE,
  espn_id       text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_played_on_idx ON game (played_on);

-- Opponent strength for the multiplier. Ratings move during a season, so they
-- are stored per as-of date and the scorer reads the rating current at tip-off.
CREATE TABLE IF NOT EXISTS team_rating (
  team_id       bigint NOT NULL REFERENCES team(id),
  season        integer NOT NULL,
  as_of         date NOT NULL,
  net_rating    double precision,
  offensive_rating double precision,
  defensive_rating double precision,
  -- 0..1, precomputed so scoring never has to rescan the whole table.
  strength      double precision NOT NULL,
  PRIMARY KEY (team_id, season, as_of)
);

-- The raw per-game model inputs, exactly as the source gave them. Immutable
-- except by re-ingest; scoring never writes here.
CREATE TABLE IF NOT EXISTS player_game_stat (
  player_id     bigint NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  played_on     date NOT NULL,
  season        integer NOT NULL,
  game_id       bigint REFERENCES game(id),
  opponent_team_id bigint REFERENCES team(id),
  role          text,
  minutes       double precision NOT NULL DEFAULT 0,
  stats         jsonb NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  source        source_kind NOT NULL,
  PRIMARY KEY (player_id, played_on)
);
CREATE INDEX IF NOT EXISTS pgs_played_on_idx ON player_game_stat (played_on);
CREATE INDEX IF NOT EXISTS pgs_season_idx ON player_game_stat (season);

CREATE TABLE IF NOT EXISTS player_availability (
  player_id     bigint NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  as_of         timestamptz NOT NULL,
  status        text NOT NULL,
  injury        text,
  note          text,
  PRIMARY KEY (player_id, as_of)
);
