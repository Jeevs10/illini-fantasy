# Handoff — Phase 3, plus the commissioner surface

Phases 1 through 3 are done and verified against the live Neon branch. The
README is the reference for how the system works; this file is only what the
next person needs that the README does not say.

## State

| | |
|---|---|
| Branch | `phase-1-scoring-model` — misnamed, carries Phases 1, 2 and 3 |
| Tests | 69 passing (`npm test`, needs local Postgres — see README) |
| Typecheck | clean (`npm run typecheck`) |
| Build | clean (`npm run build`) |
| Production data | Neon `floral-shape-81709658`, 5 ingested game days, Feb 10–14 2026 |

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

Done: membership and invites, league-wide exclusive player ownership, per-game
tip-off locking, five manager screens (matchup, my team, player pool, player
card, standings), and the commissioner surface — `/commissioner` and
`/join/:token`, which together take invites off the CLI.

Not done, in the order I would take them:

1. **Draft room (Phase 4).** The hard deadline — the season tips in November and
   a draft has no second chance. Nothing exists yet.
2. **Waivers.** `roster_slot` and `transaction` model the claim/release
   lifecycle and `claimPlayer` / `releasePlayer` enforce it, but nothing
   schedules or resolves a FAAB bid.
3. **Draw the games cap** and the rest of the design backlog — see
   `.impeccable/critique/` for the persisted snapshot, which `/polish` reads
   automatically. Note that the critique predates `/commissioner`, so its
   heuristic scores do not cover it.

Smaller things the commissioner surface leaves open: there is no way to rename a
team or add one from the app, no way to change a member's role, and no resend —
re-inviting the same address is the resend, which is correct but is not labelled
as such anywhere.

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
- **Three timezone bugs have been fixed in this codebase and they keep coming
  back in new forms:** the CBBD query window, the stored game date, and the
  browser-vs-server tip-off render. If something is off by a day or by hours,
  suspect this first.

## Open question for the owner

The 2026-27 season is still not loaded at CBBD (`npm run pool` reports
coverage). The draft pool currently comes from 2025-26 rosters plus an
incomplete NCAA CSV. Someone has to poll weekly and switch over when it
populates, or the draft board is built on last year's teams.
