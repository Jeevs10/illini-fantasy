-- Every player's projected score for every game still ahead of him, from the
-- forward model's morning feed: his projected per-100 rates over his projected
-- minutes of the game's projected possessions, through the same box weights
-- and opponent term the real valAdj uses (Data/Scripts/forward_model/
-- export_fantasy.py, game_projections).
--
-- One row per player per game, replaced each morning until the game is played
-- — a projection is the latest forecast, not a record. Keyed by the night as
-- well as the game, because every reader asks "what is he projected for on
-- this date" and none of them carries the game id at that point.
--
-- Wherever the app projects a game it reads this first and falls back to the
-- player's average so far, so a league without a feed reads exactly as before.

CREATE TABLE IF NOT EXISTS player_game_projection (
  player_id     bigint NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  game_id       bigint NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  played_on     date NOT NULL,
  projected     double precision NOT NULL,
  mpg           double precision,
  listed_out    boolean NOT NULL DEFAULT false,
  as_of         date NOT NULL,
  PRIMARY KEY (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS player_game_projection_night_idx
  ON player_game_projection (player_id, played_on);
