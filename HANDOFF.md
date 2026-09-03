# Handoff — Phase 4, the draft

Phases 1 through 4 are done and verified against the live Neon branch. The
README is the reference for how the system works; this file is only what the
next person needs that the README does not say.

## State

| | |
|---|---|
| Branch | `phase-1-scoring-model` — misnamed, carries Phases 1 through 4 |
| Tests | 84 passing (`npm test`, needs local Postgres — see README) |
| Typecheck | clean (`npm run typecheck`) |
| Build | clean (`npm run build`) |
| Production data | Neon `floral-shape-81709658`, 5 ingested game days, Feb 10–14 2026 |
| Leagues | 1 `Illini Fantasy` (Phases 2–3, seeded rosters) · 2 `Draft Night` (Phase 4, really drafted) |

`npm test` and the web app are separate: the root tsconfig excludes `apps/**`,
so `npm run typecheck` covers the packages and `npx tsc --noEmit` inside
`apps/web` covers the app.

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

Sign-in has no mail credentials, so the magic link is printed to the server log.
`AUTH_URL` pins the port the link points at — if 3000 is taken, `next dev` moves
and the link does not.

## Where it stopped

Done through Phase 4: the draft. A materialised snake board, a clock that is
settled on read rather than by a daemon, per-manager queues, a slot-aware
autopick, and `/draft` — the room, with the commissioner's start and pause.
Picks claim through `claimPlayer`, so the draft shares the league's ownership
index rather than keeping its own.

Not done, in the order I would take them:

1. **Waivers.** `roster_slot` and `transaction` model the claim/release
   lifecycle and `claimPlayer` / `releasePlayer` enforce it, but nothing
   schedules or resolves a FAAB bid. This is now the largest gap.
2. **Draw the games cap** and the rest of the design backlog — see
   `.impeccable/critique/` for the persisted snapshot, which `/polish` reads
   automatically. Note that the critique predates `/commissioner` and `/draft`,
   so its heuristic scores do not cover either.

Smaller gaps. The draft: no way to edit the order once drawn, no pick trading,
and snake or nothing — no keeper or auction format. The commissioner surface: no
way to rename or add a team from the app, no way to change a member's role, and
no resend — re-inviting an address is the resend, which is correct but is
labelled nowhere.

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

## Things that will mislead you

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
- **A re-ingest must never touch league data.** That is why the migrations are
  split at `001_sources` / `003_league`, and why `player_game_stat` is only ever
  written by ingest and `player_game_score` only by scoring.
- **The draft does not use `ILLINI_NOW`, and must not.** Every other clock in
  the app is the pinned one, so that a finished season browses correctly. The
  draft is a live event: pinning it means no deadline passes and no autopick is
  ever made. If you add a draft screen, take `new Date()` deliberately.
- **Nothing runs the draft clock but a reader.** There is no worker. An open
  room polls every five seconds; a closed one costs nothing, and the next reader
  makes every pick that was due at the time it was due. If picks seem not to be
  happening, the question is who last read the draft, not what crashed.
- **Three timezone bugs have been fixed in this codebase and they keep coming
  back in new forms:** the CBBD query window, the stored game date, and the
  browser-vs-server tip-off render. If something is off by a day or by hours,
  suspect this first.

## Open question for the owner

The 2026-27 season is still not loaded at CBBD (`npm run pool` reports
coverage). The draft pool currently comes from 2025-26 rosters plus an
incomplete NCAA CSV. Someone has to poll weekly and switch over when it
populates, or the draft board is built on last year's teams.
