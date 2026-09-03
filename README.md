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

## Next

Phase 2 remainder: schema, ingest crons, idempotent re-scoring.
