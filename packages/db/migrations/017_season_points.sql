-- The rest of a player's season in fantasy points: the forward model's
-- projection for every game still on his schedule, summed, beside the
-- Player Score it already carried. The pool reads a player's season as what
-- he has scored plus this, so before the first game it is the whole season's
-- projection and on the last day it is what happened.
ALTER TABLE player_projection
  ADD COLUMN IF NOT EXISTS rest_points double precision,
  ADD COLUMN IF NOT EXISTS rest_games integer;
