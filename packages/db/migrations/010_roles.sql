-- Roles govern the lineup: G / F / B replaces G / F / C.
--
-- Eligibility used to come from the six-way scoring archetype the model
-- weights against — `lead`/`combo`/`wing`/`swing`/`big` — which is why the
-- slot named for a big was called `C`. That archetype cannot represent a Wing
-- G (guard and forward) or a PF/C (forward and big) as anything but one thing,
-- so it produced two rules nobody would choose: a Stretch 4 could start at
-- centre and a pure centre could start at forward. Eligibility now comes
-- straight from Torvik's own `role` string — see
-- `packages/league/src/slots.ts` — and the slot is renamed to match what it
-- actually is.
--
-- No new tables: this is a rename, everywhere the old letter was written.

UPDATE lineup_entry SET slot = 'B' WHERE slot = 'C';

-- `league.settings` is jsonb with no per-column shape, so the rename has to
-- reach into the `starters` array by hand rather than through an ALTER TABLE.
-- Every league's settings holds a full `starters` array — `create` seeds one
-- from DEFAULT_SETTINGS and `updateSettings` always writes the whole merged
-- object back — so this is a rewrite of what is already there, not a backfill
-- of something missing.
UPDATE league
   SET settings = jsonb_set(
         settings, '{starters}',
         (SELECT jsonb_agg(
                    CASE WHEN elem->>'slot' = 'C'
                         THEN jsonb_set(elem, '{slot}', '"B"')
                         ELSE elem END)
            FROM jsonb_array_elements(settings->'starters') elem))
 WHERE settings ? 'starters';
