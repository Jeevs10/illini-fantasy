-- A school's slug on the Data repo's site (illini-prospect-analyzer.org/teams/<slug>).
--
-- The forward feed names every player's school by both its CBBD id and the
-- Data repo's own slug, and the two sites spell schools differently ("St.
-- John's" is `st-john-s` there and `st johns` here), so the slug cannot be
-- derived from our name. It is stored as the feed sends it, and a school the
-- feed has not named yet simply has no link.

ALTER TABLE team ADD COLUMN IF NOT EXISTS forward_slug text;
