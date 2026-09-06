# Development log

The design history of Illini Fantasy Hoops, phase by phase: what each part does,
why it was built that way, and the bugs worth remembering. See [README.md](README.md)
for what the project is and how to run it.

Plan: https://claude.ai/code/artifact/cb1d0d3b-d6b2-45e8-bd00-f2efff25a125

## Phase 1 — prove the scoring

The scoring model is ported and validated. No UI yet, by design.

```
packages/scoring   the six-block model; weights and bounds are data, not code
packages/sources   Barttorvik client (cookie handshake + date-sliced pslice)
scripts/parity     does the TS port reproduce generate_player_scores.py?
scripts/backtest   the four validation checks, over real single-game slices
scripts/diagnose   compare one player's model inputs across sources
```

Node 20+ required. The system `/usr/local/bin/node` is broken (missing
`libicui18n.67.dylib`); use nvm:

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npm install
npx tsx --test packages/scoring/src/score.test.ts
npm run backtest
```

Torvik responses are cached under `.cache/`, so re-runs are free and the
backfill only hits the network once.

## Two configs

`SEASON_CONFIG` reproduces the CBB Player-Score exactly — same weights, same
bounds, same `[2/3, 4/3]` multiplier. Verified against the Python output at a
median absolute difference of 0.17, with 98.3% of players inside 2.0; the
residual is snapshot drift in the reference CSV, not formula error.

`GAME_CONFIG` is the per-game variant. It differs in four documented ways, each
traceable to a finding in the audit:

| Change | Why |
|---|---|
| bounds refit to p99.9 (`points 0-37`, `rebounds 0-16`, `assists 0-11`) | season bounds clipped 7.0% of games; now 0.1% |
| shrinkage prior of 10 attempts | 1-for-1 from three otherwise maxed the term |
| opportunity gates on shooting and turnover-avoidance | an empty stat line otherwise scored ~12 |
| minutes ramp below 10 | per-game BPM is unstable in short stints |

## Backtest, 20,116 player-games across 12 game days

| Check | Result |
|---|---|
| Ceiling saturation | **PASS** — points clipping 7.0% → 0.1% |
| Tails | **PASS** — empty lines median 1.0, cameos median 1.7 |
| Reliability (odd vs even days) | **PASS** — r = 0.540 |
| Positional balance | **FAIL** — 1.33x lead-to-big spread, handled by roster slots |

## Known issues in the source model

Both are reproduced rather than silently fixed, since the league is scored on
the CBB model as it stands.

- **`swing` weights sum to 102, `big` to 98.** Those two archetypes are scored
  out of different totals — a 4.1% structural gap. Set
  `normaliseWeights: true` to divide each archetype by its own sum.
- **One upstream Torvik record is bad**: Devin McGlockton shows `GP 58`, which
  is not a possible season. It is the only row above 40 games.

## CollegeBasketballData

Key lives in `.env.local` (gitignored, mode 600). Free tier is **1,000 calls a
month**; the server reports what is left in `x-calllimit-remaining` on every
response, and `CbbdClient` tracks it, caches every response gzipped to disk, and
refuses to call below a floor.

`npm run budget` prints remaining quota against the projected usage:

| | calls |
|---|---|
| Steady state, one in-season month | ~77 (8% of tier) |
| Backfill, per season of history | ~160 |
| 3 seasons + a live month | 557 — still fits |

Payload, not call count, is the binding constraint: one date of shooting plays
is ~29 MB, all plays roughly 2.4x that.

## Draft pool — CBBD has no 2026-27 data yet

`npm run pool` reports coverage. As of September 2026:

| season | teams w/ players | players | portal | recruits |
|---|---|---|---|---|
| 2027 | **0** | **0** | **0** | **0** |
| 2026 | 365 | 5,643 | 1,577 | 396 |
| 2025 | 702 | 15,210 | 1,611 | 516 |

The endpoint works — 2026-27 simply is not loaded. So the draft pool comes from
CBBD's 2025-26 rosters (returning players) plus the incomplete NCAA CSV (4,505
players, 335 of 365 teams), and we poll CBBD weekly to switch over when it
populates.

## Phase 2 — player crosswalk

`packages/crosswalk` resolves one source's player to another's. Four systems,
four ID spaces, none shared: Torvik `pid`, ESPN `athlete.id`, NCAA `playerid`,
RotoWire `ID`. Everything joins through here.

Resolution runs in descending certainty and never guesses:

| confidence | rule |
|---|---|
| `exact` | name and team both match, uniquely |
| `strong` | unique name nationally (catches transfers), or first-initial + surname on the same team |
| `weak` | edit distance ≤ 2, scoped to one team |
| `none` | ambiguous or no candidate — goes to the review queue |

Team-scoped fuzzy matching is safe where global matching is not: within one
team the candidate pool is ~15 names rather than ~5,000.

`npm run crosswalk` measures it against live RotoWire injuries:

```
exact   186  50.1%      matched       343  92.5%
strong  157  42.3%      review queue   28   7.5%
weak      0   0.0%
none     28   7.5%      genuinely unexplained: 18 (4.9%)
```

Up from the 59% baseline in the plan (normalised name alone). Of the 28
unmatched, 10 are in the 2026 recruiting class or transfer portal — new to the
index rather than a matcher failure. Zero remaining team-alias failures.

## Phase 2 — schema

`packages/db` holds the migrations and data layer. Three files, applied in
order, split so a re-ingest can never touch league data:

| migration | holds |
|---|---|
| `001_sources` | teams, players, the crosswalk, games, ratings, raw per-game stats, availability |
| `002_scoring` | versioned scoring configs, per-game scores, ingest runs |
| `003_league` | users, leagues, fantasy teams, rosters, lineups, matchups, transactions |
| `004_membership` | sessions, league members, invites, league-wide player ownership, tip-off times |
| `005_game_day` | re-dates games onto the day they were played |
| `006_draft` | the draft, its materialised board, and each manager's queue |

**Scores are versioned by the config that produced them.** `scoring_config` is
immutable and keyed by a digest of its contents, and `player_game_score` is keyed
on `(player, date, config)`. Three properties fall out of that:

- replaying a night overwrites those rows and never duplicates them, so a Torvik
  revision is safe to re-run
- editing weights creates a new config version instead of mutating one that
  settled matchups already reference
- two versions can be compared over the same games (`compareConfigs`) rather than
  one destroying the other

`player_game_stat` holds raw source values and is never written by scoring;
`player_game_score` is derived and can always be rebuilt from it.

### Local development

Migrations run against any Postgres. A disposable one:

```sh
docker run -d --name illini-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=illini \
  -p 55432:5432 postgres:18-alpine
