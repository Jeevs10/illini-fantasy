# Illini Fantasy Hoops

A private fantasy league for men's college basketball. Managers draft real
players, set a lineup that locks per game at tip-off, and play weekly head-to-head
matchups scored on the CBB Player-Score model. Waivers run as a blind FAAB
auction, trades go through a review window, and the commissioner tunes every
league setting from a screen.

There is no background worker. The draft clock, waiver runs, and trade
executions are all *settled on read* — the first request past a deadline does the
work that was due, at the time it was due — so the league stays correct whether
someone refreshed all night or nobody looked for a week.

For the phase-by-phase design history and the reasoning behind each decision, see
[DEVLOG.md](DEVLOG.md).

## Stack

- **Web app** — Next.js 16 (App Router), React 19, in `apps/web`
- **Domain logic** — TypeScript packages in `packages/*`, imported directly by
  both the web app and the CLI scripts, so a screen cannot disagree with a
  settlement
- **Database** — Postgres (Neon in production), plain SQL migrations, `pg` driver
- **Data sources** — Barttorvik (stat spine), CollegeBasketballData (teams,
  ratings, schedule), RotoWire (injuries), NCAA CSV (recruits)
- **Tooling** — npm workspaces, `tsx` for scripts and tests, `tsc -b` for
  typecheck

## Layout

```
packages/scoring     the six-block Player-Score model; weights and bounds are data
packages/sources     clients for Barttorvik, CBBD, RotoWire
packages/crosswalk   resolves one source's player id to another's
packages/db          migrations and the data layer
packages/ingest      pulls a night of games into the database
packages/league      draft, lineups, settlement, waivers, trades, settings
scripts/*            CLI entry points for every package (see Commands)
apps/web             the Next.js app
```

## Prerequisites

- **Node 20+**
- **Postgres** — only for running the test suite and for local end-to-end work.
  Production uses Neon.
- **A CollegeBasketballData API key** — for ingesting real data. Free tier is
  1,000 calls/month; the client caches every response to `.cache/` and tracks the
  remaining quota. Not needed just to run the app against an already-populated
  database.

## Setup

```sh
npm install
```

Create `.env.local` (gitignored) with:

```sh
DATABASE_URL=postgresql://…            # pooled connection
DATABASE_URL_UNPOOLED=postgresql://…   # direct connection; migrations use this
CBBD_API_KEY=…                         # only for ingest
AUTH_SECRET=…                          # any long random string
AUTH_URL=http://localhost:3000         # must match the port you run dev on
```

### Database

Migrations run against any Postgres. A disposable local one:

```sh
docker run -d --name illini-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=illini \
  -p 55432:5432 postgres:18-alpine
export DATABASE_URL=postgresql://postgres:dev@localhost:55432/illini

npm run migrate      # applies pending migrations; idempotent
```

The db test suite creates and drops its own `illini_test` database.

Production is a Neon project linked with `neon link`, which writes and keeps
`.env.local` current. Migrations prefer `DATABASE_URL_UNPOOLED` because Neon's
pooler multiplexes sessions and DDL wants a dedicated connection.

## Running the app

```sh
npm run dev          # http://localhost:3000
```

Two things that will otherwise cost you an afternoon:

- **`AUTH_URL` pins the port.** `next dev` falls through to the next free port if
  3000 is taken, but the invite link on `/commissioner` is built from `AUTH_URL`.
  Free port 3000 or move `AUTH_URL` to match.
- **One `next dev` per directory.** A second one exits and names the PID of the
  first. To run a second copy, `npm run build` then `npx next start --port 3006`.

### Browsing a finished season

The sample data is February 2026, so against the real clock every game has
tipped off and every lineup is frozen. Two env vars unpin the clock:

```sh
ILLINI_TODAY=2026-02-14                 # the date the app treats as today
ILLINI_NOW=2026-02-14T18:30:00Z         # the instant the lineup lock measures against
```

`ILLINI_TODAY` alone keeps the real time of day. Set both to freeze a specific
moment — useful for screenshots and for seeing the lineup controls at all.

## Screens

| route | |
|---|---|
| `/home` | the live matchup, tonight's slate, and what needs you |
| `/team` | tonight's startable players, per-game locks, slot validation |
| `/league` | the week's matchup, scored live from stored player scores |
| `/players` · `/players/:id` | the pool ranked by season Player-Score; per-night game log |
| `/standings` · `/playoffs` | settled weeks only |
| `/waivers` | the wire, your sealed claims, every team's budget |
| `/trades` | propose, answer, review, history |
| `/draft` | the draft room — clock, best available, your queue, the board |
| `/commissioner` · `/commissioner/settings` | invites, seats, and every league number — commissioner only |
| `/signin` · `/join/:token` | sign in; redeem an invite |

## Commands

| command | |
|---|---|
| `npm run dev` | web app |
| `npm run build` | production build |
| `npm test` | test suite (needs a local Postgres) |
| `npm run typecheck` | `tsc -b` across packages and scripts |
| `npm run migrate` | apply pending migrations |
| `npm run ingest -- <verb>` | pull source data (`setup`, `schedule`, `night`, `range`, `link`, `injuries`) |
| `npm run league -- <verb>` | league operations (`create`, `draft`, `lineups`, `settle`, `standings`, `invite`, `waivers`, `trades`, `settings`, `passwd`, …) |
| `npm run season` | build and play a full 2025-26 league over ingested data |
| `npm run backtest` | the scoring-model validation checks |
| `npm run budget` | CBBD quota against projected usage |
| `npm run pool` | draft-pool coverage report |
| `npm run crosswalk` | crosswalk accuracy against live RotoWire injuries |

Passwords and usernames are managed by the commissioner from the CLI — there is
no self-serve reset and nothing emails anybody:

```sh
npm run league -- passwd <username|email> <password>
```

## Auth

A username and a password, stored in `app_user` (scrypt, parameters travel with
the hash). Sessions are rows in `auth_session` keyed by a random httpOnly
cookie; signing out is a `DELETE`. The invite link hands over a *team*, not a
session — redeeming one is where a manager picks their username. The whole of it
is `apps/web/lib/auth.ts`.
