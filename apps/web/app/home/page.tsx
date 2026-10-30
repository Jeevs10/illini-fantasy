import Link from "next/link";
import {
  availabilityFor, claimsFor, eligibleSlots, gameState, leagueActivity, listTrades,
  activeLimit, draftFor, rankedStandings, rosterOn, scoresOn, seasonSchedule, startableOn, weekMatchups,
  type PlayerAvailability, type Slot, type Startable,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Glyph } from "../ui/glyphs.tsx";
import { AvailabilityTag, Empty, ET, LiveTag, Score, SectionHead } from "../ui/bits.tsx";
import { Dot, PlayerRow } from "../ui/playerrow.tsx";
import { ActivityFeed } from "../ui/activity.tsx";
import { MatchupList } from "../ui/matchups.tsx";
import { Rafters, type RafterTeam } from "../ui/rafters.tsx";
import { SeasonLine } from "../ui/seasonline.tsx";
import { Arrow } from "../ui/glyphs.tsx";

export const dynamic = "force-dynamic";

/**
 * Home answers one question before anything else: how is my team doing right
 * now. Everything below the scorebug is the follow-up — who is on the floor
 * tonight, and what needs a decision before it costs points.
 */
export default async function HomePage() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, configId, settings, fantasyTeamId, fantasyTeamName } = viewer.membership;
  const day = viewDate();
  const now = viewNow();

  const matchups = await weekMatchups(db, { leagueId, configId, on: day, settings, now });

  const [tonight, standingsTable, trades, claims, roster, activity, draft, schedule] = await Promise.all([
    fantasyTeamId === null ? [] : startableOn(db, { fantasyTeamId, day, configId, now }),
    rankedStandings(db, leagueId),
    fantasyTeamId === null ? [] : listTrades(db, { leagueId, involving: fantasyTeamId, limit: 6 }),
    fantasyTeamId === null ? [] : claimsFor(db, { leagueId, fantasyTeamId }),
    fantasyTeamId === null ? [] : rosterOn(db, fantasyTeamId, day),
    leagueActivity(db, { leagueId, limit: 8 }),
    draftFor(db, leagueId),
    seasonSchedule(db, leagueId),
  ]);

  const availability = await availabilityFor(db, tonight.map((p) => p.playerId));
  const tonightScores = fantasyTeamId === null
    ? new Map<number, number>() : await scoresOn(db, { fantasyTeamId, day, configId });

  const seat = standingsTable.find((r) => r.fantasyTeamId === fantasyTeamId) ?? null;
  const offers = trades.filter((t) => t.status === "proposed" && t.to.fantasyTeamId === fantasyTeamId);
  const pendingClaims = claims.filter((c) => c.status === "pending");
  // No lineup in an `everyone` league: the team page is a week to read, not a
  // form to fill, and IR is a seat of its own rather than part of the twelve.
  const everyone = settings.lineupMode === "everyone";
  const held = roster.filter((p) => !p.reserve).length;
  const teamLabel = everyone ? "My team" : "Set lineup";

  const week = matchups[0] ?? null;
  const before = week !== null && week.startsOn > day;
  const rafters: RafterTeam[] = standingsTable.map((r) => ({
    fantasyTeamId: r.fantasyTeamId, name: r.name, rank: r.rank, wins: r.wins, losses: r.losses,
    ties: r.ties, pointsFor: r.pointsFor, mine: r.fantasyTeamId === fantasyTeamId,
  }));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{leagueName}</h1>
          <p className="meta">
            {week ? (
              <span>
                Week {week.week} · {span(week.startsOn, week.endsOn)}
                {before ? ` · starts ${weekday(week.startsOn)}` : ""}
              </span>
            ) : null}
            {fantasyTeamName ? (
              <span>
                {fantasyTeamName}
                {seat ? ` · ${seat.wins}–${seat.losses}${seat.ties ? `–${seat.ties}` : ""}` : ""}
                {/* Rank means nothing until a week settles — the banners agree. */}
                {seat && standingsTable.some((r) => r.wins + r.losses + r.ties > 0) ? ` · ${ordinal(seat.rank)}` : ""}
              </span>
            ) : null}
            <span>{held} of {activeLimit(settings)} rostered</span>
          </p>
        </div>
        <div className="controls">
          <Link className="button" href="/team">{teamLabel}</Link>
          <Link className="button" href="/players?free=1">Free agents</Link>
        </div>
      </div>

      {/* Draft night: the room lives behind the profile menu on desktop, and
          nobody should have to find it there while their clock is running. */}
      {draft && draft.status !== "complete" ? (
        <p className={`notice ${draft.status === "live" ? "good" : ""}`} style={{ marginBottom: "var(--s-4)" }}>
          {draft.status === "live" ? "The draft is live." : draft.status === "paused" ? "The draft is paused."
            : "The draft is set up and waiting to start."}{" "}
          <Link href="/draft" className="arrowlink">Go to the draft room <Arrow /></Link>
        </p>
      ) : null}

      <Rafters teams={rafters} />

      <div className="split">
        <div>
          {/* Before a roster exists, filling it is the only thing that will
              ever score — so it leads, ahead of a week of zeros. */}
          {fantasyTeamId !== null && held === 0 ? (
            <section className="nextup" aria-labelledby="nextup-h">
              <h2 id="nextup-h">Fill your roster</h2>
              <p>
                {activeLimit(settings)} open spots. Everyone on the roster at Sunday&rsquo;s lock scores
                every game they play that week.
              </p>
              <div className="controls">
                <Link className="button primary" href="/players?free=1">Browse free agents</Link>
                {draft && draft.status !== "complete" ? <Link className="button" href="/draft">Draft room</Link> : null}
              </div>
            </section>
          ) : null}

          <SectionHead title={week ? `Week ${week.week}` : "This week"} action="All matchups" href="/league" />
          {matchups.length === 0 ? (
            <div className="panel">
              <Empty title="No matchups this week"
                     action={<Link className="button" href="/league">Open the league</Link>}>
                The schedule has nothing covering {day}. A commissioner generates it once every team has an owner.
              </Empty>
            </div>
          ) : (
            <MatchupList matchups={matchups} mineId={fantasyTeamId} today={day} />
          )}

          {held > 0 ? (
            <>
              <SectionHead title="Tonight" action={teamLabel} href="/team" />
              <div className="panel">
                <Tonight players={tonight} scores={tonightScores} now={now} settings={settings} availability={availability}
                         everyone={everyone} rostered={held} />
              </div>
            </>
          ) : null}
        </div>

        <div className="stack">
          {schedule.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h2>The season</h2>
                <Link href="/standings" className="card-link arrowlink">Standings <Arrow /></Link>
              </div>
              <div className="card-body"><SeasonLine weeks={schedule} today={day} /></div>
            </div>
          ) : null}

          <Attention
            tonight={tonight}
            settings={settings}
            offers={offers.length}
            claims={pendingClaims.length}
            roster={held}
            limit={activeLimit(settings)}
            everyone={everyone}
            now={now}
            availability={availability}
          />

          <div className="card">
            <div className="card-head">
              <h2>League activity</h2>
              <span className="pill ghost">{activity.length}</span>
            </div>
            <ActivityFeed events={activity} mineId={fantasyTeamId} />
          </div>
        </div>
      </div>
    </>
  );
}