export DATABASE_URL=postgresql://postgres:dev@localhost:55432/illini
npm test
```

The db tests create and drop their own `illini_test` database.

### Neon

Production is a Neon project (`floral-shape-81709658`, branch `production`),
linked via `neon link`. Credentials live in `.env.local`, which `neon link`
writes and keeps current; `.neon` and `.env.local` are both gitignored.

```sh
npm run migrate     # applies pending migrations, idempotent
```

Migrations use `DATABASE_URL_UNPOOLED` when present — Neon's pooler multiplexes
sessions and DDL wants a dedicated connection.

Two things worth knowing if you touch the connection code:

- `neon link` writes **quoted** values into `.env.local`. Shell `source` strips
  quotes, so a hand-rolled parser looks fine until Node tries to connect to a
  host named `base`. Use `scripts/env.ts`.
- The Neon URL carries `sslmode=require`, which `pg` currently treats as
  `verify-full` but will downgrade to weaker libpq semantics in v9. `connect()`
  pins `verify-full` explicitly so a dependency bump cannot quietly loosen TLS.

## Phase 2 — ingest

```sh
npm run ingest -- setup 2026                 # teams and adjusted ratings
npm run ingest -- schedule 2026 20261101 20270315   # games and tip-off times
npm run ingest -- night 2026 20260214        # one game day
npm run ingest -- range 2026 20260210 20260214
npm run ingest -- link  2026                 # crosswalk CBBD onto known players
```

`link` runs *after* at least one night. Torvik is the identity spine — a player
exists once they have a stat line, and other sources attach to that row rather
than minting their own.

A night is re-runnable end to end: stats upsert on `(player, date)`, scores on
`(player, date, config)`. Running the same night twice leaves 2,467 rows, not
4,934, which is what makes a Torvik revision safe to replay.

**Opponent strength drives the multiplier.** `team_rating` stores dated
snapshots with a 0..1 percentile strength, and the scorer reads the rating
current at tip-off rather than today's. Observed across a full slate: multiplier
min 0.67, median 0.99, max 1.33 — the whole band, as designed.

`npm run team-aliases 2026` lists Torvik team names that do not resolve to a
CBBD team, with candidates. Review before pasting into `TEAM_ALIASES`: a wrong
team silently misattributes every player on it. Currently **0 of 365 unmatched**.

### Three bugs worth remembering

- **Batch, don't loop.** The first setup pass made ~13,000 sequential queries
  and took over two minutes against Neon. Batched, it is under two seconds.
  `insertMany` also dedupes within a batch, since Postgres rejects a statement
  whose `ON CONFLICT DO UPDATE` would touch one row twice.
- **`endDateRange` is a timestamp, not a date.** Passing a bare `YYYY-MM-DD` for
  both ends matched only games tipping at exactly midnight UTC — 9 games instead
  of 124. The window runs to end of day and into the next UTC morning, because a
  9pm ET tip-off is already tomorrow in UTC.
- **A leading `St.` is Saint, not State.** Expanding it blindly turned
  "St. Thomas" into "state thomas". Aliases also have to converge: a single pass
  left "LIU" as "long island university" next to CBBD's "long island".
- **`/games` truncates at 3,000 and does not say so.** One call for a whole
  season returns exactly 3,000 games ending in mid-January and looks like a
  complete answer. `syncSchedule` now treats a full response as truncated and
  splits the window, which cost 5 calls for 6,317 games across 2025-26.

### Fixing the normaliser does not fix the rows

`team.normalised` is written once, at insert. So when `normaliseTeam` learns
something — a new alias, or that a leading "St." is Saint — the rows already in
the table keep the answer it used to give, and the school quietly becomes two
teams: one the box scores attach *players* to, and one the schedule attaches
*games* to.

That split is silent. `startableOn` joins the schedule on the player's team, so
a player on the wrong half simply has no game on any night. No error is raised;
he is never startable. Twenty-three such rows were holding **200 players** when
the full season was first loaded, St. John's and St. Bonaventure among them, and
five days of data had never been enough to expose it.

```sh
npm run merge-teams            # report what would move
npm run merge-teams -- --apply # repoint players, games, ratings; drop the row
```

Run it after any change to `TEAM_ALIASES` or `normaliseTeam`. A clean database
prints `724 teams, all normalised as the current rules would`.

## Phase 2 — league play

```sh
npm run league -- create 2026 "Illini Fantasy" 10
npm run league -- draft 1 2026            # snake draft off the season board
npm run league -- lineups 1 20260214      # auto-fill and lock a day
npm run league -- settle 1 15
npm run league -- standings 1
```

Run end to end against real ingested data — 10 teams, 120 drafted players,
week 15 settled:

```
week 15    698.2 - 674.8    (9/20 vs 9/18 games)  home
week 15    652.5 - 692.5    (9/19 vs 9/17 games)  away
week 15    681.2 - 681.6    (9/19 vs 9/20 games)  away
```

**The games cap keeps the best games, not the earliest.** College schedules are
uneven — a team started 20 games that week and another 13 — so without a cap the
matchup is decided by whose players happened to draw a heavier slate. Counting
chronologically until the cap is hit would punish a manager for the order the
schedule fell in, which is the same schedule luck the cap exists to remove.

Roster slots (`2 G · 2 F · 1 C · 2 FLEX`) derive eligibility from the archetype
the scoring model already assigns, so eligibility and scoring cannot disagree
about what a player is. `autoFill` fills the scarce slots first: the only
eligible centre starts at C even when six guards outscore them.

Settlement is re-runnable. Totals are recomputed from stored scores rather than
accumulated, so a Torvik revision flows through to the standings on the next run
instead of needing a manual fix.

## A full season, drafted and played

`npm run season` builds a league over the whole of 2025-26 rather than the days
a demo happened to ingest. It wants the season loaded first:

```sh
npm run ingest -- setup 2026
npm run ingest -- range 2026 20251101 20260408   # 159 nights, ~30 min
npm run season                                    # draft, lineups, settlement
npm run season -- --drop                          # league only; source data stays
```

`range` loads the schedule once and reads each night's opponents back out of the
`game` table, so a whole-season backfill costs about six CBBD calls rather than
one per night. `night` still asks for its own day, because a single night is
usually being caught up on its own and the schedule may not be there yet.

What lands:

| | |
|---|---|
| Game days | 147, 2025-11-03 to 2026-04-06 |
| Player-games | 113,860, every one with a resolved opponent |
| Players · teams · games | 4,978 · 365 · 6,317 |
| Mean Player-Score | 26.73, high 101.9 |
| League | 10 teams, 12 rounds, 120 rostered, 4,340 lineup rows, 3,881 starts |
| Settled | 115 matchups over 23 scoring periods |

Two things about how it is built:

- **The auto-draft ranks by season-total Player-Score**, which is hindsight.
  That is the right hindsight here — the league exists to show what a full
  roster of real players scores, not to simulate draft-day ignorance.
- **One lineup per team per scoring period**, picked on form from before the
  period opened and written across every night in it — the decision a manager
  actually makes, made once. Seeding it a night at a time instead (which is how
  this season was first built) leaves a dozen players having started somewhere
  inside a week the league has seven slots for: every point real, and no lineup
  anybody could have set. `npm run reweek -- <league>` re-cuts a season built
  that way and settles it again.
- **Nothing is picked with hindsight.** Form is cut off at the Monday, so
  March's totals never reach back to choose November's lineup. The lock is not
  consulted at all, which is what makes seeding different from auto-fill:
  against the real clock every game in a past season has already tipped off, so
  a season generated through the lock would settle as zeroes.

## Phase 3 — league core

Phase 2 proved the mechanics with one user owning all ten teams, lineups
auto-filled the morning after, and nothing stopping two managers from rostering
the same player. Phase 3 makes each of those real.

```sh
npm run league -- create 2026 "Illini Fantasy" 10 you@example.com
npm run league -- invite 1 manager@example.com     # prints the token once
npm run league -- accept <token> manager@example.com "Manager Name"
npm run league -- passwd commish s3cret-passphrase # the seat becomes an account
npm run league -- members 1
npm run league -- roster 3
npm run league -- lineups 1 20260214              # auto-fill, locks respected
```

### Membership and invites

`app_user` is the one identity table: the username somebody signs in with, the
address an invite is sent to, and the `league_member.user_id` a roster hangs off
are all the same row. The project already carries a crosswalk because four
sources mint their own player ids; there was no reason to repeat that for
humans. Sessions hang off it in `auth_session`.

A row can exist before its person can sign in — `create` mints the commissioner's
seat, and `acceptInvite` mints a manager's — so every row carries a username
from the moment it is written and a `password_hash` only once somebody sets one.
`passwd` is what turns a seat into an account.

Teams are created **unowned**. A manager takes one by redeeming an invite, so
ownership is something a person did rather than something the seed script
asserted. Redemption runs in one transaction and takes a row lock on the claimed
team, because two people opening the same link at once must not share a roster.

Only the token's SHA-256 hash is stored. The plaintext is returned once, at
creation, and is unrecoverable afterwards — an emailed link is a bearer
credential, and this is the table most likely to end up rendered in a
commissioner screen. Re-inviting an address revokes the outstanding link rather
than adding a second, so revoking the one you remember cannot leave a forgotten
one live.

### One player, one team

The old index was unique on `(fantasy_team_id, player_id)` — it stopped a team
rostering the same player twice and happily let two teams in one league both own
him. Enforcing it league-wide needs `league_id` on the row, and a composite
foreign key back to `fantasy_team (id, league_id)` is what keeps that copy
honest, so no trigger is involved and the two cannot drift.

`claimPlayer` reads the current owner first, but only to name them in the error.
The unique index is what actually prevents the double claim: two managers
claiming one player at the same instant *is* the waiver case, and the loser has
to lose in the database.

Tenures close rather than delete. Settling an old week sees the roster as it
stood that night, so a March trade cannot rewrite who scored for whom in
January.

### The lineup lock

The league locks per game at tip-off, Sleeper-style, not once a week. Two things
had to change before that was possible.

**Startability now comes from the schedule.** The Phase 2 path joined
`player_game_stat`, which exists only once a box score has been filed — so a
lineup could only be set for games that had already been played. `startableOn`
joins `game` on the player's real team instead, which is the difference between
a lineup and a retrospective.

**`game` had no tip-off time**, only a date, so there was no boundary to lock
against. CBBD had been returning `startDate` all along.

`entries` is a patch, not a replacement: a player it does not name keeps the slot
he has. Replacement semantics would mean a manager who opened the page at six
and submitted at eight silently benched whoever tipped off in between, which is
exactly the move the lock exists to refuse. Sliding someone into a slot a locked
player holds is refused too, but as an overfilled slot rather than a lock
violation — the lock is about moving a player who has played, and that player
has not moved.

Auto-fill is the safety net for a manager who never logs in, and it cannot undo
a decision the clock already made: locked players keep the slot they tipped off
in, and auto-fill competes only for what is left.

Against the real Feb 14 slate, one team's nine startable players:

| clock | startable | locked |
|---|---|---|
| 17:00Z, before the slate | 9 | 1 |
| 23:00Z, mid-slate | 9 | 8 |
| 06:00Z, after | 9 | 9 |

Replaying a night needs a commissioner override, because every game in it has
tipped off and the lock would otherwise — correctly — refuse to move anyone:

```sh
npm run league -- lineups 1 20260214 2026-02-14T12:00:00Z
```

### The bug the schedule join exposed

**A 9pm Eastern tip is already tomorrow in UTC.** `game.played_on` stored the
UTC date of `startDate`; Torvik labels a box score with the local game date. The
two disagreed for **158 of the first 280 games**, and nothing noticed while
lineups were derived from box scores. Join the schedule instead and half the
slate vanishes — Feb 10 reported zero startable players against 401 real stat
lines.

The day boundary is 09:00 UTC, 4am Eastern. Observed tip-offs run 16:00 to 05:00
UTC, so the empty band has hours of margin at both ends. After `005_game_day`,
all 280 games agree with Torvik:

```
schedule vs box score dates    days_off 0 : 280 games
```

This is the third timezone bug in this codebase and the second in the same
column. The first was the query *window*; this was the *storage*.

### Run end to end

Against production, week 15 of the ingested slate:

```
week 15    674.6 - 635.8    (9/20 vs 9/18 games)  home
week 15    666.1 - 681.6    (9/19 vs 9/20 games)  away
week 15    644.1 - 597.3    (9/17 vs 9/13 games)  home
week 15    679.4 - 649.4    (9/22 vs 9/18 games)  home
week 15    646.4 - 665.0    (9/19 vs 9/17 games)  away
```

Totals moved from the Phase 2 figures because more players are startable now: a
manager can start someone who then does not play, which is the risk that makes
setting a lineup a decision rather than a formality.

A realistic college week, from the same run — the roster is the top 120 season
scorers, so it follows the major-conference calendar:

| day | rostered players with a game |
|---|---|
| Tue Feb 10 | 60 |
| Wed Feb 11 | 52 |
| Thu Feb 12 | 6 |
| Fri Feb 13 | 6 |
| Sat Feb 14 | 112 |

## Phase 3 — the web app

```sh
npm run dev        # http://localhost:3000
```

Two things that will waste your afternoon otherwise:

- **`AUTH_URL` in `.env.local` pins the port.** `next dev` falls through to the
  next free port if 3000 is taken, and the invite link on `/commissioner` is
  built from `AUTH_URL`, not from the port actually in use — so the link the
  commissioner copies lands on a dead port. Either free 3000 or move `AUTH_URL`
  with it. Sign-in itself no longer depends on it.
- **Next allows one `next dev` per directory.** A second one exits with
  "Another next dev server is already running" and names the PID of the first.
  To run a second copy — a scratch database, say — build and `npx next start
  --port 3006` instead.

### Browsing a finished season

The ingested data is February 2026, so with the real clock every game has long
tipped off and every lineup is correctly frozen. Two env vars unpin that:

```sh
ILLINI_TODAY=2026-02-14                  # the date the app treats as today
ILLINI_NOW=2026-02-14T18:30:00Z          # the clock the lock is measured against
```

`ILLINI_TODAY` alone keeps the real time of day, so a demo slate locks through
the evening the way a real one does. Set both to freeze a specific moment —
useful for screenshots, and for seeing the lineup controls at all.

The lock clock has to move with the view date. It did not at first, and the
result was an app that looked complete and was inert: every tip-off compared
against a wall clock seven months later, so every game read as started and the
one interactive control on the site never rendered on any date.

Next.js 16 App Router in `apps/web`, importing the workspace packages
directly — the scoring model, the league rules and the queries are the same
code the CLI runs, so a screen cannot disagree with a settlement.

### Auth

A username and a password, in `app_user`. Sign-in used to be a magic link, on
the reasoning that in a private twenty-person league the invite and the sign-in
are the same mechanism. That reasoning holds right up until you want to sign in:
a league is played on a phone late at night, and a round trip through an inbox
is a worse door than a password manager. It also meant development was one
unconfigured mail provider away from nobody being able to get in at all.

**The invite link stays.** It hands over a *team*, not a session — redeeming one
is where a manager picks their username. What it no longer proves is ownership
of the mailbox it was addressed to, so the token is now the whole credential.
For a link a commissioner passes to somebody they already know, that is the
trade being made deliberately, and it is the one thing this change made weaker.

Passwords are scrypt at Node's documented interactive cost, stored as
`scrypt$N$r$p$salt$hash` so the parameters travel with the hash and raising them
later leaves every existing password verifiable. A sign-in that finds no such
username still verifies against a throwaway hash, so a wrong name and a wrong
password take the same time — otherwise the form is a way to find out who is in
the league, and it answers with one sentence for both.

Sessions are rows in `auth_session`, keyed by 32 random bytes in an httpOnly
cookie. Auth.js is gone: it supports credentials only alongside JWT sessions,
which would have meant a token that stays valid until it expires no matter what
the server later thinks of it. Signing out is a `DELETE`, so a lost phone is one
statement away from harmless. What is left is `apps/web/lib/auth.ts`, and it is
short enough to read in a sitting.

`npm run league -- passwd <username|email> <password>` is the reset, and the way
a seat that has never had a password becomes an account. There is no self-serve
password reset and no mail: a twenty-person league has a commissioner.

### Screens

| route | |
|---|---|
| `/home` | the live matchup, tonight's slate, and what needs you |
| `/league` | the week's matchup, scored live from stored player scores; games past the cap dimmed, not hidden |
| `/team` | tonight's startable players, with per-game locks and slot validation |
| `/draft` | the draft room — clock, best available, your queue, the board |
| `/players` | the pool, ranked by season Player-Score, with ownership |
| `/players/:id` | the game log, each night broken into its six blocks |
| `/waivers` | the wire, your sealed claims, and every team's budget |
| `/trades` | propose, answer, review, and the history |
| `/standings` | settled weeks only |
| `/commissioner` | invites, revocation, and who holds which seat — commissioner only |
| `/commissioner/settings` | every number the league runs on — commissioner only |
| `/join/:token` | redeeming an invite |

Totals on `/league` are recomputed from `player_game_score` rather than read from
`matchup.home_points`, so a week in progress reads the same way a settled one
does and a Torvik revision shows up without waiting for settlement.

### Design

The palette and faces come from the league design brief — Archivo, Source Serif
4, IBM Plex Mono, `#D8431F` on `#13294B`. Their *roles* are assigned for product
UI rather than a brand surface: Archivo carries the interface, the serif is kept
for prose where someone is actually reading, and mono is used only for
measurement — scores, tip-off times, tabular numbers.

