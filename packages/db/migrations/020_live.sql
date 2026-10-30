-- Live scoring: what a game still being played is worth, before the morning
-- feed files its valAdj.
--
-- The forward model scores a game as valAdj (Data/Scripts/forward_model/
-- schedule.py value_adj): the box weights on the line, plus the opponent's
-- defence by the player's share of possessions, less the program terms at his
-- own school. The line and the possessions come from the live box score; the
-- rest is this morning's refit, sent on the feed as `live`, and kept here per
-- feed day so tonight's games are scored with the ratings the morning valAdj
-- will use.
--
-- Nothing here is ever settled on. The number it yields is provisional and is
-- replaced by the stored player_game_score the next morning.

CREATE TABLE IF NOT EXISTS forward_live_params (
  season        integer NOT NULL,
  as_of         date NOT NULL,
  -- box weights, oppDefK, levelK, levelRef, teamW, ftPoss, worstDef
  params        jsonb NOT NULL,
  PRIMARY KEY (season, as_of)
);

CREATE TABLE IF NOT EXISTS forward_team_rating (
  team_id       bigint NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  as_of         date NOT NULL,
  def           double precision,
  net           double precision,
  PRIMARY KEY (team_id, as_of)
);