const SPAN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const span = (from: string, to: string) =>
  `${SPAN.format(new Date(`${from}T00:00:00Z`))} – ${SPAN.format(new Date(`${to}T00:00:00Z`))}`;
const weekday = (iso: string) => WEEKDAY.format(new Date(`${iso}T00:00:00Z`));

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? "th"}`;

/**
 * Tonight's slate, in the order it happens.
 *
 * Bench players are here too, dimmed: a bench player with a game is a decision
 * that has not been made yet, and hiding him is how points get left behind.
 */
function Tonight({
  players, scores, now, settings, availability, everyone = false, rostered,
}: {
  players: Startable[];
  scores: Map<number, number>;
  now: Date;
  settings: { starters: { slot: string; count: number }[] };
  availability: Map<number, PlayerAvailability>;
  /** No slots to show: everyone held at the lock counts, and anyone else joins on Sunday. */
  everyone?: boolean;
  /** Who is on the roster at all: an empty one has nothing to schedule. */
  rostered: number;
}) {
  if (rostered === 0) {
    return (
      <Empty title="Your roster is empty" glyph="team"
             action={<Link className="button primary" href="/players?free=1">Browse free agents</Link>}>
        Nobody scores until somebody&rsquo;s on it.
      </Empty>
    );
  }
  if (players.length === 0) {
    return (
      <Empty title="Nobody plays tonight" glyph="clock"
             action={<Link className="button" href="/team">See the week</Link>}>
        None of your players has a game today.
      </Empty>
    );
  }

  const ordered = [...players].sort((a, b) => {
    const starting = (p: Startable) => (p.slot === "BENCH" || p.slot === "IR" ? 1 : 0);
    if (starting(a) !== starting(b)) return starting(a) - starting(b);
    return (a.tipoff ?? "~").localeCompare(b.tipoff ?? "~");
  });

  const started = ordered.filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
  const live = started.filter((p) => gameState({ tipoff: p.tipoff, score: scores.get(p.playerId) ?? null }, now) === "live").length;
  const scored = started.reduce((a, p) => a + (scores.get(p.playerId) ?? 0), 0);
  const projected = started.reduce((a, p) => a + (scores.get(p.playerId) ?? p.projected), 0);

  return (
    <>
      <div className="card-head">
        <div className="row" style={{ gap: "var(--s-5)" }}>
          <div>
            <div className="eyebrow">{everyone ? "Scoring tonight" : "Starters scoring"}</div>
            <Score value={scored} size="md" />
          </div>
          {projected > scored + 0.05 ? (
            <div>
              <div className="eyebrow">Projected</div>
              <Score value={projected} size="md" tone="quiet" />
            </div>
          ) : null}
        </div>
        {live > 0 ? <LiveTag label={`${live} on the floor`} />
          : <span className="pill ghost">{started.length} {everyone ? "playing" : "starting"}</span>}
      </div>

      {ordered.map((player) => {
        const score = scores.get(player.playerId) ?? null;
        const state = gameState({ tipoff: player.tipoff, score }, now);
        const benched = player.slot === "BENCH" || player.slot === "IR";
        return (
          <PlayerRow
            key={player.playerId}
            playerId={player.playerId}
            name={player.name}
            dim={benched}
            rail={player.primaryColor}
            state={!benched && state === "live" ? "live" : undefined}
            lead={everyone ? undefined
              : <span className="slot" data-slot={player.slot}>{benched ? "BN" : player.slot}</span>}
            badge={
              <AvailabilityTag
                status={availability.get(player.playerId)?.status}
                injury={availability.get(player.playerId)?.injury}
                compact
              />
            }
            meta={
              <>
                <span>{player.opponent ? `vs ${player.opponent}` : "Opponent TBD"}</span>
                <Dot />
                <span>{player.tipoff ? <ET iso={player.tipoff} /> : "TBD"} ET</span>
              </>
            }
            right={
              <>
                {state === "live" ? <LiveTag /> : state === "final" ? <span className="pill">Final</span> : null}
                <span className="plr-figure">
                  <Score
                    value={score ?? player.projected}
                    size="xs"
                    tone={score === null ? "quiet" : state === "live" ? "live" : "default"}
                  />
                  <span className="cap">{score === null ? "proj" : "pts"}</span>
                </span>
              </>
            }
          />
        );
      })}
    </>
  );
}

/**
 * The things that cost points if nobody looks at them.
 *
 * Ordered by what it costs to ignore: an empty slot scores nothing at all, a
 * benched player who has already tipped off is points that are gone, and a
 * standing offer is somebody waiting on an answer.
 */
function Attention({
  tonight, settings, offers, claims, roster, limit, now, availability, everyone = false,
}: {
  tonight: Startable[];
  settings: { starters: { slot: Exclude<Slot, "BENCH" | "IR">; count: number }[] };
  offers: number; claims: number; roster: number; limit: number; now: Date;
  availability: Map<number, PlayerAvailability>;
  /**
   * No lineup: nobody is "benched" (a player shown off the lineup is one added
   * since the lock, who joins on Sunday), so the slot alarms do not apply and
   * the answer to a player ruled out is IR, not a swap.
   */
  everyone?: boolean;
}) {
  const filled = new Map<string, number>();
  for (const p of tonight) {
    if (p.slot === "BENCH" || p.slot === "IR") continue;
    filled.set(p.slot, (filled.get(p.slot) ?? 0) + 1);
  }
  const open: string[] = [];
  for (const { slot, count } of settings.starters) {
    const short = count - (filled.get(slot) ?? 0);
    // Only a slot somebody eligible could actually fill is a problem the
    // manager can solve tonight.
    const available = tonight.filter(
      (p) => (p.slot === "BENCH" || p.slot === "IR") && !p.locked && eligibleSlots(p.role).includes(slot),
    ).length;
    for (let i = 0; i < Math.min(short, available); i += 1) open.push(slot);
  }
  if (everyone) open.length = 0;

  const missed = everyone ? [] : tonight.filter((p) => (p.slot === "BENCH" || p.slot === "IR") && p.locked);
  const missedPoints = missed.reduce((a, p) => a + p.projected, 0);

  const out = tonight.filter(
    (p) => p.slot !== "BENCH" && p.slot !== "IR" && availability.get(p.playerId)?.status === "out",
  );

  const items: { tone: "crit" | "warn" | "" ; glyph: "alert" | "clock" | "trades" | "waivers" | "team"; title: string; body: string; href: string; cta: string }[] = [];

  if (out.length > 0 && everyone) {
    items.push({
      tone: "crit", glyph: "alert",
      title: `${out.length} player${out.length === 1 ? "" : "s"} ruled out tonight`,
      body: `${out.map((p) => p.name).join(", ")} — listed out. Moving ${out.length === 1 ? "him" : "them"} to IR opens a seat for a pickup from Sunday's lock.`,
      href: "/team", cta: "IR",
    });
  } else if (out.length > 0) {
    items.push({
      tone: "crit", glyph: "alert",
      title: `${out.length} starter${out.length === 1 ? "" : "s"} ruled out tonight`,
      body: `${out.map((p) => p.name).join(", ")} — RotoWire lists ${out.length === 1 ? "him" : "them"} out. The slot still scores zero unless somebody else takes it.`,
      href: "/team", cta: "Swap",
    });
  }
  if (open.length > 0) {
    items.push({
      tone: "crit", glyph: "alert",
      title: `${open.length} starting slot${open.length === 1 ? "" : "s"} unfilled`,
      body: `${open.join(", ")} — nobody is scoring there tonight, and somebody eligible is on your bench.`,
      href: "/team", cta: "Fill it",
    });
  }
  if (missed.length > 0) {
    items.push({
      tone: "warn", glyph: "clock",
      title: `${missed.length} benched game${missed.length === 1 ? "" : "s"} already tipped off`,
      body: `About ${missedPoints.toFixed(1)} projected points sat out tonight. Tomorrow's lineup can be set now.`,
      href: "/team", cta: "Work ahead",
    });
  }
  if (offers > 0) {
    items.push({
      tone: "warn", glyph: "trades",
      title: `${offers} trade offer${offers === 1 ? "" : "s"} waiting`,
      body: "An offer stands until it is answered or it expires. Nothing moves until you accept.",
      href: "/trades", cta: "Review",
    });
  }
  if (claims > 0) {
    items.push({
      tone: "", glyph: "waivers",
      title: `${claims} sealed bid${claims === 1 ? "" : "s"} in`,
      body: "Your claims open at the next waiver run, in the order you set.",
      href: "/waivers", cta: "Reorder",
    });
  }
  if (roster < limit) {
    items.push({
      tone: "", glyph: "team",
      title: `${limit - roster} roster spot${limit - roster === 1 ? "" : "s"} open`,
      body: everyone
        ? "An empty spot never scores. A free agent added now plays from Sunday's lock."
        : "An empty spot never scores. Free agents can be added outright.",
      href: "/players?free=1", cta: "Browse",
    });
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Needs you</h2>
        <span className="pill" style={items.length === 0 ? undefined : { background: "var(--warn-wash)", color: "var(--warn)", borderColor: "var(--warn-line)" }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <Empty title="Nothing outstanding" glyph="check">
          {everyone
            ? "Nobody is ruled out, no offer is waiting, and the roster is full."
            : "Every slot is filled, no offer is waiting, and the roster is full."}
        </Empty>
      ) : (
        <div className="stagger">
          {items.map((item) => (
            <div className="plr" key={item.title} style={{ alignItems: "flex-start" }}>
              <span className="plr-lead" style={{ paddingTop: 2 }}>
                <span className="avatar sm" style={{
                  ["--hue" as string]: item.tone === "crit" ? 8 : item.tone === "warn" ? 38 : 210,
                }}>
                  <Glyph name={item.glyph} size={15} />
                </span>
              </span>
              <span className="plr-id">
                <span className="plr-name" style={{ whiteSpace: "normal" }}>{item.title}</span>
                <span className="plr-sub" style={{ whiteSpace: "normal", display: "block", lineHeight: 1.45 }}>{item.body}</span>
              </span>
              <span className="plr-right">
                <Link className="button sm" href={item.href}>{item.cta}</Link>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