Three defects the design pass turned up, none of which a test would have caught:

- **Sticky table headers hid the first row of every table.** Inside an
  `overflow: hidden` panel the sticky `thead` covered row one, so standings
  opened at rank 2 and the pool's top-ranked player was invisible.
- **Tip-off was formatted in the browser's timezone**, so the server rendered one
  string and the client another — a hydration mismatch that made the column
  silently flip to UTC on a client-side navigation. It is Eastern now, formatted
  once, which is how college schedules are published anyway.
- **`--faint` failed contrast at 2.97:1** while carrying most of the small text,
  and the slot tag was invisible in dark mode. Both were measured, not eyeballed.

### The commissioner surface

Invites were CLI-only through Phase 3, which meant the app could not be used for
its actual purpose without a terminal — and not just by the commissioner:
redeeming a link was `npm run league -- accept` too, so every manager needed one.
Both halves are now screens.

`/commissioner` lists the seats, creates an invite, and revokes an outstanding
one. It is the commissioner's own page, and a manager who reaches it is told so
rather than 404'd — the refusal that matters is in the data layer, where
`inviteToLeague` and `revokeInvite` both call `requireCommissioner`.

**The link is shown once and then it is gone.** Only the token's SHA-256 hash is
stored, so the plaintext exists for exactly one render. It lives in the client's
action state and nowhere else — never in the URL, never in a redirect, because a
bearer credential in a query string ends up in browser history and in every
access log on the way. Revoking that invite takes the link off the screen with
it, so a dead link cannot be pasted into an email.

