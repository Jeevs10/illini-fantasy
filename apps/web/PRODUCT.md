# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Members of the Illinois men's basketball program staff, playing a private fantasy league against each other. They already read the program's forward model every morning in the staff Daily Update email and on the staff site (illini-prospect-analyzer.org), so they know the players, the Player Score, and the model's vocabulary better than any fantasy audience would.

They use it on both devices about equally: the phone for checking scores and making moves during games and between other work, a laptop for draft night, roster planning, and trades.

## Product Purpose
A private men's college basketball fantasy league scored on the staff's own forward model. Managers draft real players, every rostered player scores every game, and teams meet head-to-head each week. Waivers run as a blind FAAB auction, trades go through a review window, and the commissioner tunes every setting from a screen.

Success is a league the staff actually come back to all season: the scores are trusted because they are the same numbers the staff already work with, and the site is where they check on the league between games.

## Positioning
The only fantasy game scored on the Illinois program's own player model. A game's fantasy points are the opponent-adjusted box value (`valAdj`) the Daily Update ranks performances by, and projections and draft order come from the same forward model's projected Player Score. No public fantasy product can show these numbers, and the players in it are the staff's own scouting and recruiting world.

## Operating Context
- The forward model refreshes every morning (launchd, 6:15am, in-season Nov 1 – Apr 15) and pushes a feed to the app; each game's score is stored once and never recomputed.
- Scoring weeks run Sunday through Saturday. All 12 rostered players count; there is no lineup to set. Adds, drops, trades, and IR moves take effect at the next weekly lock (Yahoo-style).
- The draft is ordered by projected Player Score and is likely held on a Saturday.
- Players and schools link out to the staff site, Prospect Analyzer, for the full scouting profile.
- There is no background worker: draft clock, waivers, and trades settle on the first request past their deadline.

## Capabilities and Constraints
- Draft room, rosters, weekly head-to-head matchups, standings and playoffs, leaders, a player pool with projections, player cards, school pages, FAAB waivers, trades with a review window, commissioner settings, invites.
- Stack: Next.js 16 App Router, React 19, Postgres (Neon), domain logic in `packages/*`. Deployed on Vercel.
- Terminology: Player Score (the model's projected rating, about 14–91), fantasy points (per-game `valAdj`, about 0–15), weekly lock, FAAB, review window, IR.
- Undecided: the number of teams in the 2026–27 league, and the draft date.

## Brand Commitments
- The league is internal to the Illinois basketball program, so Illinois marks (the Block I) and the official orange and blue are fair to use.
- The name is Illini Fantasy Hoops.
- The staff site is referred to as "Prospect Analyzer" in the interface.

## Evidence on Hand
- Real data: every 2026–27 D1 roster with projected Player Scores and ranges, and a game-by-game projection for every scheduled game, from the forward feed.
- Player headshots via ESPN ids carried by the feed; school colors in the `team` table.
- No real game results yet (the season starts Nov 1, 2026). Do not fabricate scores, results, standings, or manager quotes.

## Product Principles
1. The model is the authority. Every number shown comes from the forward model and is labelled as projected or actual; the app never invents its own estimate.
2. Built for people who know the game. Staff read box scores and ratings for a living; show the real numbers and skip the explanations a casual fan would need.
3. Inside the program. It should feel like part of Illinois basketball, not a generic fantasy app with an orange accent.
4. A week has a rhythm. Sunday's lock, games through the week, Saturday's slate. The screens should follow it, before the season as much as during it.
5. Equal on both devices. Phone use during games and desk use for the draft and trades are both primary; neither is the cut-down version.
