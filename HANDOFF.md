# Handoff — Phase 10, the stat surface

Phases 1 through 10 are done. The README is the reference for how the system
works; this file is only what the next person needs that the README does not
say.

## State

| | |
|---|---|
| Branch | `phase-1-scoring-model` — misnamed, carries Phases 1 through 10 |
| Tests | 180 passing (`npm test`, needs local Postgres — see README) |
| Typecheck | clean (`npm run typecheck`, and `npx tsc --noEmit` inside `apps/web`) |
| Build | clean (`npm run build`) |
| Production data | Neon `floral-shape-81709658`, 5 ingested game days, Feb 10–14 2026 |
| Full season | Neon branch `full-season-2026`, 147 game days, 113,860 player-games — **not yet migrated to 012 or re-ingested for the box/bio widening; see below** |
| Leagues | 1 `Illini Fantasy` (Phases 2–3, seeded rosters) · 2 `Draft Night` (Phase 4, really drafted) · 4 `Illini Fantasy — 2025-26` (branch only, drafted and played out) |

**Phase 10 adds migration `012_leaders.sql`, and widens ingest.** `player`
gains bio columns (`height`, `jersey`, `weight`, `hometown`, `date_of_birth`)
and a `class_year` backfill — that last column existed since Phase 2 and had
never actually been populated by anything. A new `player_rank` table holds a
season-to-date total and rank, overall and by role, as of every played day;
`npm run ingest -- ranks <season>` rebuilds it wholesale from
`player_game_score` with window functions, no Torvik call, safe to re-run.
`toBoxScore`/`toBio` in `packages/sources/src/adapt.ts` read fields Torvik's
pslice already returned and `toPlayerLine` dropped — steals, blocks, the
rebound split, makes — into a `box` sub-object stored *beside* the model
input in `player_game_stat.stats`, never inside `PlayerLine`, so the scorer's
input shape (and therefore parity) cannot drift; `npm run parity` and `npm
run backtest` both reproduce their documented baselines exactly after the
change. One correction to the plan this phase started from: Torvik's pslice
column 34 looked like a recruit rank (`COL.recRank`) but checked against live
data holds a fractional rate stat instead — `getadvstats`' CSV inserts
hometown/weight at columns 33–34 that pslice does not carry, and "recRank"
was a leftover label from that shape. No `recruit_rank` column was added;
a real one exists on CBBD's `recruits()` endpoint for a later pass. The
shooting and advanced-metric groups on the player card (`effectiveFieldGoalPct`,
`bpm`, `usage`, and the rest) needed no ingest change at all — every
`PlayerLine` field has been stored in `stats jsonb` since Phase 2, just never
read back.

**Migration 012 has been run and verified locally only** — against
throwaway databases and a from-scratch local season (two weeks, real
Torvik/CBBD data from cache, a drafted 10-team league) — never against the
`full-season-2026` Neon branch or production. Running it there, then
`npm run ingest -- range <season> <start> <end>` (from cache) and
`npm run ingest -- ranks <season>`, is the same three-command rebuild
`full-season-2026` has always used; nobody with Neon credentials has done it
yet.

**Phase 9 adds migration `011_playoffs.sql`.** A playoff matchup is a
matchup — `matchup` gains `round`/`bracket`/`seq`, `home_seed`/`away_seed`,
the self-referencing `home_from`/`away_from` pointer pair with their
`_result` columns, and a `winner` column, and `home_team_id`/`away_team_id`
drop `NOT NULL` so a round can be a row before both of its teams are known.
The old `(league_id, week, home_team_id)` uniqueness becomes a partial index,
`WHERE round IS NULL`, alongside a new one for a bracket slot,
`(league_id, round, bracket, seq) WHERE round IS NOT NULL` — a bracket names
a round and a seat in it rather than a team. `generateSchedule`'s own
`ON CONFLICT` had to start repeating the `WHERE round IS NULL` clause, since
Postgres needs it to infer which partial index a conflict target means.

**Phase 8 adds migration `010_roles.sql`.** It renames the `C` slot to `B`
everywhere it is written down: `lineup_entry.slot`, and the `starters` array
inside every league's `settings` jsonb. Additive-safe and re-runnable — a
league already at `B` is left alone.

**Phase 7 needs no migration.** `league.settings` is jsonb and every reader
merges it over `DEFAULT_SETTINGS`, so `tradeDeadline` is a new key rather than a
new column and a league that has never heard of it reads `null`. The screen
still needs 007 and 008 on the branch it runs against, because
`settingsContext` counts sealed claims and live offers.

**Migrations 007 through 012 are not on the production branch.** Production is
still at 006, so `/waivers` and `/trades` both fail against it — and now so does
signing in, since `app_user.username` does not exist there yet. Phase 5 was
exercised on the Neon branch `phase-5-waivers` (`br-restless-glade-axer0kym`), a
copy of production with 007 applied; that branch has none of 008 through 012.
Migrating production is the owner's call and has deliberately not been made.

009 is not additive-only. It drops `auth_account`, `auth_verification_token` and
the `email_verified` / `image` columns, and empties `auth_session` — every
session that exists was minted by Auth.js and lives in a cookie by a name
nothing reads any more. **Whoever runs it against production signs everybody
out, and nobody can sign back in until they have a password**, which means
running `npm run league -- passwd <username> <password>` for each of the three
existing users and telling them what it is. The username backfill is automatic:
the local part of the address, numbered on collision (`commish`, `manager.two`,
`new.manager`).

`npm test` and the web app are separate: the root tsconfig excludes `apps/**`,
so `npm run typecheck` covers the packages and `npx tsc --noEmit` inside
`apps/web` covers the app.

## The full season lives on a Neon branch

Production still holds five ingested days, Feb 10–14 2026, because that is all
the ingest was ever run for. Nothing in the schema or the scoring is bounded by
it — `scripts/ingest.ts` takes one day at a time and only five were asked for.

The whole 2025-26 season is now on the Neon branch **`full-season-2026`**
(`br-little-river-axpodv84`), which is a copy of production migrated to 009. It
carries the source tables for every game day of the season and a league,
`Illini Fantasy — 2025-26`, that was drafted from the full pool and played out.

To work against it, export both URLs — `scripts/env.ts` fills gaps rather than
overriding, and the CLI prefers the unpooled one, so exporting only
`DATABASE_URL` leaves `.env.local` supplying production:

```sh
export DATABASE_URL="postgresql://neondb_owner:...@ep-curly-frog-ax7nyboz-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require"
export DATABASE_URL_UNPOOLED="${DATABASE_URL/-pooler/}"
```

Rebuilding it from nothing is three commands and about half an hour, nearly all
of it Torvik's 900 ms throttle:

```sh
npm run ingest -- setup 2026
npm run ingest -- range 2026 20251101 20260408
npm run season
```

`npm run season -- --drop` removes the league without touching the source data,
which is the split migration `001_sources` / `003_league` exists to allow.

Three things about it that are decisions rather than accidents:

- **The draft is an auto-draft, so it ranks by season-total Player-Score.**
  That is hindsight — nobody in November knows the March totals. It is the right
  hindsight here, because the league exists to show what a full roster of real
  players scores, not to simulate draft-day ignorance. If you want a blind
  draft, `autoDraft` is the wrong tool and the fix is a config cut off at the
  draft date.
- **Auto-fill runs as of midnight UTC on each night.** Nothing tips before
  16:00 UTC, so at midnight no game is locked. Running it against the real
  clock instead would find every game already tipped off, freeze every roster
  on the bench, and settle a season of zeroes — the lineup lock working exactly
  as designed, against a season that is entirely in the past.
- **The two existing leagues are untouched.** `createDraft` refuses a league
  that already has rostered players, so the season is a third league beside
  `Illini Fantasy` and `Draft Night`, with the same members and owners copied
  across so the same three accounts can see it in the picker.

## Start here

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"   # system node is broken
npm install
ILLINI_TODAY=2026-02-14 ILLINI_NOW=2026-02-14T18:30:00Z npm run dev
```

**Without those two env vars the app looks finished and is inert.** The data is
February 2026; against the real clock every game has tipped off, so every
lineup is correctly frozen and the only interactive control on the site never
renders. This cost real time to diagnose once already.

That command runs against whatever `.env.local` points at, which is production
— and production has no `username` column, so sign-in fails there. To click
through the app, run it against a local copy instead:

```sh
pg_dump --no-owner --no-privileges -f prod.sql "$DATABASE_URL_UNPOOLED"
psql "$ADMIN" -c 'CREATE DATABASE illini_local'
psql "postgresql://postgres:dev@localhost:55432/illini_local" -f prod.sql