The invite form refuses before it mints rather than after someone redeems: with
every seat claimed there is no team to hand over, and an invite with nothing
behind it looks exactly like a good one right up until the manager clicks it.
The team selector lists only unclaimed seats for the same reason.

`/join/:token` is the other half, and for a new manager it is also where their
account begins: the link is what says they are allowed one, so choosing a
username and taking the team are the same submit. The account is registered
against the address the invite names rather than one the form collects — the
commissioner already named it, and an editable field would only let a manager
put their account beyond the reach of the invite that made it.

An invited address that already has an account is sent to `/signin?next=…`
instead, so a manager in a second league signs in rather than being offered a
username that would fail on the way in.

The page says which of the five states it is in — spent, expired, signed in as
somebody else, already a member, or ready — rather than failing the same way for
all of them. Only "spent" is deliberately vague: already redeemed, revoked and
mistyped look identical, since telling them apart only helps someone guessing.

A failed registration keeps the invite. "That username is taken" is a sentence
under the field, and the link is still live — the account is only created and
the team only claimed when both halves succeed.

Redemption is a button, not something that happens on page load. It claims a
team and burns the link; a link preview fetcher should not be able to spend
somebody's invite for them.

Two additions to the league package back it: `teamsInLeague` reports both sides
of a seat, and `inviteByToken` reads an invite without redeeming it.

