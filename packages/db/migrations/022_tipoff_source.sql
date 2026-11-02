-- Where a game's tip-off came from.
--
-- CBBD is the schedule of record, but it lists most early-season games with
-- startTimeTbd and a midnight-Eastern placeholder for a start. Read as a real
-- time, that placeholder filed Monday's games under Sunday night and showed
-- every one at 12:00 AM. The feed now marks those games `tbd` and sends no
-- time for them; ESPN's scoreboard fills it (ingest/tipoffs.ts).
--
-- 'cbbd' is a time CBBD gave, 'espn' one ESPN filled for a game CBBD has as
-- TBD. The morning feed keeps an ESPN time until CBBD sends one of its own,
-- instead of clearing it every day. Rows written before this are CBBD's.

ALTER TABLE game ADD COLUMN IF NOT EXISTS tipoff_source text
  CHECK (tipoff_source IN ('cbbd', 'espn'));
