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

## Next

The web app: player pool, player card with the six-block breakdown, matchup
view, draft room.
