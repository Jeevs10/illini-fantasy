import Link from "next/link";
import {
  availabilityFor, claimsFor, eligibleSlots, gameState, leagueActivity, listTrades,
  periodOutlook, rankedStandings, rosterLimit, rosterOn, scoresOn, startableOn, weekMatchups,
  type PlayerAvailability, type Slot, type Startable, type TeamOutlook,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Avatar } from "../ui/identity.tsx";
import { Glyph } from "../ui/glyphs.tsx";
import { AvailabilityTag, Bar, Empty, ET, LiveTag, Score, SectionHead } from "../ui/bits.tsx";
import { Dot, PlayerRow } from "../ui/playerrow.tsx";
import { ScoreBug, type BugSide } from "../ui/scorebug.tsx";
import { ActivityFeed } from "../ui/activity.tsx";

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

  const matchups = await weekMatchups(db, { leagueId, configId, on: day, settings });
  const mine = matchups.find(
    (m) => m.home.fantasyTeamId === fantasyTeamId || m.away.fantasyTeamId === fantasyTeamId);

  const [tonight, standingsTable, trades, claims, roster, activity] = await Promise.all([
    fantasyTeamId === null ? [] : startableOn(db, { fantasyTeamId, day, configId, now }),
    rankedStandings(db, leagueId),
    fantasyTeamId === null ? [] : listTrades(db, { leagueId, involving: fantasyTeamId, limit: 6 }),
    fantasyTeamId === null ? [] : claimsFor(db, { leagueId, fantasyTeamId }),
    fantasyTeamId === null ? [] : rosterOn(db, fantasyTeamId, day),
    leagueActivity(db, { leagueId, limit: 8 }),
  ]);

  const availability = await availabilityFor(db, tonight.map((p) => p.playerId));

  const [tonightScores, outlooks] = await Promise.all([
    fantasyTeamId === null ? new Map<number, number>() : scoresOn(db, { fantasyTeamId, day, configId }),
    mine
      ? Promise.all([
          periodOutlook(db, { fantasyTeamId: mine.home.fantasyTeamId, configId, from: mine.startsOn, to: mine.endsOn, settings, now }),
          periodOutlook(db, { fantasyTeamId: mine.away.fantasyTeamId, configId, from: mine.startsOn, to: mine.endsOn, settings, now }),
        ])
      : Promise.resolve(null),
  ]);

  const others = matchups.filter((m) => m !== mine);
  const seat = standingsTable.find((r) => r.fantasyTeamId === fantasyTeamId) ?? null;
  const offers = trades.filter((t) => t.status === "proposed" && t.to.fantasyTeamId === fantasyTeamId);
  const pendingClaims = claims.filter((c) => c.status === "pending");

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{fantasyTeamName ?? leagueName}</h1>
          <p className="meta">
            <span>{leagueName}</span>
            {seat ? <span>{seat.wins}&ndash;{seat.losses}{seat.ties ? `–${seat.ties}` : ""} · {ordinal(seat.rank)}</span> : null}
            <span>{roster.length} of {rosterLimit(settings)} rostered</span>
          </p>
        </div>
        <div className="controls">
          <Link className="button" href="/team">Set lineup</Link>
          <Link className="button" href="/players?free=1">Free agents</Link>
        </div>
      </div>

      {mine && outlooks ? (
        <div style={{ marginBottom: "var(--s-5)" }} className="rise">
          <ScoreBug
            week={mine.week}
            startsOn={mine.startsOn}
            endsOn={mine.endsOn}
            settled={mine.settled}
            gamesCap={settings.gamesCap}
            href="/league"
            home={bug(mine.home.fantasyTeamId, mine.home.name, outlooks[0], fantasyTeamId)}
            away={bug(mine.away.fantasyTeamId, mine.away.name, outlooks[1], fantasyTeamId)}
          />
        </div>
      ) : (
        <div className="panel">
          <Empty title="No matchup this week"
                 action={<Link className="button" href="/league">Open the league</Link>}>
            This league has no scheduled matchup covering {day}. A commissioner
            generates the schedule once every team has an owner.
          </Empty>
        </div>
      )}

      <div className="split">
        <div>
          <SectionHead title="Tonight" action="Set lineup" href="/team">
            <span className="spacer" />
          </SectionHead>
          <div className="panel">
            <Tonight players={tonight} scores={tonightScores} now={now} settings={settings} availability={availability} />
          </div>

          <SectionHead title="Around the league" action="All matchups" href="/league" />
          <div className="panel">
            {others.length === 0 ? (
              <Empty title="Nothing else on" glyph="matchup">
                Every other matchup this week is yours.
              </Empty>
            ) : (
              others.map((m) => {
                const sum = m.home.total + m.away.total;
                const homeLeads = sum > 0 && m.home.total > m.away.total;
                const awayLeads = sum > 0 && m.away.total > m.home.total;
                return (
                  <Link className="minibug" key={m.matchupId} href="/league">
                    <span className="side">
                      <Avatar name={m.home.name} seed={m.home.fantasyTeamId} size="xs" />
                      <span className="nm">{m.home.name}</span>
                    </span>
                    <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap" }}>
                      <span className="score score-xs sc" data-lead={homeLeads}>{m.home.total.toFixed(1)}</span>
                      <span className="dash">–</span>
                      <span className="score score-xs sc" data-lead={awayLeads}>{m.away.total.toFixed(1)}</span>
                    </span>
                    <span className="side them">
                      <Avatar name={m.away.name} seed={m.away.fantasyTeamId} size="xs" />
                      <span className="nm">{m.away.name}</span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="stack">
          <Attention
            tonight={tonight}
            settings={settings}
            offers={offers.length}
            claims={pendingClaims.length}
            roster={roster.length}
            limit={rosterLimit(settings)}
            now={now}
            availability={availability}
          />

          <div className="card">
            <div className="card-head">
              <h2>Standings</h2>
              <Link href="/standings" style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: "var(--ink-2)", textDecoration: "none" }}>
                Full table →
              </Link>
            </div>
            {standingsTable.every((r) => r.wins + r.losses + r.ties === 0) ? (
              <Empty title="Nothing settled yet" glyph="league">
                The table fills in as weeks settle.
              </Empty>
            ) : (
              standingsTable.slice(0, 6).map((row) => (
                <Link key={row.fantasyTeamId} href={`/teams/${row.fantasyTeamId}`}
                      style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                  <PlayerRow
                    name={row.name}
                    mine={row.fantasyTeamId === fantasyTeamId}
                    lead={
                      <>
                        <span className="faint tnum" style={{ width: "1.5ch", textAlign: "right", fontSize: "var(--t-sm)" }}>{row.rank}</span>
                        <Avatar name={row.name} seed={row.fantasyTeamId} size="sm" mine={row.fantasyTeamId === fantasyTeamId} />
                      </>
                    }
                    meta={<span>{row.wins}&ndash;{row.losses}{row.ties ? `–${row.ties}` : ""}</span>}
                    right={
                      <>
                        {row.movement !== null && row.movement !== 0 ? (
                          <span className="delta" data-dir={row.movement > 0 ? "up" : "down"}>
                            {row.movement > 0 ? "↑" : "↓"}{Math.abs(row.movement)}
                          </span>
                        ) : null}
                        <span className="score score-xs" style={{ color: "var(--ink-2)" }}>{row.pointsFor.toFixed(0)}</span>
                      </>
                    }
                  />
                </Link>
              ))
            )}
          </div>

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

function bug(id: number, name: string, o: TeamOutlook, mineId: number | null): BugSide {
  return {
    fantasyTeamId: id, name,
    total: o.total, projected: o.projected,
    gamesCounted: o.gamesCounted, gamesPlayed: o.gamesPlayed,
    live: o.live, upcoming: o.upcoming,
    pendingSlots: bySlot(o.pending),
    mine: id === mineId,
  };
}

/** Still-to-play games, grouped by slot for the "N to play" breakdown. */
function bySlot(pending: TeamOutlook["pending"]): { slot: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of pending) counts.set(p.slot, (counts.get(p.slot) ?? 0) + 1);
  return [...counts.entries()].map(([slot, count]) => ({ slot, count }));
}

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? "th"}`;

/**
 * Tonight's slate, in the order it happens.
 *
 * Bench players are here too, dimmed: a bench player with a game is a decision
 * that has not been made yet, and hiding him is how points get left behind.
 */
function Tonight({
  players, scores, now, settings, availability,
}: {
  players: Startable[];
  scores: Map<number, number>;
  now: Date;
  settings: { starters: { slot: string; count: number }[] };
  availability: Map<number, PlayerAvailability>;
}) {
  if (players.length === 0) {
    return (
      <Empty title="Nobody plays tonight" glyph="clock"
             action={<Link className="button" href="/team">Look at another night</Link>}>
        College schedules are uneven — most of a week&rsquo;s slate lands on
        Saturday, and a Thursday can be nearly empty for a roster of
        major-conference players.
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
            <div className="eyebrow">Starters scoring</div>
            <Score value={scored} size="md" />
          </div>
          {projected > scored + 0.05 ? (
            <div>
              <div className="eyebrow">Projected</div>
              <Score value={projected} size="md" tone="quiet" />
            </div>
          ) : null}
        </div>
        {live > 0 ? <LiveTag label={`${live} on the floor`} /> : <span className="pill ghost">{started.length} starting</span>}
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
            lead={<span className="slot" data-slot={player.slot}>{benched ? "BN" : player.slot}</span>}
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
  tonight, settings, offers, claims, roster, limit, now, availability,
}: {
  tonight: Startable[];
  settings: { starters: { slot: Exclude<Slot, "BENCH" | "IR">; count: number }[] };
  offers: number; claims: number; roster: number; limit: number; now: Date;
  availability: Map<number, PlayerAvailability>;
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

  const missed = tonight.filter((p) => (p.slot === "BENCH" || p.slot === "IR") && p.locked);
  const missedPoints = missed.reduce((a, p) => a + p.projected, 0);

  const out = tonight.filter(
    (p) => p.slot !== "BENCH" && p.slot !== "IR" && availability.get(p.playerId)?.status === "out",
  );

  const items: { tone: "crit" | "warn" | "" ; glyph: "alert" | "clock" | "trades" | "waivers" | "team"; title: string; body: string; href: string; cta: string }[] = [];

  if (out.length > 0) {
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
      body: "An empty spot never scores. Free agents can be added outright.",
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
          Every slot is filled, no offer is waiting, and the roster is full.
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
