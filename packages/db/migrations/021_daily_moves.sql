-- Daily roster moves for 'everyone' leagues, capped at three adds a week.
--
-- 1. `fielded` counts a game for the team that held the player at its
--    tip-off, not at the week's Sunday lock. A team can play a man on
--    Monday, drop him after the game with Monday's points kept, and play the
--    player it picked up on Tuesday. A game with no tip-off time yet locks at
--    the waiver hour (09:00 UTC, 4am Eastern) on its date, the same dead band
--    migration 005 picked for the game date.
--
--    The rule needs nothing from `matchup` any more, so a game is fielded
--    whether or not a period covers it; settlement still reads only a
--    period's dates.
--
-- 2. Those leagues stop using waivers. `weeklyAdds` (3) caps free-agent adds
--    per team per week instead, and a dropped player is a free agent at once,
--    so the wire is emptied and any bids still sealed are cancelled.
--
-- The manual branch is unchanged.

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
  CROSS JOIN LATERAL (
    SELECT coalesce(g.tipoff,
             (g.played_on::timestamp
               + make_interval(hours => coalesce((lg.settings->>'waiverHour')::int, 9)))
             AT TIME ZONE 'UTC') AS locked_at
  ) w
 WHERE coalesce(r.acquired_at, r.acquired_on::timestamp AT TIME ZONE 'UTC') <= w.locked_at
   AND (r.released_at IS NULL OR r.released_at > w.locked_at)
   AND (r.released_on IS NULL OR r.released_at IS NOT NULL OR r.released_on > g.played_on)
 ORDER BY r.fantasy_team_id, g.played_on, r.player_id, g.tipoff NULLS LAST
) everyone;

UPDATE league SET settings = settings || '{"weeklyAdds": 3}'::jsonb
 WHERE settings->>'lineupMode' = 'everyone' AND NOT settings ? 'weeklyAdds';

DELETE FROM waiver_wire w USING league lg
 WHERE lg.id = w.league_id AND lg.settings->>'lineupMode' = 'everyone';

UPDATE waiver_claim c SET status = 'cancelled', settled_at = now(),
       reason = 'waivers were replaced by three adds a week'
  FROM league lg
 WHERE lg.id = c.league_id AND lg.settings->>'lineupMode' = 'everyone'
   AND c.status = 'pending';