## Phase 4 — the draft

Phase 2 filled rosters with a script: rank the season board, deal it out in
snake order, insert. That is a seeding tool. A draft is a sequence of decisions
made by different people at different times, and what has to be durable is the
sequence — who was on the clock, what they took, and what the clock did when
nobody was there.

```sh
npm run league -- draft new 2 12 90      # 12 rounds, 90s a pick; draws the order
npm run league -- draft start 2
npm run league -- draft board 2
npm run league -- draft pick 2 <teamId> <playerId>
npm run league -- draft queue 2 <teamId> 4021 -3877   # a bare id queues, -id removes
npm run league -- draft pause 2 | run 2
```

`/draft` is the same engine with a clock on it: the board, best available, your
queue, and the commissioner's start/pause.

### The board is rows, not arithmetic

Every pick exists as a row the moment the draft is created — the team that owns
it, and no player yet. "Who picks 47th" is then a fact to read rather than a
snake calculation repeated in the engine, the auto-picker and the screen, three
places that would each have to agree about the same off-by-one.

The order is drawn once, stored, and cannot be redrawn. `draft_pick` rows for
round one *are* the order, so there is no second table to disagree with them.

### The clock is settled on read

There is no daemon in this system, and a draft with a 90-second clock has to
advance whether or not anyone is watching. So every path that looks at the draft
first makes the picks that were already due, at the times they were due.

Two properties fall out of that:

- **The board is the same whether one person refreshed all night or nobody
  did.** Each deadline advances from the previous deadline, never from the
  moment somebody finally looked.
- **It is testable**, because "now" is an argument.

That second property stopped being theoretical during verification. The local
demo was seeded, then left for the best part of three hours before the room was
opened. One page load reconstructed all 116 overdue picks:

```
pick   4   17:42:41  auto
pick   5   17:44:11  auto
pick   6   17:45:41  auto
 …
pick 120   20:36:41  auto      exactly 90s apart, start to finish
```

An open room polls every five seconds, so in practice a live draft is driven by
whoever is watching it — and costs nothing when nobody is.

### A pick is a roster claim

`makePick` claims through `claimPlayer`, the same function a waiver claim uses,
so a drafted player is owned by exactly the unique index that already enforces
one player to one team per league. The draft does not get its own notion of
ownership to drift from the league's.

Everything serialises on the draft row. Picking, expiring the clock, starting
and pausing all take `SELECT … FOR UPDATE` on it first, so two managers who
click at the same instant queue up in Postgres rather than both being told they
are on the clock. A pick submitted a second after the buzzer loses to the
autopick the buzzer already made, and is told so.

### What the clock takes when you are not there

In order: your queue, then the best available player who fills a starting slot
you cannot yet fill, then the best available player.

The middle rule is the one that matters. A board sorted by season total is
guards at the top, and a team that takes the top of it twelve times finishes the
draft unable to field a centre — legal at every individual pick and broken as a
roster. `unfilledSlots` answers the question by running `autoFill`, so the
auto-picker's idea of a complete team is the same one the lineup screen enforces
on a Tuesday night.

FLEX is excluded from that: it takes anyone, so an unfilled FLEX is never a
reason to pass over the best player on the board. Only the slots that actually
exclude somebody can steer a pick.

### Run end to end

A fresh ten-team league against the real ingested pool, 12 rounds, 120 picks:

```
human pick   1. JT Toppin
out of turn  refused: team 19 is not on the clock — Team 7 is
double pick  refused: player 2079 is already drafted by Team 9
clock        1 autopick — Cameron Boozer (from the queue)
auto-draft   118 picks, status complete
legal        10/10 rosters field a full lineup
exclusive    0 players owned twice
```

Every one of the ten rosters fills all seven starting slots, off a board whose
top is guard-heavy — which is the whole point of the slot-aware autopick.

### Two things worth remembering

- **The draft runs on the real clock, not `ILLINI_NOW`.** The date pin exists so
  a finished season can be browsed with the lineup lock behaving as it did that
  night. A draft is the opposite kind of event: it is happening, now. Pinning it
  would mean no deadline ever passes and no autopick is ever made — the same
  inert-looking app the pin was invented to avoid.
- **A draft deals out an empty league.** `createDraft` refuses a league that
  already has rostered players, and `/draft` says so before offering the button
  rather than after somebody commits. Production league 1 still holds the 120
  players the Phase 2 script seeded, so its draft has to be set up on a league
  that has none.

## Phase 5 — waivers and free agency

`roster_slot` and `transaction` have modelled the claim/release lifecycle since
Phase 2, and `claimPlayer` / `releasePlayer` have enforced it. What was missing
is the part that makes a claim a contest rather than a race: a blind bid, a
moment when every bid is opened at once, and a rule for who wins.

```
packages/league/src/waivers.ts       the wire, the bids, and the run that opens them
packages/db/migrations/007_waivers.sql
apps/web/app/waivers                 the wire, your claims, every budget
```

```sh
npm run league -- waivers state 1                 # reading settles what was due
npm run league -- waivers drop 1 <teamId> <playerId>
npm run league -- waivers bid 1 <teamId> <playerId> <bid> [dropPlayerId]
npm run league -- waivers add 1 <teamId> <playerId> [dropPlayerId]
npm run league -- waivers claims 1 [teamId]
npm run league -- waivers run 1 2026-02-16T09:00:00Z   # open the bids due by then
```

Each team gets a season FAAB budget (`$100` by default). A bid is sealed until
the run that opens it; the highest wins; ties go to waiver priority, and the
team that wins a tie rolls to the back of the line.

### The wire is the scarce thing

A dropped player does not go back into the pool. He lands on the wire and stays
there until the run named by `clears_at` — bid for until then, and an ordinary
free agent afterwards. Everyone else who is unowned can simply be added.

That split is the whole design. Dropping straight to free agency rewards
whoever happens to be awake at 3am, which is the behaviour waivers exist to
remove; putting *every* unowned player behind a bid would mean a manager cannot
replace an injured starter before Saturday. So the auction covers exactly the
players somebody just gave up on, and there is no code path that produces the
other outcome — the drop and the waiver period are one action.

### Settled on read, again

There is no worker here either. A claim carries `runs_at`, the run that will
open it, and the first reader past that moment resolves the batch:

```sh
npm run league -- waivers state 1     # reading settles what was due
```

Two properties fall out of that, the same two the draft clock gets. A league
nobody visited for a week comes back with the rosters it would have had if
somebody had watched every run, because each batch resolves against the state
the batch before it left rather than against the moment somebody finally looked
— and each award is dated to its own run, so the tenure starts on the right
night. And the whole thing is testable by passing a different `now`.

Everything serialises on the `league` row, which is this module's equivalent of
the draft row. Two managers who open the page at 09:00:01 queue up in Postgres
rather than both being awarded the same player.

### What one run actually does

Claims are ordered by bid, then priority, then the team's own sequence, and each
is answered against the state the ones before it left behind:

```
Team 7   $31  Stefan Vaaks       won
Team 9   $31  Stefan Vaaks       lost      Team 7 won the tie on waiver priority
Team 5   $14  Stefan Vaaks       lost      outbid — Team 7 paid $31
Team 2   $60  Silas Mabrey       lost      only $10 left in the budget
Team 4   $50  Silas Mabrey       invalid   the roster is full at 13 and no player was named to drop
```

Four ways to lose, and each one says which. A manager outbid by $17 and one
beaten on a coin flip should not read the same sentence — a blind auction that
only ever reports "somebody else got him" is a black box. The winning bid
becomes public at the run; sealing it only ever mattered beforehand.

