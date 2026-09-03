# Illini Fantasy Hoops

College basketball fantasy league scored on the CBB Player-Score model.

Plan: https://claude.ai/code/artifact/cb1d0d3b-d6b2-45e8-bd00-f2efff25a125

## Status — Phase 1 (prove the scoring)

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

## Phase 3 — league core

Phase 2 proved the mechanics with one user owning all ten teams, lineups
auto-filled the morning after, and nothing stopping two managers from rostering
the same player. Phase 3 makes each of those real.

```sh
npm run league -- create 2026 "Illini Fantasy" 10 you@example.com
npm run league -- invite 1 manager@example.com     # prints the token once
npm run league -- accept <token> manager@example.com "Manager Name"
npm run league -- members 1
npm run league -- roster 3
npm run league -- lineups 1 20260214              # auto-fill, locks respected
```

### Membership and invites

`app_user` doubles as the Auth.js user table rather than sitting beside a second
one. The project already carries a crosswalk because four sources mint their own
player ids; there was no reason to repeat that for humans. Sessions, accounts
and magic-link tokens hang off it in `auth_*` tables.

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
  next free port if 3000 is taken, and the magic link is built from `AUTH_URL`,
  not from the port actually in use — so the link lands on a dead port and
  sign-in silently fails. Either free 3000 or move `AUTH_URL` with it.
- **`AUTH_SECRET` is per-machine.** It lives in gitignored `.env.local`; a fresh
  clone has to generate one:
  `node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'`

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

Magic links, no passwords. In a private twenty-person league the invite and the
sign-in are the same mechanism: an email to an address the commissioner already
named.

`app_user` doubles as the Auth.js user table rather than sitting beside a second
one, so `league_member.user_id` and a session point at the same row. The adapter
in `apps/web/lib/adapter.ts` maps Auth.js onto this schema's snake_case columns;
redeeming a link is a `DELETE ... RETURNING`, so two clicks race in Postgres
rather than in Node.

With no `AUTH_RESEND_KEY` set the link is printed to the server log instead of
emailed — development should not be blocked on a verified sending domain.

### Screens

| route | |
|---|---|
| `/league` | the week's matchup, scored live from stored player scores; games past the cap dimmed, not hidden |
| `/team` | tonight's startable players, with per-game locks and slot validation |
| `/draft` | the draft room — clock, best available, your queue, the board |
| `/players` | the pool, ranked by season Player-Score, with ownership |
| `/players/:id` | the game log, each night broken into its six blocks |
| `/standings` | settled weeks only |
| `/commissioner` | invites, revocation, and who holds which seat — commissioner only |
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

`/join/:token` is the other half. It insists on signing in first and takes the
address from the session rather than from a form field, which is the point: a
magic link is proof that whoever holds the invite also holds the mailbox it was
addressed to. `acceptInvite` compares the two at fixed length, so a stolen link
is worth nothing without the inbox. Signing in from that page carries the token
in `callbackUrl`, so the invite is still there when the manager comes back.

The page says which of the four states it is in — spent, expired, addressed to
somebody else, or ready — rather than failing the same way for all of them. Only
"spent" is deliberately vague: already redeemed, revoked and mistyped look
identical, since telling them apart only helps someone guessing.

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

## Next

Waivers. `roster_slot` and `transaction` already model the claim/release
lifecycle and `claimPlayer` / `releasePlayer` enforce it, but nothing yet
schedules or resolves a FAAB bid.

After that, the rest of the design backlog — drawing the games cap, and the
persisted critique snapshot in `.impeccable/critique/`.