export DATABASE_URL=postgresql://postgres:dev@localhost:55432/illini_local
export DATABASE_URL_UNPOOLED=$DATABASE_URL        # both, or scripts hit production
npm run migrate                                   # applies 007, 008, 009
npm run league -- passwd commish illini2026       # and manager.two, new.manager
```

**Export both URLs.** `scripts/env.ts` fills gaps rather than overriding and the
CLI prefers `DATABASE_URL_UNPOOLED`, so exporting only `DATABASE_URL` leaves
`.env.local` supplying the unpooled Neon URL and the script runs against
production.

`AUTH_URL` no longer affects sign-in — only the invite link `/commissioner`
prints. Set it to the port you are actually on or the commissioner copies a link
to a dead port.

## How Phase 8 was verified

- **`slots.test.ts` is new**: every one of the eight Torvik role strings against
  all six slots, the null/unrecognised case, a Wing G and a PF/C confirmed to
  cover two slots each, `validateLineup`'s messages, and `autoFill` seating the
  scarcest roles first while benching a role it does not recognise to FLEX.
  `lineups.test.ts` and `draft.test.ts` were updated for `B` rather than `C` —
  the draft fixture in particular had to start seeding real role strings
  (`Pure PG` / `Wing F` / `C`) rather than a single literal `'Wing F'` for
  every player, since eligibility no longer reads the archetype it used to.
  159 tests, unchanged in count from Phase 7 — four archetype-eligibility
  tests in `league.test.ts` were retired in favour of `slots.test.ts`'s more
  thorough coverage of the same ground, and five were added there.
- **The migration was run against a local restore of production** (`illini_local`,
  migrated through 010) and checked directly: every `lineup_entry.slot = 'C'`
  became `'B'`, and every league's `settings->'starters'` array had its `C`
  entry rewritten to `B` with the count preserved, `jsonb`-array-order and all.
- **The screens were driven in a browser** against that same local restore,
  serving the production build on port 3021 with `ILLINI_TODAY`/`ILLINI_NOW`
  pinned to the loaded data. `/players`: the glossary discloses the three
  vocabularies mapped to each other, and the `All / G / F / B` chips filter the
  pool correctly (`B` showed only `PF/C` and `C` roles). `/team`: the roster
  header reads `2G · 2F · 1B · 2FLEX`, a `PF/C` player sits in the `B` slot
  wearing an `F · B` tag, and the move dropdown offers `Start at B`. `/draft`:
  the pool, queue and board all show the new `RoleTag` in place of the old
  archetype pill, and the role chips filter the board there too.
- **A real draft was run to completion** against `illini_local`'s `Draft Night`
  league — 10 teams, 12 rounds, guard-heavy pool, autopicked to 120/120 — and
  every one of the ten resulting rosters was checked to hold at least one
  `PF/C`- or `C`-rostered player, which is exactly the "twelve guards, no big"
  failure the slot-aware autopick exists to prevent.
- **One bug the browser caught that the type checker and the test suite did
  not**: a plain closure (`roleHref: (role) => string`) passed from the
  `/draft` server component down into the `"use client"` `Pool` component. It
  type-checks — a function is a function — and only fails at runtime, with
  React error #441 the moment that code path actually renders, because a
  function cannot cross the server/client boundary unless it is a Server
  Action. The fix was the pattern the rest of this app already uses for
  exactly this reason (see `commissioner/settings/form.tsx`'s own comment
  about not importing values into client components): pre-build the hrefs on
  the server as plain strings and pass those down instead of a callback.
  The same reasoning ruled out importing `rolesFor` from `@illini/league`
  into `app/ui/bits.tsx` — a value import through that package's barrel
  reaches `draft.ts`, which reaches the Postgres driver, which does not exist
  in a browser. `RoleTag` and the glossary carry their own small copy of the
  role table instead; the eligibility it mirrors is still enforced once, in
  `slots.ts`, and only server-side.

Not checked: narrow widths and light mode, the same as every phase since 5.

## How Phase 9 was verified

- **`bracketShape` is pure and tested alone**
  (`packages/league/src/playoffs.test.ts`): the exact 4-team, 6-team and
  8-team shapes against the spec's own worked example (6 teams gives
  `QF1 4v5, QF2 3v6, SF1 1×winnerQF1, SF2 2×winnerQF2`), and that a
  third-place game only exists when both semi-finals were real matches
  rather than a bye straight to the final. 13 tests, 172 in the suite overall.
- **The database layer against a real Postgres**, the same pattern every
  phase since 4 follows: `createBracket` refuses a league without enough
  teams and a league whose target week is already settled, but not a week
  that merely holds unplayed round-robin fixtures — those are deleted and
  replaced, the same "refuse what is true, not what merely exists" rule
  `createDraft` applies to a league that already has teams. `settlePlayoffs`
  was driven through a full six-team, third-place bracket across three
  settle calls (QF, then SF, then F-and-third), checking the board after
  each one and confirming a re-run changes nothing. `reseed` was checked
  against a deliberate upset: without it the final is fixed to the original
  bracket pointers; with it, the final re-pairs by the two survivors'
  seeds, best against worst. A consolation bracket for the teams that missed
  the cut was checked to land in the same week as the championship. And a
  settled playoff round was checked to leave the regular-season `standings`
  and `rankedStandings` untouched — the reason both now read `round IS NULL`.
- **The whole path exercised end to end from the CLI** against a from-scratch
  local database seeded with five real weeks of the 2025-26 season (ingested
  from Torvik, cached, one API call): `league create`, a full auto-draft,
  lineups and settlement for every day and week, `league settings
  playoffTeams=4 playoffStartWeek=6 thirdPlace=on`, `league bracket` to draw
  it, and `league picture` for the cut line — the same commands and output
  reproduced in the "Start here" section's demo below.
- **The screens were driven in a browser** against that same database,
  serving the production build. `/playoffs` with no bracket yet: the cut
  line drawn under the fourth of six teams, everyone `Alive` in week one, and
  the commissioner's "Draw the bracket" button. After drawing: the bracket as
  columns of round cards with a dashed connector rule between them, the
  winning side of a settled match highlighted, seed numbers, and the
  third-place game correctly in its own panel rather than folded into the
  winners bracket — the one bug this exercise caught (see below). A separate
  three-team league was drawn to check the bye case specifically: seed 1
  seeded straight into the final against a `TBD` opponent, rendered with the
  same fallback avatar the rest of the app uses for an unknown name.
- **One bug the browser caught that the tests, as first written, did not**:
  `materialiseBracket` tagged every row of the winners shape — including the
  third-place game — with `bracket = 'winners'`, so the third-place match sat
  invisibly inside the "Winners bracket" panel instead of its own. The tests
  had asserted the *pairing* (home/away team ids) but never the `bracket`
  column, so they passed against the same bug the screen made obvious in one
  glance. Fixed by giving the `"3rd"` round its own `bracket = 'third'` at
  insert time regardless of which shape it came from, with a test added that
  checks the column directly.

Not checked: narrow widths and light mode, and no worker settles a round on
its own — the same "settle on read" trade every phase since 5 makes, so a
finished round only advances the bracket once somebody opens `/playoffs` (or
runs `league playoffs`) after it ends. Also not done: the games cap's
`SETTING_FIELDS` infrastructure was reused for the three numeric playoff
settings (`playoffTeams`, `playoffStartWeek`, `playoffRoundWeeks`), so they
already have a form row on `/commissioner/settings`; the three
boolean/enum ones (`thirdPlace`, `consolation`, `reseed`, `playoffTiebreak`)
are readable and settable from the CLI and are validated by
`settingsProblems`, but have no widget on that screen yet — a checkbox row
and a select, not a new pattern.

## How Phase 10 was verified

- **`leaders.test.ts` is new**: `packages/league/src/leaders.test.ts`, following
  `playoffs.test.ts`'s drop/recreate-database convention. Covers
  `topPerformances`' ordering and its role filter (expanded to Torvik's own
  role strings, same as `playerPool`'s), `trendingPlayers`' counts off the
  transaction log, `playerRankTrend` against a hand-built three-day sequence,
  `playerWeekProjection` against a checkable average (and zero for a player
  with no history), and `statPercentiles`' ranking direction. 180 tests,
  up from 172.
- **The ingest widening was checked against real Torvik data, not just
  types**: a from-scratch local database, `setup` + `range` for two real
  weeks of 2025-11 (from `.cache/`), confirmed `player.height`/`jersey`/
  `class_year` populated for all 421 players ingested on the first night and
  `player_game_stat.stats->'box'` carrying steals/blocks/rebounds/makes for
  every row. `npm run ingest -- ranks` was run twice in a row and left
  `player_rank` at the same row count both times.
- **`npm run parity` and `npm run backtest` were re-run after the widening**
  and reproduce the README's own documented numbers exactly (parity p50
  0.173, 98.3% within 2.0; backtest's 1.33x archetype spread and r = 0.540) —
  proof the `box`/bio additions never touched `PlayerLine`.
- **The screens were driven in a browser** against a fresh local season built
  for this (two weeks of 2025-11, a real 10-team snake draft, lineups set and
  settled): `/leaders` with the Day/Week/Month/Season segments and the
  `All/G/F/B` role chips, both driven by URL params with no client
  component, exactly like `/players`'; ownership correctly attributed to a
  drafted team next to unowned free agents in the same list. The player card:
  the bio line (school, conference, role, class, height, jersey number), the
  rank and role-rank tiles, a "next 7 days" projection tile that reads
  "0 games × N avg" for a player with nothing scheduled rather than hiding,
  the rank-trend chart (suppressed under 3 points, the same gate the existing
  sparkline uses under 4), and the three BOX/SHOOTING/ADVANCED tables with
  percentile bars against role peers. Checked deliberately against a
  low-minute free agent with only 2 games, to confirm every new section
  degrades sensibly rather than crashing on sparse data.
- **Narrow width was checked with the same-origin iframe trick at 390px**
  (`resize_window` is still non-functional — see below): no horizontal
  overflow on either `/leaders` or the player card, and the new "Leaders"
  destination correctly highlights in the mobile "More" sheet. Light mode was
  not opened; every new value in `charts.tsx` and the stat tables reads off
  an existing CSS custom property, never a literal color, the same
  covered-by-construction argument Phase 7 made.

Not done: migration 012 and the ingest widening have not been run against the
`full-season-2026` Neon branch or production — see the state table above.
`trendingPlayers` counts roster moves rather than splitting them into adds
and drops, because `transaction.kind` alone cannot always say which direction
a trade moved a player (`claimPlayer` and `releasePlayer` both write `kind =
'trade'`); inventing a split the log cannot support seemed worse than
reporting activity honestly. No CBBD-sourced recruit rank yet, either — see
the recRank note above. `/leaders`' role filter and segmented control have no
loading-state skeleton finer than the route's own `loading.tsx`, and the
"game-day leaders rail" from the original sketch became one ranked list
rather than a separate rail, since the ranked list already reads as a rail at
the Day span.

## How Phase 7 was verified

Production is three migrations behind, so the same route Phase 6 took:

- The module has 21 tests of its own (`packages/league/src/settings.test.ts`)
  against a throwaway local database, and the deadline adds 5 to
  `trades.test.ts` — 159 in the suite, up from 132.
- The CLI verbs were run end to end against a scratch local database
  (`illini_phase7`, dropped afterwards): reading the settings, setting several
  at once, each of the three refusals against real rosters and a real spend, the
  games-cap re-score against a settled week whose arithmetic is checkable by
  hand (four players scoring 1–4 a night for five nights: cap 9 → 32, cap 5 →
  20, cap 3 → 12), and the deadline — offered inside it, refused outside it,
  agreed on the deadline day and executed the day after, and a standing offer
  expired by the deadline rather than by neglect.
- The screens were driven in a browser against that same scratch database,
  serving the production build on port 3021. The refusal ("Nothing was saved."
  plus the reason, and no log row), a successful save (the receipt, the
  re-score note, the new log row), the live roster-limit arithmetic as the slots
  move, the standings agreeing with the cap afterwards, `/trades` showing the
  deadline in its meta and standing the propose form down once it passed, and
  the expired offer reading "the trade deadline passed".
- Narrow width was checked with the same-origin iframe trick at 390px and 768px
  (`resize_window` is still non-functional — see below): no horizontal overflow
  at either, `document.scrollWidth` equal to `innerWidth`, the field rows
  stacking and the log table wrapping.

Light mode was not opened, the same as Phases 5 and 6. The new CSS uses no
literal colour — every value is a token that is defined twice, on `:root` and
again under `prefers-color-scheme: dark` — so it is covered by construction
rather than by inspection.

Two bugs the exercise caught that the tests as first written did not:

- **Two clocks reached one offer and the wrong one claimed it.** An offer with
  three days to run and a deadline a day away was reported as "nobody answered
  before it expired", dated two days after the deadline had already killed it.
  The expiry passes now run deadline-first, bounded to offers that were still
  alive when the deadline arrived. There is a test for it.
- **`.notice` is a flex row.** A `<strong>` between two text fragments becomes
  three flex items with `gap` between them, so the sentence acquired gaps and an
  orphaned full stop as soon as it wrapped. Every other notice in the app has a
  single text child, which is why nothing had shown it before. Wrap the sentence
  in one `<span>`.

## How Phase 6 was verified

The app could not be exercised against production, which is two migrations
behind, so:

- The module has 13 tests of its own (`packages/league/src/trades.test.ts`),
  against a throwaway local database, the same way waivers and the draft do.
- The CLI verbs were run end to end against a scratch local database — offer,
  accept, the window, execution dated to its own moment, veto, expiry, the
  transaction log — and the database was dropped afterwards.
- The screens were driven in a browser against that same scratch database,
  serving the production build (`npx next start --port 3005`) rather than
  `next dev`, because two dev servers for this project were already running and
  Next refuses a second. Propose, send, accept, review, veto and the settled
  history all render and act correctly in dark mode at desktop width.

Not checked in a browser: narrow widths (`resize_window` is still
non-functional here — see below) and light mode.

## How password sign-in was verified

Against a full copy of production restored locally (`illini_local`), migrated to
009, serving the production build on port 3006 — `next dev` refuses a second
server for this directory and one was already running on 3002.

- 17 tests in `packages/league/src/accounts.test.ts`: salting, the cost
  parameters in the stored string, junk hashes verifying nothing, the username
  and password rules, adopting a commissioner-made seat rather than duplicating
  it, both `AccountTaken` cases, the derived-username collision, reset, change,
  rename, and the CHECK constraint refusing what the module would have.
- In a browser: wrong password (one sentence, username kept, password cleared),
  right password, the commissioner screen, creating an invite, signing out,
  redeeming the link as a new manager — including a first attempt with a taken
  username, which reported it and left the invite live — and signing back in
  with the credentials just chosen, in mixed case.
- One bug the tests caught before the browser did: registering against a seat
  the commissioner had already named overwrote their display name with the
  local part of their address.

Not checked: narrow widths and light mode, same as Phase 6.

## Where it stopped

Done through Phase 10: the stat surface. A league now has an ending (Phase 9)
and a player card that explains more than the score alone — a rank, a
projection, season averages against role peers, and a `/leaders` screen for
who has been best lately (Phase 10). Phases 11 and 12, written up below, are
the rest of the plan (injuries and news, and a retrofit of the five older
screens) and were deliberately not started this round.

Not done, in the order I would take them:

1. **Injuries and news, and the retrofit of `/home`, `/team`, `/league`,
   `/standings`, `/players`** — see Phases 11 and 12 below, and
   `.impeccable/critique/` for the persisted snapshot, which `/polish` reads
   automatically. The critique predates `/commissioner`, `/draft`,
   `/waivers`, `/trades`, `/commissioner/settings`, `/playoffs` and
   `/leaders`, so its heuristic scores cover none of them.
2. **Migration 012 and the ingest widening on `full-season-2026` and
   production.** Verified locally only — see "How Phase 10 was verified"
   above. The rebuild is the same three commands the branch has always used;
   somebody with Neon credentials has to run them.
3. **Settings that vary by week.** The games cap re-scores history because there
   is one settings blob and no way to say "nine until week 6, eight after". That
   is the honest fix and it is a real phase: `matchup` would have to carry the
   settings it settled under, the way `player_game_score` carries its config.
   The re-score is the right behaviour *given one blob*, and it is worth knowing
   it is a consequence of that rather than a preference. The same gap now
   applies to the playoff settings a bracket is drawn under.
4. **A settings screen for a manager.** Everything on `/commissioner/settings`
   is the commissioner's. A manager cannot change their own password or username
   from any screen, and that is the same shape of gap the league settings were
   until now — `changePassword` and `setUsername` exist and are tested with
   nothing calling them.

Smaller gaps from Phase 10. No CBBD-sourced recruit rank — see the recRank
correction above. `trendingPlayers` reports roster-move activity rather than
a true add/drop split, for the reason given in "How Phase 10 was verified".
`linkCbbdRosters` still discards `weight`/`hometown`/`dateOfBirth`, which the
012 migration already has columns for — threading them through is the
"separately" note the original plan left. And nothing runs `npm run ingest
-- ranks` on its own; like every other settle-on-read job in this app it
needs a caller, but unlike those it currently has none — the CLI verb is the
only way to refresh `player_rank` today.

Smaller gaps from Phase 9. `thirdPlace`, `consolation`, `reseed` and
`playoffTiebreak` are readable and settable from the CLI and validated the
same way every other setting is, but have no widget on
`/commissioner/settings` — a checkbox row and a select, not a new pattern; the
three numeric playoff settings already do, for free, off the existing
`SETTING_FIELDS` table. `/standings` does not draw the cut line or tag a
team's status — that lives only on `/playoffs`'s own picture panel, which is a
narrower version of what the original plan sketched. A
playoff round is scored under the same `gamesCap` as the regular season, which
is probably right but was never asked. And the bracket cannot be redrawn once
created, by design, so a wrong `playoffTeams` or `playoffStartWeek` discovered
after drawing means deleting the `round IS NOT NULL` rows by hand and drawing
again — there is no CLI verb for that undo.

Smaller gaps, from before. Settings: no way to add a slot the recognised roles
do not already cover. Trades: no counter-offer, so countering is a rejection plus a new
offer; nothing emails a manager who was offered a deal overnight; the
commissioner cannot force a trade through early, only stop it; a trade cannot
include FAAB dollars or draft picks, only players; and the deadline binds the
handshake rather than the execution, which is deliberate and is the thing
somebody will eventually argue about. Waivers: there is no
post-draft waiver period, so every undrafted player is addable outright from the
moment the draft ends; and nothing emails a manager whose claim was settled
overnight. The draft: no way to edit the order once drawn, no pick trading, and
snake or nothing. The commissioner surface: no way to rename or add a team from
the app, no way to change a member's role, and no resend — re-inviting an
address is the resend, which is correct but is labelled nowhere. Accounts: a
manager cannot change their own password or username from the app, only the
commissioner can reset one and only from the CLI (`changePassword` and
`setUsername` exist and are tested, with no screen calling either); there is no
rate limit on the sign-in form, which for a twenty-person private league is a
judgement rather than an oversight but is the first thing to add if the app ever
faces the open internet; and a session lasts thirty days with no sliding
renewal, since a server component cannot write cookies.

## The two leagues

`createDraft` refuses a league that already has rostered players — a draft deals
out an empty league — so one league cannot be both a finished season and a
drawn draft. There are two, and the masthead's league picker moves between
them:

| | |
|---|---|
| 1 `Illini Fantasy` | the finished season: 120 rostered, 361 lineups, 5 settled weeks. `/draft` here shows the refusal, correctly. |
| 2 `Draft Night` | an undrafted league with a scheduled 12-round, 60-second draft, waiting on Start. |

The picker is a cookie read by `who()`, and it is a *preference* rather than an
authorisation: the chosen league has to be one the viewer is actually a member
of, so a hand-edited cookie selects nothing rather than somebody else's data.

## The interface, rebuilt

The screens were redrawn on a new design system. Nothing about the schema, the
scoring, the settlement or the transaction rules changed; two read-only view
functions were added, and every screen was rewritten against them.

- **`/` now redirects to `/home`, not `/league`.** Home is a new screen and is
  the one that answers "how is my team doing" — the live matchup, tonight's
  slate, and a "Needs you" list built from state the app already knows (an
  unfilled slot somebody eligible could take, a benched game that has already
  tipped off, a standing trade offer, a sealed claim, an empty roster spot).
  `/league` is still the matchup screen and is now interleaved by rank with the
  games cap drawn across it as a line.
- **`packages/league/src/outlook.ts` is new and additive.** `periodOutlook`
  wraps `scorePeriod` with the games that have *not* been scored yet, so a week
  in progress can say how many players are on the floor and where it lands if
  form holds; `scoresOn`, `slateByDay` and `rankedStandings` are the same shape
  of thing. Nothing in it invents a number — a pending game's projection is the
  player's own average under the league's config, which is what auto-fill
  already ranks by. `scorePeriod` and `standings` are untouched, because
  settlement reads them.
- **`apps/web/app/ui/` holds the shared parts** — the scorebug, the player row,
  the avatar, the score, the glyphs, the skeletons. A screen that needs a new
  kind of row should get a variant there rather than a second idea of what a
  row is.
- **The masthead nav is desktop-only.** Below 860px there is a fixed bottom bar
  with four destinations and a sheet for the rest. `body > *` used to carry
  `position: relative`, which silently defeated `position: fixed` on all three
  — if a fixed element starts scrolling with the page, look there first.
- **The avatars are derived, not stored.** A hue from the team or player id and
  a monogram from the name. It is presentation, and it is the only thing that
  makes ten rows of "Team 4" scannable.
- Verified at 1440×900, 768×1024 and 390×844, in both colour schemes, against
  the production build as well as `next dev`: no horizontal overflow, no
  unlabelled controls, no console errors, and every text/background pair at
  4.5:1 or better.

## Things that will mislead you

- **Every path that closes a tenure owes `clearFutureLineups`, and closing one
  does not do it.** Lineups can be set for nights that have not happened, so a
  player who leaves a roster on Tuesday can still be in Thursday's starting five
  and would score for a team that no longer owns him. The rule now lives once,
  in `roster.ts` next to `releasePlayer`; waivers and trades both call it.
  `releasePlayer` on its own still does not.
- **A server action that changes what the layout renders must revalidate it.**
  Joining a league updates the viewer's name and, for a commissioner, their nav.
  Without `revalidatePath("/", "layout")` the client router replays the layout it
  cached a moment earlier, and the new manager lands on their team under the
  placeholder name the magic link gave them. The page data was correct; only the
  layout was stale, which is why it looked like a database problem.
- **The design detector reports clean and is blind here.** Its rules read
  computed styles; this project's values come from CSS custom properties it
  cannot resolve. A browser-overlay run found 24 findings the CLI could not see.
  Do not treat `detect.mjs` exit 0 as evidence of a clean surface.
- **`resize_window` is non-functional in this environment.** It reports success
  while `innerWidth` never changes. Responsive checks need a same-origin iframe.
- **Scores are versioned by the config that produced them.** Editing weights
  creates a new `scoring_config` row rather than mutating one that settled
  matchups reference. Never mutate a config in place.
- **The games cap is the one setting that rewrites history, and it does it on
  purpose.** `settings` is a single blob with no per-week version, so a week
  settled under a cap of nine is no longer the score the league plays by once
  the cap is eight — the standings read stored points and `/league` recomputes
  live, and the two would silently disagree. `updateSettings` re-scores every
  already-settled week in the same transaction, leaving `settled_at` alone. If
  you add a setting that changes what a settled score *is*, it belongs in that
  same branch; if you add one that only binds the future, it belongs in the
  notes instead. Getting that backwards is silent either way.
- **Everything in flight carries the rule it was created under, and that is not
  a bug.** `waiver_claim.runs_at`, `waiver_wire.clears_at`, `trade.expires_at`
  and `trade.executes_at` are all written at creation. Changing the waiver hour
  does not move a sealed bid; changing the review window does not move an agreed
  trade. That is the only reason a sealed bid can be sealed at all. The settings
  module reports each of these as a note rather than "fixing" it.
- **The trade deadline binds the handshake, not the execution.** A deal agreed
  on deadline day executes when its review window closes, which may be the day
  after. Rejecting an offer works after the deadline; accepting one does not.
  And two clocks can reach one offer — the deadline pass runs before the
  ordinary expiry and is bounded to offers that were still alive when the
  deadline arrived, so whichever got there first is the one that gets blamed.
- **A re-ingest must never touch league data.** That is why the migrations are
  split at `001_sources` / `003_league`, and why `player_game_stat` is only ever
  written by ingest and `player_game_score` only by scoring.
- **The draft does not use `ILLINI_NOW`. Waivers and trades do, and must.**
  This looks like an inconsistency and is not. A draft writes rosters dated by
  its own `opens_on`, so pinning its clock only stops the deadline passing —
  which is why the draft takes `new Date()` deliberately. A waiver claim and a
  trade both write *dated tenures* that are read back against the same pinned
  date the rest of the app browses, so on the wall clock a drop or a deal in a
  pinned February season is dated September and the players never change hands
  on any night you can see. `scripts/league.ts` honours `ILLINI_NOW` for the
  waiver and trade verbs and ignores it for the draft ones, for exactly this
  reason.
- **Nothing runs waivers, trades or the draft clock but a reader.** `/waivers`
  and `/players` call `settleWaivers` before they render; `/trades` calls
  `settleTrades`; an open draft room polls. If a batch, a window or a pick seems
  not to have resolved, the question is who last loaded one of those pages, not
  what crashed.
- **A trade executes inside its own savepoint, and needs to.** A deal that
  cannot be honoured must leave nothing behind — half of a two-for-one is two
  teams robbed — and a refusal from the ownership index is a Postgres error that
  aborts the whole transaction unless there is a point to roll back to. Any new
  code in `settleTrades` that writes before it is sure belongs inside that
  savepoint.
- **Three timezone bugs have been fixed in this codebase and they keep coming
  back in new forms:** the CBBD query window, the stored game date, and the
  browser-vs-server tip-off render. If something is off by a day or by hours,
  suspect this first.

## Open question for the owner

The 2026-27 season is still not loaded at CBBD (`npm run pool` reports
coverage). The draft pool currently comes from 2025-26 rosters plus an
incomplete NCAA CSV. Someone has to poll weekly and switch over when it
populates, or the draft board is built on last year's teams.

## Planned — Phases 10 through 12: a Sleeper-informed stat surface

Phase 10 is done; 11 and 12 are not started. Written up here so the plan does
not live only in a chat transcript. Renumbered from Phase 7 up, since Phase 7
was already taken by the settings screen and the trade deadline, and Phases 8
and 9 — below the state table above — have since taken roles and playoffs.

One gap remains of the three this plan was written against. The other two are
done. **Position shown as a scoring internal** is Phase 8: players used to be
labelled with the *archetype* the model weights against (`lead`, `combo`,
`wing`, `swing`, `big`), and roster slots were `G / F / C` with eligibility
derived from those archetypes — a Stretch 4 could start at centre and a pure
centre could start at forward, two rules nobody would choose. Eligibility now
comes from Torvik's own role string, and the slot is `B`. **The season has no
ending** is Phase 9, below and now done — a bracket seeded from the
regular-season table, byes for the top seeds, and settle-on-read propagation.

**The player card explains the score and nothing else.** Six blocks, the
opponent multiplier, the minutes ramp. No box line, no rank, no projection, no
news, and no way to ask who had the best night in the league last Tuesday.

The design critique at `.impeccable/critique/2026-09-03T17-01-12Z__apps-web.md`
(18/40, taken before `/commissioner`, `/draft`, `/waivers`, `/trades` and
`/commissioner/settings` existed) names the same things from the other
direction:

> Nothing about the interface is *college basketball*. No conference structure
> past a grey sub-label, no sense of a Saturday slate versus a dead Tuesday, and
> ten teams named "Team 1".."Team 10" with no logo, colour or manager name.

> Three position vocabularies run in parallel with no mapping: role ("Scoring
> PG"), archetype ("lead"), slot ("G").

That second finding is the P1 Phase 8 closed. So does the pool filter,
the sortable tables, and the archetype weights on the player card, below.
Where a phase closes a critique finding, it is marked **[critique]**.

Two decisions taken up front, of the three this section originally named —
the playoff shape shipped in Phase 9, below, as **settings a commissioner
sets** rather than a fixed default, since `/commissioner/settings` already
existed to hold exactly this kind of number by the time Phase 9 was taken:
injuries come from **RotoWire**, whose endpoint is already proven in this repo
(`scripts/crosswalk.ts`); ingest widens to carry the box line and **the season
is re-ingested**.

### Two findings, one from Phase 8 and one still ahead

**1. The archetype cannot carry the role — this is Phase 8, and it is done.**
`packages/league/src/slots.ts` is the result. Kept here because the mapping is
what the rest of this plan builds position handling on top of. It splits two
archetypes down the middle:

| Torvik `role` | archetype | new role |
|---|---|---|
| Pure PG | `lead` | G |
| Scoring PG | `lead` | G |
| Combo G | `combo` | **G** |
| Wing G | `combo` | **G · F** |
| Wing F | `wing` | F |
| Stretch 4 | `swing` | F |
| PF/C | `big` | **F · B** |
| C | `big` | **B** |

`combo` covers both Combo G (guard only) and Wing G (guard *and* forward);
`big` covers both PF/C (forward and big) and C (big only). The role must
derive from the **Torvik role string**, not the archetype. Checked against the
database: that string is stored twice — `player_game_stat.role` per game, and
`player.position`, which `resolveTorvikPlayers`
(`packages/ingest/src/players.ts:40`) writes from the Torvik role at player
creation. All 3,525 players have one, all eight values appear, and **no player
has ever changed role** — so latest-game-role with `player.position` as
fallback is correct and cheap.

`playerPool` used to pick the role with `max(st.role)` — alphabetical, so
arbitrary for anyone who ever changed role. Harmless while nothing read it for
eligibility; load-bearing once Phase 8 did, so it is most-recent-by-`played_on`
now, the same rule `rosterOn` and `startableOn` already used.

**2. The missing stats are missing only from storage.** Ingest writes
`stats = JSON.stringify(line)` where `line` is the model input
(`packages/ingest/src/nightly.ts:289`). Confirmed the 27 keys in the database:
MIN, PTS, REB, AST and eighteen rate stats plus `attempts` — **no steals, no
blocks, no rebound split, no shooting splits**. Torvik's pslice row already
carries every one (`COL.steals` 61, `blocks` 62, `offensiveRebounds` 57,
`defensiveRebounds` 58, `ftMade` 13, `twoMade` 16, `threeMade` 19) plus the bio
fields (`height` 26, `jersey` 27, `year` 25, `recRank` 34) — all dropped on the
floor in `toPlayerLine`.

The fix is a `box` sub-object written *beside* the model input rather than
into `PlayerLine`, so the scorer's input shape is untouched and parity cannot
drift. Then a re-ingest — safe and nearly free: Torvik responses are cached
under `.cache/`, `player_game_stat` is only ever written by ingest so no
league data is reachable, and the scoring config is unchanged so the same
`config_id` is reused and every score comes out identical (`npm run parity`
proves it).

Separately, `CbbdRosterPlayer` already returns `jersey`, `height`, `weight`,
`hometown` and `dateOfBirth`, and `linkCbbdRosters` discards all of it — that
is a bio strip from a source already fetched and cached.

### Design: what we take from Sleeper, and what we don't

Driven live in the browser against the owner's own Sleeper league — matchup,
league, players, trend, scores, and the player card. The finding is not
"Sleeper looks better"; it is that Sleeper is a **dense, chip-driven,
identity-rich** surface and this app is a **spacious editorial ledger**. The
token system here (Archivo on its width axis, live-green separated from
accent-orange, four surface levels) is not being reskinned. Specific
borrowings:

| Sleeper pattern | What we do | Where |
|---|---|---|
| Opposed pairs — your starter and theirs in one row, slot badge between | Rebuild `/league` as head-to-head-by-slot instead of interleaved-by-rank | `app/league/page.tsx` |
| Win probability per side, two-tone underline | Add to the scorebug beside the score, from settled totals + `periodOutlook` projections, labelled as a model | `app/ui/scorebug.tsx` |
| "Yet to play (n)" with the slot breakdown | `TeamOutlook.pending` already carries the slots | `app/ui/scorebug.tsx` |
| Dense filter/sort chip row | Role chips `All / G / F / B` — done, Phase 8. Still ahead: an `Avg \| Total \| Projected` sort toggle, week selector | `app/players/page.tsx`, `app/draft/pool.tsx` **[critique P2]** |
| Grouped two-row stat headers | `BOX / SHOOTING / ADVANCED` groups on the stat tables | Phase 10 |
| Player hero: coloured block, bio strip, rankings strip | Same structure, minus the photo: school colour, CBBD bio fields, the new rank rollup | `app/players/[id]/page.tsx` |
| Player card as a modal | Intercepting route so any row opens the card without losing lineup state | `app/@card/players/[id]` |
| Content-level tab strip | Nav is 8 destinations today, 10 after this work — past a flat row | `app/nav.tsx`, `app/ui/tabs.tsx` |
| Trending up/down | Falls out of the `transaction` log for free | Phase 10 |
| Game Center leaders rail | The "top single performances" ask | Phase 10 `/leaders` |
| Row density | `data-density="compact"` on the matchup and pool lists only; ledger screens stay spacious | `app/globals.css`, `app/ui/playerrow.tsx` |
| Team identity — colour everywhere | ESPN's public teams endpoint carries `color`/`alternateColor`; `source_kind` already lists `'espn'`, `game.espn_id` already exists — an anticipated source, not a new dependency | Phase 12 |

Deliberately not taken: league chat (a real feature, its own phase, not what
was asked); player photos and school logos (colours carry most of the identity
benefit and are unambiguously fine; hot-linking trademarked marks is the
owner's call, so logos go behind an opt-in); player nicknames; Sleeper's
dark-only palette (this app is theme-aware in both directions and that is
better).

### Phase 9 — Playoffs — done

Built as sketched, with two differences worth flagging. The playoff shape is
a league setting a commissioner draws from (`playoffTeams`,
`playoffStartWeek`, `playoffRoundWeeks`, `thirdPlace`, `consolation`,
`reseed`, `playoffTiebreak` on `LeagueSettings`, defaulting to a 4-team, one
week per round bracket with no third-place game) rather than a fixed 6-team,
weeks-15–17 default — `/commissioner/settings` and the CLI verb for exactly
this kind of number already existed by the time this phase was taken, the
same reasoning Phase 7 used for the trade deadline. And `/standings` was left
alone; the cut line and clinched/alive/eliminated status live only on
`/playoffs`'s own picture panel. See `packages/league/src/playoffs.ts`, the
`011_playoffs.sql` migration, and "How Phase 9 was verified" above for what
was actually built and how it was checked — this section is left as the
original plan only where Phase 10 below still depends on reading it that way.

### Phase 10 — The stat surface — done

Built close to the sketch, with three differences worth flagging. No
`recruit_rank` — checked against live pslice data, `COL.recRank` holds a
fractional rate stat rather than an integer rank; see "How Phase 10 was
verified" above. `trendingPlayers` counts roster-move activity rather than a
true adds/drops split, since `transaction.kind` cannot always say which
direction a trade moved a player. And the "game-day leaders rail" became one
ranked list rather than a separate rail — at the Day span it already reads as
one. Everything else below shipped as written: the ingest widening, migration
`012_leaders.sql`, `packages/league/src/leaders.ts`, `/leaders`, and the
player-card additions, all with the shooting/advanced stat groups needing no
new ingest field at all — `stats jsonb` has carried them since Phase 2. See
`packages/league/src/leaders.ts`, the `012_leaders.sql` migration, and "How
Phase 10 was verified" above for what was actually built and how it was
checked — the rest of this section is left as the original plan.

Ingest: `adapt.ts` gains `toBoxScore(row)` (steals, blocks, rebound split,
made/attempted FG/3P/FT) and `toBio(row)` (height, jersey, class, recruit
rank); `nightly.ts` stores `{ ...line, box }`; `linkCbbdRosters` stops
discarding `jersey`/`height`/`weight`/`hometown`/`dateOfBirth`. Then `npm run
ingest -- range 2026 20251101 20260408`, from cache.

Migration `012_leaders.sql`: bio columns on `player`; a `player_rank` rollup
keyed `(config_id, played_on, player_id)` with season-to-date total, games,
overall rank, rank within role — rebuilt by one re-runnable `INSERT … SELECT`
with window functions, no Torvik call, `npm run ingest -- ranks 2026`.

`packages/league/src/leaders.ts` (new): `topPerformances` (best single games
in a window with owner attribution, off the existing `pgsc_score_idx`);
`trendingPlayers` (adds/drops off the `transaction` log); `playerRankTrend`
(from `player_rank`); `playerWeekProjection` (scheduled games × the player's
average under this config — the same figure `periodOutlook`/`autoFill` already
rank by, nothing new invented); `seasonAverages`/`statPercentiles`.

UI: `/leaders` (Day/Week/Month/Season segmented, role chips, ranked single-game
performances, a game-day leaders rail). Player card: rankings strip under the
hero; a rank trend line chart (inverted axis, rank 1 at top); season-averages
strip; grouped `BOX / SHOOTING / ADVANCED` tables with percentile bars; week
projection beside the average; **the six blocks now show the archetype's
weights beside them** — closes the critique's finding that the one thing
distinguishing a lead from a big is missing from the page that exists to
explain the score; `opponentStrength` gets a scale and direction, another
critique item. New `app/ui/charts.tsx` (line/area, percentile bar, inline SVG,
both themes); `.spark` bounded rather than unbounded **[critique P2]**.

### Phase 11 — Injuries and news

RotoWire is proven in this repo: `scripts/crosswalk.ts:25` already calls
`rotowire.com/cbasketball/tables/injury-report.php?team=ALL&pos=ALL&conf=ALL&site=other&slateID=null`,
no key needed, `{ ID, player, team, position, injury, status }`, and the
README records this repo matching it at 92.5% with 4.9% genuinely unexplained.
`source_kind` already has `'rotowire'`, `player_availability` already has the
right columns and is read/written by nothing, and the team aliases in
`packages/crosswalk/src/normalise.ts:54` were built from RotoWire's own team
names.

`packages/sources/src/rotowire.ts` (client shaped like `TorvikClient`, same
cache/throttle convention); `packages/ingest/src/injuries.ts` (resolve through
`@illini/crosswalk`, link RotoWire ids into `player_source_id` the way
`resolveTorvikPlayers` does, push misses to `match_review`, write
`player_availability` with a fixed status vocabulary: out / doubtful /
questionable / probable / available; `npm run ingest -- injuries`). Read side:
`availabilityFor`, an injury glyph in the row/pool/lineup/matchup, an
availability panel on the player card, and a "Needs you" item on `/home` when
an `out` player is in tonight's lineup.

RotoWire's table carries status and body part, not prose. Probe for a news
endpoint during implementation rather than promise one; absent that, the panel
shows status, body part and date.

### Phase 12 — Retrofit the five existing screens

Everything in the design table above not already delivered by 8–10, against
`/home`, `/team`, `/league`, `/standings`, `/players`:

- Team identity: `013_identity.sql` adds `team.primary_color` /
  `secondary_color` / `abbreviation`; an `espn` ingest step fills them through
  the existing alias machinery; `Avatar` and the player row take a
  school-colour rail and ring. Logos behind an opt-in.
- `/league` rebuilt as opposed pairs, games cap **drawn** — nine counted, ruled
  off with the cap total, rest behind a disclosure **[critique P1]**.
- Win probability and yet-to-play breakdown on the scorebug.
- Content tab strip; player card as a modal from any row.
- Compact row density on matchup and pool lists.
- Remaining one-line critique P2s: sortable tables, team rows as links,
  `error.tsx` no longer printing `error.message` raw, per-select disabled state
  instead of one shared `busy`, route-specific `loading.tsx` skeletons.

### Migrations, and where they can go

010–013 sit on top of 009. Production is still at 006 and 007–009 are
deliberately unapplied (see above), so these reach the local copy and the Neon
branches and nowhere else — the owner's call, unchanged by this plan. 012 is
written and verified locally (see the state table and "How Phase 10 was
verified" above) but has not been run against `full-season-2026` or
production — nobody with Neon credentials has done it yet.

### Verification, when this ran

Same shape as every phase above: `npm test` with the new `leaders.test.ts`
(180 tests, up from 172), `npm run typecheck` plus `npx tsc --noEmit` inside
`apps/web`, `npm run parity` and `npm run backtest` after the ingest widening
(both reproduce the README's documented numbers exactly, proving the `box`
sub-object left the scorer's inputs untouched), and a browser pass at 390×844
via the same-origin iframe trick (`resize_window` is still non-functional
here) — 1440×900 and 768×1024 were not opened this round. The stat surface
wants a played-out season to be worth looking at; rather than wait on
`full-season-2026` being rebuilt for it, this was checked against a
from-scratch local database (two real weeks of 2025-11, drafted and settled),
the same substitution Phase 9's own bracket used.

### Order

Phases 8 and 9, which each changed or added one rule, went alone. Phase 10 —
a new ingest field, a new migration, a new package module, and two screens —
also went alone, and is done. Phases 11 and 12 remain: 11 → 12, each
independently shippable.