A team's own `sequence` never outranks another team's money — a rival's higher
bid wins whatever order you put yours in. It decides which of *your* claims
takes the last roster spot, or the last of the budget, which is what a manager
with four bids and room for two is really being asked.

### Two things that are easy to get wrong

- **A drop has to clear the lineups it can no longer stand behind.** Lineups can
  be set for nights that have not happened yet, so a player dropped on Tuesday
  can still be sitting in Thursday's starting five — and settling would count
  his points for a team that no longer owns him. `release` deletes the entries
  whose games have not tipped off and leaves the ones that have: those points
  were earned by the team that started him, which is the same reason tenures
  close rather than delete.
- **Waivers run on the app's clock, not the wall clock — the opposite of the
  draft.** A draft writes rosters dated by its own `opens_on`, so pinning its
  clock only stops the deadline passing. A waiver claim writes a *dated tenure*
  and is read back against the same pinned date the rest of the app browses.
  Take the wall clock and a drop in a pinned February season is dated September,
  which is to say the player never leaves the roster on any night anybody can
  see.

### Budgets are a ledger, not a balance

Spend is summed from won claims rather than stored on the team, for the same
reason matchup totals are recomputed from player scores: a ledger and a balance
can disagree, and one of them then has to be wrong. The submit-time check and
the run-time check are the same arithmetic over the same rows.

Priority is stored, because it is a consequence of history rather than a
function of the standings. It is renumbered to 1..n on every run, so a team
created after the migration is not left holding a null.

## Phase 6 — trades

`transaction.kind` has carried a `trade` value since Phase 2, and `roster_slot`
has always closed one tenure and opened another on a date, so the ownership move
was never the missing part. What was missing is everything around it: an offer
somebody can refuse, a moment it stops being refusable, and a window in which
the rest of the league can see what was agreed before it happens.

```
packages/league/src/trades.ts       the offer, the window, and the run that moves the players
packages/db/migrations/008_trades.sql
apps/web/app/trades                 propose, answer, review, and the history
```

```sh
npm run league -- trades list 1 [teamId]              # reading executes what was due
npm run league -- trades offer 1 <from> <to> <give,ids> <get,ids> ["why"]
npm run league -- trades accept 1 <tradeId> <teamId>  # or reject
npm run league -- trades withdraw 1 <tradeId> <teamId>
npm run league -- trades veto 1 <tradeId> "reason"
npm run league -- trades run 1 2026-02-17T18:30:00Z   # execute what the clock has reached
```

An offer stands for `tradeOfferDays` (3) and then goes stale. Accepting it is
the last say either manager gets: from there the deal sits in the open for
`tradeReviewHours` (24), and then the players move — unless the commissioner
stops it first.

### The window is the whole design

Both managers have already agreed, so the window is not about them. It is the
rest of the league's chance to see what was agreed, and the commissioner's
chance to stop it while stopping it is still cheap.

That is why the veto only works *inside* it. A veto after the players have moved
would be an unwind, and unwinding a trade means rewriting who owned whom on
nights that have already been scored — which is the one thing the whole dated
`roster_slot` design exists to make impossible. The answer to a commissioner who
hears about a deal late is "too late", and the window is what makes that answer
rare rather than routine.

The reason is stored and shown. A veto is the most contested thing a
commissioner does, and one delivered without a sentence is what leagues actually
fall out over. Setting `tradeReviewHours` to zero turns the window off and
executes on acceptance, which is a legitimate way to run a league that trusts
itself.

### Settled on read, a third time

There is no worker here either, for the same reason there is none for the draft
clock or the waiver run. An accepted trade carries `executes_at`, and the first
reader past that moment moves the players — dated to that moment rather than to
the moment somebody finally looked:

```sh
npm run league -- trades list 1     # reading executes what was due
```

Everything serialises on the `league` row, the same one the waiver run holds. A
league nobody visited for a week comes back with the rosters it would have had,
each deal executed on the night it was due and against the state the one before
it left behind. Offers nobody answered are expired in the same pass — a stale
offer is a thing the clock owes an answer to as much as an agreed one is.

### Four ways a deal does not happen

Rejected, withdrawn, expired, vetoed — and one more that is not anybody's
decision. Between the handshake and the execution either roster can change, so
the deal is checked twice against exactly the same arithmetic: once at
acceptance, so a manager finds out now, and once at execution, because a day is
long enough for a player in it to be dropped or traded elsewhere.

```
Blue: Player 1  ⇄  Orange: Player 4     vetoed     a swap back the day after is not a trade
Orange: Player 4  ⇄  Blue: Player 1     expired    nobody answered before it expired
Orange: Player 5  ⇄  Blue: Player 2     invalid    Player 5 is on Green now
```

A deal that could not be honoured says so rather than disappearing: both
managers agreed to something, and are owed the sentence naming the man it broke
on. And it leaves nothing behind — each trade executes inside its own savepoint,
because half of a two-for-one is not a smaller trade, it is two teams robbed.

Shopping one player to two teams is ordinary and is not a mistake. Both may
accept; the first deal to execute takes him and the second is voided naming the
team that got there first.

### One rule, one copy

A trade closes a tenure, which means it owes the lineup rule that Phase 5
learned the hard way: a player traded on Tuesday can still be sitting in
Thursday's starting five for the team that gave him up, and settling would count
his points for them. That rule now lives once, as `clearFutureLineups` next to
`releasePlayer`, and the waiver path calls it too. Nights that have already
tipped off stay exactly as they were.

The other shared rule is the ordering. Every tenure closes before any opens:
doing it player by player would put a two-for-one over the roster limit halfway
through, and a straight swap would hit the league-wide ownership index while the
man is briefly on both teams. Neither is a state the deal passes through, so
neither exists.

