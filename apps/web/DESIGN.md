---
name: Illini Fantasy Hoops
description: A private Illinois staff fantasy league, hung like the program's banners in the State Farm Center rafters.
colors:
  arena-navy: "#0C1A33"
  deep-navy: "#081226"
  sunken-well: "#0A1529"
  illini-felt: "#13294B"
  felt-head: "#17305A"
  raised-felt: "#1C3866"
  banner-white: "#F4F6FA"
  chalk: "#BCC8DC"
  faded-chalk: "#95A6C1"
  steel: "#2B4166"
  steel-soft: "#223A5F"
  steel-hard: "#5B6B80"
  steel-mark: "#A9B8CF"
  illinois-orange: "#FF5F05"
  orange-ink: "#FF7A30"
  orange-wash: "color-mix(in srgb, #FF5F05 15%, #13294B)"
  orange-line: "color-mix(in srgb, #FF5F05 48%, #13294B)"
  live-mint: "#4FD1A5"
  caution-amber: "#F2B134"
  coral: "#FF8A7A"
typography:
  varsity-display:
    fontFamily: "Graduate, Georgia, serif"
    fontSize: "4.25rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0em"
  varsity-numeral:
    fontFamily: "Graduate, Georgia, serif"
    fontSize: "2.25rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0em"
  banner-mark:
    fontFamily: "Graduate, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.1
  headline:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.22
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  reading:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  score:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  label:
    fontFamily: "Barlow Condensed, Barlow, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.illinois-orange}"
    textColor: "{colors.arena-navy}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.orange-ink}"
    textColor: "{colors.arena-navy}"
  button-default:
    backgroundColor: "{colors.illini-felt}"
    textColor: "{colors.banner-white}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-default-hover:
    backgroundColor: "{colors.felt-head}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-sm:
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.illini-felt}"
    textColor: "{colors.banner-white}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  pill:
    backgroundColor: "{colors.sunken-well}"
    textColor: "{colors.chalk}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    height: "21px"
  pill-mine:
    backgroundColor: "{colors.orange-wash}"
    textColor: "{colors.orange-ink}"
  pill-free:
    backgroundColor: "transparent"
    textColor: "{colors.chalk}"
  card:
    backgroundColor: "{colors.illini-felt}"
    rounded: "{rounded.lg}"
    padding: "16px 24px"
  card-head:
    backgroundColor: "{colors.felt-head}"
    padding: "16px 24px"
  banner:
    backgroundColor: "{colors.illini-felt}"
    textColor: "{colors.banner-white}"
    padding: "12px 8px 26px"
    width: "84px"
  banner-mine:
    backgroundColor: "{colors.raised-felt}"
    textColor: "{colors.illinois-orange}"
  matchup-row:
    backgroundColor: "{colors.illini-felt}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  matchup-row-mine:
    backgroundColor: "{colors.raised-felt}"
    textColor: "{colors.illinois-orange}"
  stat-tile:
    backgroundColor: "{colors.illini-felt}"
    typography: "{typography.varsity-numeral}"
    padding: "16px 24px"
  nextup:
    backgroundColor: "{colors.raised-felt}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Illini Fantasy Hoops

## Overview

**Creative North Star: "The Rafters"**

The league hangs the way the program hangs its banners in the State Farm Center: every fantasy team is a banner of navy felt, and the standings are the row of banners overhead. The ground is the arena ceiling at night, one navy with a single soft wash of light behind the masthead. Panels are Illini Blue felt hung on it. Steel is the line of the rafters: rules, borders, wires. White ink is the lettering. Orange is the light that tells you which banner is yours.

It is a working stat sheet, not a broadcast. Density is high and even: tables keep one reading size and rank by weight and case, lists keep one row shape, and state is carried by form before colour. The thing you came for is lit and lifted; everything else steps back a shade until you point at it. There is one theme, navy, and no light mode.

The system refuses the category's dark scoreboard dashboard: no big VS split, no neon accent, no grid of identical cards.

**Key Characteristics:**
- Navy ground, Illini Blue felt panels, steel rules, banner-white ink; one navy theme only.
- Illinois Orange spent on exactly three things: your team, scores, and the primary action.
- Stitching is state: solid for actual, dashed for projected, doubled for final.
- A varsity block (Graduate) for banner monograms and headline numerals only; Barlow for everything else.
- Lengths and positions are exact quantities, never decoration.
- Focus lifts; the rest dims.

## Colors

A deep two-blue navy palette with steel lines and a single orange light.

