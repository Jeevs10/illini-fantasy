import Link from "next/link";
import {
  eligibleSlots, gameState, rosterLimit, rosterOn, scoresOn, slateByDay, startableOn,
  type Slot,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Lineup, type LineupPlayer } from "./lineup.tsx";
import { DayStrip, label, window7 } from "./daystrip.tsx";
import { NextLock } from "./nextlock.tsx";
import { Avatar } from "../ui/identity.tsx";
import { Empty, LiveTag, Score } from "../ui/bits.tsx";
import { Dot, PlayerRow } from "../ui/playerrow.tsx";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const viewer = await requireViewer();
  const { fantasyTeamId, fantasyTeamName, settings, configId, leagueName } = viewer.membership;
  const day = viewDate(date);
  const today = viewDate();
  const now = viewNow();
  const isToday = day === today;

  if (fantasyTeamId === null) {
    return (
      <div className="panel">
        <Empty title="No team here" glyph="team"
               action={<Link className="button" href="/league">See the league</Link>}>
          You are a member of {leagueName} but do not run a team in it, so there
          is no lineup to set.
        </Empty>
      </div>
    );
  }

  const { from, to } = window7(today);
  const [startable, roster, scores, slate] = await Promise.all([
    startableOn(db, { fantasyTeamId, day, configId, now }),
    rosterOn(db, fantasyTeamId, day),
    scoresOn(db, { fantasyTeamId, day, configId }),
    slateByDay(db, { fantasyTeamId, from, to }),
  ]);

  // Eligibility is resolved here rather than in the browser: it comes from the
  // role Torvik assigned, so the two cannot disagree.
  const eligible: Record<number, Slot[]> = {};
  for (const player of startable) eligible[player.playerId] = eligibleSlots(player.role);

  const players: LineupPlayer[] = startable.map((p) => {
    const score = scores.get(p.playerId) ?? null;
    return { ...p, score, state: gameState({ tipoff: p.tipoff, score }, now) };
  });

  const idle = roster.filter((p) => !startable.some((s) => s.playerId === p.playerId));

  const starters = players.filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
  const liveNow = starters.filter((p) => p.state === "live").length;
  const scored = starters.reduce((a, p) => a + (p.score ?? 0), 0);
  const projected = starters.reduce((a, p) => a + (p.score ?? p.projected), 0);

  // The earliest game not yet under way — the deadline the page is really about.
  const next = players
    .filter((p) => !p.locked && p.tipoff !== null)
    .sort((a, b) => a.tipoff!.localeCompare(b.tipoff!))[0];

  return (
    <>
      <div className="pagehead">
        <div className="row" style={{ gap: "var(--s-4)", flexWrap: "nowrap", minWidth: 0 }}>
          <Avatar name={fantasyTeamName ?? "Team"} seed={fantasyTeamId} size="xl" mine />
          <div style={{ minWidth: 0 }}>
            <h1>{fantasyTeamName}</h1>
            <p className="meta">
              <span>{leagueName}</span>
              <span>{roster.length} of {rosterLimit(settings)} rostered</span>
              <span>{settings.starters.map((s) => `${s.count}${s.slot}`).join(" · ")}</span>
            </p>
          </div>
        </div>
        <div className="controls">
          <Link className="button" href="/waivers">Add or drop</Link>
          <Link className="button" href="/league">Matchup</Link>
        </div>
      </div>

      <DayStrip day={day} today={today} slate={slate} />

      <div className="panel">
        <div className="panel-head">
          <div className="row" style={{ gap: "var(--s-5)" }}>
            <div>
              <div className="eyebrow">{isToday ? "Tonight" : label(day)}</div>
              <div className="row" style={{ gap: "var(--s-2)", marginTop: 2 }}>
                <Score value={scored} size="md" />
                {projected > scored + 0.05 ? (
                  <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                    proj <strong className="tnum">{projected.toFixed(1)}</strong>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: "var(--s-3)" }}>
            {liveNow > 0 ? <LiveTag label={`${liveNow} on the floor`} /> : null}
            {next ? (
              <NextLock
                iso={next.tipoff!}
                nowIso={now.toISOString()}
                label={new Intl.DateTimeFormat("en-US", {
                  hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
                }).format(new Date(next.tipoff!))}
              />
            ) : players.length > 0 ? (
              <span className="pill">Every game has tipped off</span>
            ) : null}
          </div>
        </div>

        {players.length === 0 ? (
          <Empty title={`Nobody plays ${isToday ? "tonight" : "that night"}`} glyph="clock">
            College schedules are uneven — most of a week&rsquo;s slate lands on
            Saturday, and a Thursday can be nearly empty for a roster of
            major-conference players. Try another night above.
          </Empty>
        ) : (
          <Lineup day={day} startable={players} settings={settings} eligible={eligible} />
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Rest of the roster</h2>
          <span className="pill">{idle.length}</span>
        </div>
        {idle.length === 0 ? (
          <Empty title="Everyone has a game" glyph="check">
            Every player on the roster is scheduled {isToday ? "tonight" : "that night"}.
          </Empty>
        ) : (
          idle.map((player) => (
            <PlayerRow
              key={player.playerId}
              playerId={player.playerId}
              name={player.name}
              meta={
                <>
                  <span>{player.teamName ?? "—"}</span>
                  {player.role ? <><Dot /><span>{player.role}</span></> : null}
                </>
              }
              right={<span className="pill ghost">{player.acquiredVia.replace("_", " ")}</span>}
            />
          ))
        )}
      </div>
    </>
  );
}
