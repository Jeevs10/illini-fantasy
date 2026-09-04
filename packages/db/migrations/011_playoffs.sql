-- Playoffs. A playoff matchup is a matchup.
--
-- `scorePeriod` is already date-ranged and knows nothing about the regular
-- season, so extending `matchup` rather than forking a `playoff_matchup` table
-- means the scorebug, /league, /home, periodOutlook and settlement all work on
-- a bracket unchanged.

ALTER TABLE matchup
  -- NULL means regular season. Everything that reads standings has to say so.
  ADD COLUMN round text,
  ADD COLUMN bracket text,
  -- Position within (league_id, round, bracket), 1-based, left to right — how
  -- "QF1" and "QF2" are told apart.
  ADD COLUMN seq integer,
  ADD COLUMN home_seed integer,
  ADD COLUMN away_seed integer,
  -- Where a side comes from, when it is not a fixed seed: the match whose
  -- winner or loser fills this slot. Self-referencing, the same choice
  -- draft_pick's "who picks 47th" makes — a pointer to read rather than a
  -- bracket-position calculation repeated in the settler and the screen.
  ADD COLUMN home_from bigint REFERENCES matchup(id),
  ADD COLUMN away_from bigint REFERENCES matchup(id),
  ADD COLUMN home_from_result text,
  ADD COLUMN away_from_result text,
  -- Which side advances. Stored rather than derived from the points, so a tie
  -- broken by seed or by regular-season points is decided once, at settlement,
  -- and every screen that reads the bracket agrees with it by construction
  -- rather than by repeating the tiebreak rule.
  ADD COLUMN winner text,
  ADD CONSTRAINT matchup_winner_ck CHECK (winner IN ('home', 'away')),
  ADD CONSTRAINT matchup_bracket_ck CHECK (bracket IN ('winners', 'consolation', 'third')),
  ADD CONSTRAINT matchup_from_result_ck CHECK (
    home_from_result IN ('winner', 'loser') AND away_from_result IN ('winner', 'loser')
    OR home_from_result IS NULL AND away_from_result IS NULL
  );

-- A playoff match is materialised before both teams are known — the winner of
-- a semi-final is a row before the semi-final is played. `006_draft.sql` makes
-- the identical choice for a draft pick's player_id.
ALTER TABLE matchup ALTER COLUMN home_team_id DROP NOT NULL;
ALTER TABLE matchup ALTER COLUMN away_team_id DROP NOT NULL;

-- The regular season's uniqueness rule named a team twice; a bracket names a
-- round and a seat in it instead.
ALTER TABLE matchup DROP CONSTRAINT matchup_league_id_week_home_team_id_key;
CREATE UNIQUE INDEX matchup_regular_season_idx
  ON matchup (league_id, week, home_team_id) WHERE round IS NULL;
CREATE UNIQUE INDEX matchup_bracket_slot_idx
  ON matchup (league_id, round, bracket, seq) WHERE round IS NOT NULL;