## Phase 7 — the league settings screen, and a trade deadline

Every number this system runs on has lived in `league.settings` since Phase 2,
and nothing edited any of them: changing the games cap or the FAAB budget meant
an UPDATE by hand. The storage was never the missing part. What was missing is
the part that knows which changes a league already in progress can survive.

```
packages/league/src/settings.ts     the rules, the refusals, and the re-score
apps/web/app/commissioner/settings  the screen
```

```sh
npm run league -- settings 1                       # every number, and the league's own state
npm run league -- settings 1 gamesCap=8 faabBudget=200
npm run league -- settings 1 starters=G2,F2,C1,FLEX2
npm run league -- settings 1 tradeDeadline=2026-03-01     # or tradeDeadline=none
```

No migration. `settings` is jsonb and every reader already merges it over
`DEFAULT_SETTINGS`, so the deadline is a new key rather than a new column, and a
league that has never heard of it reads `null`.

### Three kinds of setting

The difference between them is the whole module.

**Ones that only bind the future.** The waiver hour, the offer life, the review
window. Change them and the next bid or deal follows the new rule — but a bid
already sealed carries its own `runs_at` and an agreed trade its own
`executes_at`, because those moments are written down when they are made rather
than worked out when they are read. That is not a bug to go and fix. It is the
only reason a sealed bid can be sealed at all, so the change is made and the
consequence is *said*: "1 sealed bid will still open at the hour it was filed
for."

**Ones a league in progress can contradict.** A roster limit below a roster
somebody already holds, or a FAAB budget below what somebody already spent, is
not a rule — it is a league in a state it had no way to reach. Both are refused,
and the refusal names the team:

```
refused: Team 1 holds 4 players and that shape leaves room for 2. Somebody has to
         be dropped before the roster can shrink.
refused: Team 2 has already spent $140 of the budget, so $100 is a season nobody
         could have played.
```

Every reason comes back at once rather than one per attempt. A form that refuses
one field and then refuses the next on resubmission is a form somebody fills in
four times.

The scoring period is the third refusal and the flattest one: it is read exactly
once, when `generateSchedule` draws the weeks, and those weeks are rows in
`matchup` afterwards. Changing it later would move nothing, so saying so is more
honest than saving a number that does nothing.

**One that is scoring.** The games cap decides which started games counted, so a
week settled under a cap of nine is not the score the league plays by once the
cap is eight. Standings read `matchup.home_points`; `/league` recomputes live
from player scores. Move the cap and those two stop agreeing.

So moving it re-scores every already-settled week, in the same transaction as
the change:

```
Games cap       9 → 3
  1 settled week was re-scored under the new cap, so the standings and the
  matchup screen still agree.
```

Settlement was built re-runnable for exactly this — totals are recomputed from
player scores rather than accumulated. `settled_at` is deliberately left where
it was: the week was settled when it was settled, and a cap change re-scores it
rather than re-dates it.

The one thing that is never done is the thing the scoring config already
forbids. A settled score is not quietly rewritten; it is rewritten *loudly*,
with the count in the result, a line in the transaction log, and the sentence on
the screen before the button is pressed.

### The screen says the number before it takes it

The roster limit is the number that actually bites, and it is not a field — it
is `starters + bench + ir`. So it is derived on screen as the slots move, beside
the fullest roster in the league:

```
1 starting slot, 0 on the bench, 0 on IR — a roster limit of 1. Team 1 already
holds 4, so this will be refused until somebody is dropped.
```

A commissioner adding a bench seat is really asking "how many players is that",
and answering it afterwards with a rejection is answering it too late. The
server refuses the same submission with the same arithmetic — the bounds live in
`SETTING_FIELDS` next to the rules that enforce them, so the form, the CLI and
the action cannot disagree about what is allowed.

Every change is a `settings` row in the transaction log, and the screen reads
them back. A rule nobody can see being changed is the one a league argues about.

### The trade deadline

A date on the league rather than a count of days, which is the shape `settings`
did not carry until now. Nothing else stopped a team out of contention from
selling in March.

It binds the **handshake**, not the execution. Trading closes after the deadline
day — inclusive, compared in roster days, the same unit every tenure in this
system is dated in — so nothing new can be offered and nothing standing can be
agreed. But a deal agreed on deadline day still executes when its review window
closes, even if that is the day after. The window belongs to the league and the
commissioner; voiding a deal two managers legitimately struck because somebody
else's review period straddled midnight would punish them for a setting they do
not control.

Rejecting an offer still works after the deadline. An inbox nobody can clear is
worse than a stale offer.

An offer that outlives the deadline is expired by the next reader, dated to the
deadline rather than to whenever somebody looked — the fifth way a deal does not
happen, and settled on read like the other four:

```
   1  expired   Team 1: Player 3  ⇄  Team 2: Player 7
      the trade deadline passed
```

Two clocks can reach one offer and the honest answer is whichever got there
first. An offer nobody answered in January died of neglect whatever a March
deadline says; one that would have stood until Saturday died of the deadline on
Thursday. The deadline pass runs first and only claims offers that were still
alive when it arrived; the ordinary expiry takes the rest, dated to its own
`expires_at`.

## Next

The design backlog — drawing the games cap, and the persisted critique snapshot
in `.impeccable/critique/`, which predates `/commissioner`, `/draft`, `/waivers`,
`/trades` and `/commissioner/settings`.

Then the gaps a settings screen does not close. A trade cannot include FAAB
dollars or draft picks, only players, and there is no counter-offer — countering
is a rejection plus a new offer. The draft order cannot be edited once drawn.
The commissioner cannot rename or add a team from the app, or change a member's
role. A manager cannot change their own password or username from a screen, only
the commissioner can, and only from the CLI.

And nothing emails anybody. A manager offered a deal overnight, or whose claim
settled at 9am, finds out by opening the app.