### Primary
- **Illinois Orange** (`illinois-orange`): the official orange. Spent only on your team (your banner's stitching and monogram, your matchup's border and score, your avatar ring, your rows' wash), on scores, and on the primary action button. It clears 4.5:1 on navy at every size, so it has no darker text twin.
- **Orange Ink** (`orange-ink`): the hover and text tint of the same orange; primary-button hover and `mine` pills. Link hover is white ink with an underline, not orange.
- **Orange Wash / Orange Line** (`orange-wash`, `orange-line`): orange mixed into felt for the background and border of things that are yours (your rows at 70%, the on-the-clock bar, the next-action panel's stitching).

### Secondary
- **Live Mint** (`live-mint`): happening now, and up-deltas. Never the accent: the accent means "yours", live means "in progress", and the two share rows. Always paired with a word or a breathing dot, never colour alone.

### Tertiary
- **Caution Amber** (`caution-amber`): notices, empty roster slots, the paused draft clock.
- **Coral** (`coral`): critical state, down-deltas, a player ruled out.
Each carries its own wash (14%) and line (42%) mixed into felt, matching the orange pattern.

### Neutral
- **Arena Navy** (`arena-navy`): the page ground.
- **Deep Navy** (`deep-navy`): the masthead (at 92% under a blur) and the active day in the day strip.
- **Sunken Well** (`sunken-well`): insets inside a panel: pills, segmented-control trough, meter tracks, skeletons.
- **Illini Felt** (`illini-felt`): every panel, card, banner, matchup row, input and default button.
- **Felt Head** (`felt-head`): panel and table heads, row hover.
- **Raised Felt** (`raised-felt`): the lifted thing: your banner, your matchup, the next-action panel, hovered banners.
- **Banner White** (`banner-white`): primary ink. **Chalk** (`chalk`): secondary ink. **Faded Chalk** (`faded-chalk`): captions, labels, ranks, uncounted rows.
- **Steel** (`steel`): panel borders and table-head rules. **Steel Soft** (`steel-soft`): row dividers and quiet insets. **Steel Hard** (`steel-hard`): the rafter rule and wires, projected and final stitching, the masthead underline, hovered borders, free-agent chips. **Steel Mark** (`steel-mark`, `--steel`): the fill of chart marks, meter bars, sparks and the range band, so data never reads as yours.

### Named Rules
**The Three Spends Rule.** Orange goes to your team, scores, and the primary action, and nowhere else. Free-agent chips, chrome, nav markers, sort headers, checked pickers, bracket winners and every chart mark (bars, sparks, range bands, tick) are steel or white ink. If a new use of orange cannot be named as one of the three, it is steel.

**The Live Is Not Yours Rule.** Live mint and orange never substitute for each other; a row can be both yours and live, and must read as both.

## Typography

**Display Font:** Graduate (varsity block, with Georgia fallback)
**Body Font:** Barlow (with ui-sans-serif, system-ui)
**Label Font:** Barlow Condensed (with Barlow)

**Character:** Graduate is the lettering sewn on a banner; Barlow is the stat sheet underneath it. There is no serif for prose and no mono for numbers: stat columns are Barlow with tabular figures.

### Hierarchy
- **Varsity Display** (Graduate 400, `varsity-display` down to 3rem/2.25rem on phones): the largest headline numerals.
- **Varsity Numeral** (Graduate 400, 2.25rem, also 3rem): headline numbers a reader came for: stat-tile values (set at 1.75rem), matchup scores (1.375rem, 1.0625rem on phones), and every score at the large step and above.
- **Banner Mark** (Graduate 400, 1.75rem): the team monogram stitched on a banner.
- **Headline** (Barlow 700, 2.25rem, -0.02em, balanced): page titles.
- **Title** (Barlow 700, 1.0625rem): section and panel heads; the next-action heading steps up to 1.375rem.
- **Body** (Barlow 400, 0.9375rem, 1.5): page text; prose capped at 66ch, empty-state lines at 48ch.
- **Reading** (Barlow 400, 0.875rem, tabular): the one size for every table cell, list row, and player row.
- **Score** (Barlow 700, tabular, 0.95 line-height, 1.0625–1.75rem): small and mid scores, and every ticking clock.
- **Label** (Barlow Condensed 700, 0.75rem, 0.07–0.09em, uppercase): column heads, stat-tile captions, banner rank, matchup state ("Final", "Live", "Projected"), slot chips, and the caption above a value.

### Named Rules
**The Varsity Block Rule.** Graduate is for banner monograms and headline numerals only: stat-tile values, matchup scores, and scores at the large step and up. Never for body, labels, names, or a clock that ticks every second; a ticking clock is tabular Barlow so its digits keep their width.

**The One Reading Size Rule.** Every table and list reads at one size (0.875rem). Rank comes from weight (700 for the name that matters, 400 for the uncounted) and case (condensed caps for heads), never from a second size.

**The Caps Are Labels Rule.** Uppercase is only the condensed label voice, attached to a value, a column, or a state. It is not a kicker above a heading.

## Layout

A centred shell (1240px max, 24px gutters, 16px under 640px) under a sticky 60px masthead. The desk layout is a split: the main column at 1.9fr beside a rail at minmax(300px, 1fr) with 24px between; above 1000px the rail is sticky at 76px so it stays beside what you are reading, below 1000px it stacks under. Grids of 2/3/4 columns collapse to 2 at 620px and 1 at 420px.

Spacing runs on a 4px-based scale (`s-1` 4px through `s-8` 64px). Panels separate by 24px; section heads sit 32px above their content and 12px over it; rows pad 12px by 16px. Below 640px the bottom navigation bar takes over from the top nav and panel padding drops one step.

On Home the rafter strip spans the shell width above the split; on a phone it bleeds to the screen edges and scrolls sideways at 78px per banner rather than shrinking banners.

**The Exact Length Rule.** A length or a position on screen is a quantity: a banner's drop is its points-for against the league's most (148px plus up to 96px), a range strip's tick is the projection. Nothing grows or sweeps in to look lively, and a bar whose scale changes with the page is removed rather than kept as decoration.

## Elevation & Depth

Mostly flat felt on a navy ground, with depth carried by tone first: sunken well below felt, felt head above it, raised felt for the lifted thing. Shadows are soft and dark, used to seat a panel on the ground and to lift the one item that is yours.

### Shadow Vocabulary
- **Seat** (`box-shadow: 0 1px 2px rgba(0,0,0,.30)`): resting cards and panels, the primary button, the active segment.
- **Lift** (`box-shadow: 0 1px 2px rgba(0,0,0,.30), 0 6px 16px -8px rgba(0,0,0,.55)`): your matchup row, raised cards, the draft clock bar.
- **Float** (`box-shadow: 0 2px 6px rgba(0,0,0,.35), 0 18px 40px -16px rgba(0,0,0,.70)`): the player-card modal and menus.

### Named Rules
**The Focus Lifts Rule.** In a list of peers, yours is raised felt with the lift shadow and an orange border; the others sit at 78% opacity and come back to full on hover or focus.

## Shapes

Felt is cut, not moulded: small radii (4px chips and small buttons, 6px buttons, inputs and rows, 8px panels, 12px for large sheets). Banners are the one silhouette: a flat top hung from two wires, a swallowtail cut 16px up from the bottom edge, and an inset stitched border 5px in.

Borders are 1px steel. Stitching is the only heavy border, and it carries state.

**The Stitching Rule.** The border a number wears says what kind of number it is: solid 2px for actual, dashed 2px for projected, 4px double for final. Dashes are reserved for projections and pre-season banners (and the waiting draft clock); empty states, dividers, and decoration never dash.

**The No Side-Stripe Rule.** No coloured stripe down a row's or card's edge. School colour rides on the avatar's outer ring. The rafters' full-width 4px steel rule is a deliberate exception: it is the beam the banners hang from, spans the whole width, and is not a side tab.

## Components

### Buttons
Plain, solid, and cut small.
- **Shape:** gently squared (6px; 4px at the small 32px size).
- **Primary:** Illinois Orange fill with arena-navy text, 700 weight, 40px tall, 16px side padding, seated shadow. One per view.
- **Hover / Focus:** primary brightens to orange ink; default goes to felt head with a steel-hard border; pressed nudges down 1px. Focus is a 2px orange outline 2px out (banner white inside the masthead).
- **Default:** felt fill, steel border, banner-white text. **Ghost:** transparent, chalk text, sunken on hover. **Danger:** turns coral only on hover.

### Chips
- **Style:** condensed 700 caps-height label on the sunken well, 4px corners, 21px tall.
- **State:** `live`, `warn`, `crit` take their wash, ink and line; `mine` takes orange wash and orange ink; `free` is transparent with a steel-hard border and chalk text, never orange. Slot chips are fixed-width condensed tokens on raised felt so a column of them stays a column.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** Illini felt, with a felt-head band for the header.
- **Shadow Strategy:** seat at rest; lift when raised (see Elevation).
- **Border:** 1px steel; dividers inside are steel soft.
- **Internal Padding:** 16px by 24px (16px on phones).

### Inputs / Fields
- **Style:** felt fill, 1px steel border, 6px corners, 40px tall, 0.875rem Barlow; number inputs tabular.
- **Focus:** border goes to orange ink with a 3px orange ring at 18%.
- **Disabled:** 45–50% opacity.

### Navigation
The masthead is deep navy at 92% under a blur, with a 1px steel-hard underline. The Block I and a condensed wordmark sit left; destinations are 0.875rem Barlow 600 at 66% white, full white on hover and when active, active also getting an 11% white tint. Below 640px a thumb-height bottom bar with five destinations replaces it, and an overflow sheet holds the rest. The Block I appears in the header only.

### The Rafters (signature)
A single 4px steel-hard rule across the width with a banner per team hung from two 10px wires, in standings order. Each banner is felt with a stitched inset, a condensed rank, a Graduate monogram, the name, the record and points-for; its drop is exact points-for. Before a week settles every banner hangs at the same short drop with dashed stitching and no rank. Yours is raised felt with orange stitching, monogram and rank.

### Matchup List (signature)
Every game of the week as one list instead of a VS split. Your game is first, raised, bordered 2px orange and lifted; the rest dim to 78%. Your side is always left. Each score sits in a stitched box in Graduate: plain once scored, dashed and chalk when it is still a projection, doubled when final. The centre holds a condensed state word and the model's win chance.

### Season Line (signature)
The season as one transit line of weeks: a 3px steel line through 12px stations. Past weeks are filled faded chalk, the current week is solid white ink with a soft halo, weeks ahead are outlined. Each station opens that week.

### Stat Tile
A caption in the label voice over a Graduate numeral, tiles butted together with 1px steel-soft gaps.

### Next Up
The one thing worth doing now: raised felt with solid orange-line stitching, the heading as the instruction, one line of reason, and the primary button.

### Empty State
A quiet steel-soft inset with a heading, one line at 48ch, and the way forward. No icon tile, no dashed border.

### Small Banners: On Deck and Seats
The rafters' banner at a third of the size: 68px felt with the notched foot, a condensed pick number, a Graduate monogram and a condensed name. Under the draft clock they hang in pick order to show the snake (dashed, because those picks are still to come; yours in orange). On the commissioner page the same banners are the seats, solid when a manager holds one and dashed while it is open.

### Pennant
A single team's banner at the head of its page (92 × 132px, no wires), with rank only once a week has settled. A school's page hangs the same shape in the school's own colour with its initials. The way in (sign-in, invite links, commissioner-only notices) hangs one steel-stitched banner with the Block I over the heading.

### Leader Bar
A steel bar beside a leader's score whose length is that score over the top score on the board. Your players' bars are orange line. Hidden under 560px, where the number alone carries it.

### Rail Layout
Pages with one job and several records (trades, waivers, the draft room) use a 1.6 : 1 main column and rail. The job takes the main column; offers, budgets, the queue and history sit in the rail, sticky on a desk. An empty record is a sentence, not an empty panel, and a count pill is only drawn when the count is not zero.

### Arrow
A drawn 14px stroke arrow (rotated for direction) for every icon-use arrow: section links, buttons. Typed arrows render in whatever weight the text happens to be.

## Do's and Don'ts

### Do:
- **Do** spend orange only on your team, scores, and the primary action; make everything else steel.
- **Do** stitch numbers by kind: solid for actual, dashed for projected, 4px double for final.
- **Do** set banner monograms and headline numerals in Graduate, and everything else in Barlow or Barlow Condensed.
- **Do** keep tables and lists at one 0.875rem reading size, ranking by weight and case.
- **Do** make lengths exact: a banner's drop is points-for, a tick is the projection.
- **Do** lift the reader's own item (raised felt, lift shadow, orange border) and dim its peers to 78%.
- **Do** put school colour on the avatar's outer ring.
- **Do** use the drawn Arrow glyph wherever an arrow acts as an icon.
- **Do** pair live mint with a word or a breathing dot.

### Don't:
- **Don't** use orange for free-agent chips, chrome, or neutral state.
- **Don't** set a ticking clock, a name, or a label in Graduate.
- **Don't** use a dashed border for anything that is not a projection or a pre-season banner, including empty states.
- **Don't** put an icon tile in an empty state.
- **Don't** add coloured side-stripes to rows or cards.
- **Don't** introduce a second reading size in a table.
- **Don't** build a VS split, a neon accent, or a grid of identical stat cards.
- **Don't** add a light theme.
- **Don't** type an arrow character as an icon.
