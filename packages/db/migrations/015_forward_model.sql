-- The 2026-27 league: scored on the Data repo's forward model, every rostered
-- player counting, roster moves taking effect at the next weekly lock.
--
-- Four additions.
--
-- 1. `forward` as a source. A player's forward-model key (the Data repo's
--    playerid — positive for players with a D1 season, negative for the
--    newcomers it minted ids for) is his identity in the feed, so it is
--    stored where every other source's id is: player_source_id.
--
-- 2. player_projection: the projected Player Score the draft is ordered by,
--    one row per player per season per feed day, so the draft board can be
--    read as it stood on draft night after the projection has moved.
--
-- 3. Roster tenures get the instant they opened and closed, and whether they
--    are on injured reserve. The dates stay — every existing reader keys on
--    them — but a weekly lock is a moment, not a day: a free agent added on
--    Sunday afternoon must miss the week that locked at 4am that morning,
--    and a date cannot say which side of the lock he landed on.
--
-- 4. `fielded`: who a team fielded on a night, for both kinds of league. A
--    manual league's answer is its lineup_entry rows, unchanged. An
--    'everyone' league has no lineup to set — its answer is every player it
--    held at the lock that opened the period, on every night his school
--    plays inside it, IR tenures marked IR so nothing scores them. One
--    definition, read by settlement and every screen, so a period cannot be
--    scored one way and shown another.

ALTER TYPE source_kind ADD VALUE IF NOT EXISTS 'forward';

CREATE TABLE IF NOT EXISTS player_projection (
  player_id     bigint NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  season        integer NOT NULL,
  as_of         date NOT NULL,
  score         double precision NOT NULL,
  score_lo      double precision,
  score_hi      double precision,
  mpg           double precision,
  value_rank    integer,
  status        text,
  PRIMARY KEY (player_id, season, as_of)
);
CREATE INDEX IF NOT EXISTS player_projection_season_idx
  ON player_projection (season, as_of, score DESC);

ALTER TABLE roster_slot
  ADD COLUMN IF NOT EXISTS acquired_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS reserve boolean NOT NULL DEFAULT false;

-- New tenures stamp themselves; old ones read as opening at the start of the
-- day they were dated, which is what every reader already assumed.
ALTER TABLE roster_slot ALTER COLUMN acquired_at SET DEFAULT now();

CREATE OR REPLACE VIEW fielded AS
SELECT l.fantasy_team_id, l.played_on, l.player_id, l.slot, l.game_id
  FROM lineup_entry l
  JOIN fantasy_team ft ON ft.id = l.fantasy_team_id
  JOIN league lg ON lg.id = ft.league_id
 WHERE coalesce(lg.settings->>'lineupMode', 'manual') <> 'everyone'
UNION ALL
SELECT * FROM (
SELECT DISTINCT ON (r.fantasy_team_id, g.played_on, r.player_id)
       r.fantasy_team_id, g.played_on, r.player_id,
       CASE WHEN r.reserve THEN 'IR' ELSE 'FLEX' END AS slot, g.id AS game_id
  FROM roster_slot r
  JOIN league lg ON lg.id = r.league_id AND lg.settings->>'lineupMode' = 'everyone'
  JOIN player p ON p.id = r.player_id
  JOIN game g ON (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
             AND g.season = lg.season
  JOIN LATERAL (
    -- The period a night falls in, and the instant it locked: the period's
    -- first day at the waiver hour, UTC — the same moment the week's bids
    -- open, so a claim won at that run is in and a move after it is not.
    SELECT ((m.starts_on + ((g.played_on - m.starts_on)
                / coalesce((lg.settings->>'periodDays')::int, 7))
                * coalesce((lg.settings->>'periodDays')::int, 7))::timestamp
            + make_interval(hours => coalesce((lg.settings->>'waiverHour')::int, 9)))
           AT TIME ZONE 'UTC' AS locked_at
      FROM matchup m
     WHERE m.league_id = lg.id AND g.played_on BETWEEN m.starts_on AND m.ends_on
     LIMIT 1
  ) w ON true
 WHERE coalesce(r.acquired_at, r.acquired_on::timestamp AT TIME ZONE 'UTC') <= w.locked_at
   AND (r.released_at IS NULL OR r.released_at > w.locked_at)
   AND (r.released_on IS NULL OR r.released_at IS NOT NULL OR r.released_on > g.played_on)
 ORDER BY r.fantasy_team_id, g.played_on, r.player_id, g.tipoff NULLS LAST
) everyone;
