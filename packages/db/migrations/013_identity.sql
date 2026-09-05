-- Team identity. ESPN's public teams endpoint carries a school's colours and
-- abbreviation for free — `source_kind` already lists 'espn' and `game.espn_id`
-- already exists, so this is an anticipated source, not a new dependency.
-- Nullable throughout: a school ESPN does not carry (or that this crosswalk
-- cannot match by name) simply shows no colour, the same "absence over a
-- guess" rule `player_availability` already follows.
ALTER TABLE team
  ADD COLUMN primary_color text,
  ADD COLUMN secondary_color text,
  ADD COLUMN abbreviation text;
