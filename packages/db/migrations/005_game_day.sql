-- Re-date games onto the day they were played, not the day UTC filed them.
--
-- A 9pm Eastern tip is already tomorrow in UTC, so storing the UTC date put
-- 158 of the first 280 ingested games a day late. It went unnoticed while
-- lineups were derived from box scores, which carry Torvik's local game date;
-- it surfaces the moment the schedule is joined instead, which is what setting
-- a lineup before tip-off requires.
--
-- 09:00 UTC is the boundary — 4am Eastern, 1am Pacific. Observed tip-offs run
-- 16:00 to 05:00 UTC, so the empty band has hours of margin at both ends.

UPDATE game SET played_on = (tipoff - interval '9 hours')::date
 WHERE tipoff IS NOT NULL AND played_on <> (tipoff - interval '9 hours')::date;
