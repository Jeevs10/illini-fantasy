import Link from "next/link";
import {
  availabilityFor, eligibleSlots, periodContaining, periodForWeek, rosterLimit, rosterOn,
  seasonWeeks, slateByDay, startableInPeriod, type Slot,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Lineup, type LineupPlayer, type OffNightPlayer } from "./lineup.tsx";
import { buildSlots } from "./slots.ts";
import { DayStrip, window7 } from "./daystrip.tsx";
import { NextLock } from "./nextlock.tsx";
import { Avatar } from "../ui/identity.tsx";
import { Empty, LiveTag, Score } from "../ui/bits.tsx";

export const dynamic = "force-dynamic";

const SPAN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (from: string, to: string) =>
  `${SPAN.format(new Date(`${from}T00:00:00Z`))} – ${SPAN.format(new Date(`${to}T00:00:00Z`))}`;

export default async function TeamPage({
  searchParams,
}: { searchParams: Promise<{ date?: string; week?: string }> }) {
  const { date, week } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId, fantasyTeamName, settings, configId, leagueName } = viewer.membership;
  const day = viewDate(date);
  const today = viewDate();
  const now = viewNow();

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

  // The lineup is a decision about the scoring period, so the page is about the
  // period the browsed date falls in rather than about the date itself — and
  // can be navigated week to week, since a week ahead is a lineup you can
  // legitimately be setting now.
  const [period, season] = await Promise.all([
    week ? periodForWeek(db, leagueId, Number(week)) : periodContaining(db, leagueId, day),
    seasonWeeks(db, leagueId),
  ]);
  if (period === null) {
    return (
      <div className="panel">
        <Empty title="No schedule yet" glyph="matchup">
          This league has no matchups, so there is no week to set a lineup for.
          A commissioner generates the schedule once every team has an owner.
        </Empty>
      </div>
    );
  }

  const { from, to } = window7(today);
  const [starters, roster, slate] = await Promise.all([
    startableInPeriod(db, {
      fantasyTeamId, from: period.startsOn, to: period.endsOn, configId, now,
    }),
    rosterOn(db, fantasyTeamId, today),
    slateByDay(db, { fantasyTeamId, from, to }),
  ]);
  const availability = await availabilityFor(db, roster.map((p) => p.playerId));

  // Eligibility is resolved here rather than in the browser: it comes from the
  // role Torvik assigned, so the two cannot disagree.
  const eligible: Record<number, Slot[]> = {};
  for (const player of starters) eligible[player.playerId] = eligibleSlots(player.role);

  const players: LineupPlayer[] = starters.map((p) => ({
    ...p, availability: availability.get(p.playerId),
  }));

  // Rostered, but their real team plays nothing this week. They belong on the
  // bench with everyone else who is not scoring — scoring zero, because that
  // is what a player with no games scores.
  const idle = roster.filter((p) => !starters.some((s) => s.playerId === p.playerId));
  const offNight: OffNightPlayer[] = idle.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    role: p.role,
    teamName: p.teamName,
    primaryColor: p.primaryColor,
    availability: availability.get(p.playerId),
    acquiredVia: p.acquiredVia,
  }));

  // Totalled from the same slot assignment the table draws, not from "whose
  // slot is not BENCH". Legacy rows written a night at a time can leave more
  // players holding a starting slot than there are slots, and the two readings
  // then disagree on one screen.
  const started = buildSlots(players, settings)
    .map((r) => r.player)
    .filter((p): p is LineupPlayer => p !== null);
  const scored = started.reduce((a, p) => a + p.scored, 0);
  const projected = started.reduce((a, p) => a + p.projected, 0);
  const liveNow = started.filter((p) => p.games.some(
    (g) => g.score === null && g.tipoff !== null && new Date(g.tipoff) <= now)).length;

  // The earliest game that has not started, across every player who can still
  // be moved — the deadline the page is really about.
  const next = players
    .filter((p) => !p.locked)
    .flatMap((p) => p.games.filter((g) => g.score === null && g.tipoff !== null))
    .sort((a, b) => a.tipoff!.localeCompare(b.tipoff!))[0];

  const isThisWeek = today >= period.startsOn && today <= period.endsOn;

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
        <nav className="controls" aria-label="Week navigation">
          {period.week > (season?.first ?? 1) ? (
            <Link className="button" href={`/team?week=${period.week - 1}`}>← Week {period.week - 1}</Link>
          ) : null}
          {season !== null && period.week < season.last ? (
            <Link className="button" href={`/team?week=${period.week + 1}`}>Week {period.week + 1} →</Link>
          ) : null}
          <Link className="button" href="/waivers">Add or drop</Link>
          <Link className="button" href="/league">Matchup</Link>
        </nav>
      </div>

      <DayStrip day={day} today={today} slate={slate} />

      <div className="panel">
        <div className="panel-head">
          <div className="row" style={{ gap: "var(--s-5)" }}>
            <div>
              <div className="eyebrow">
                Week {period.week} · {span(period.startsOn, period.endsOn)}
              </div>
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
                  weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
                }).format(new Date(next.tipoff!))}
              />
            ) : players.length > 0 ? (
              <span className="pill">{isThisWeek ? "Every game has tipped off" : "Week complete"}</span>
            ) : null}
          </div>
        </div>

        {/* One decision for the whole week: a starter is started for the period
          * and everything he plays in it counts, so the page says so once
          * rather than asking the same question again every night. */}
        <p className="sethelp" style={{ padding: "0 var(--s-4) var(--s-3)" }}>
          Set once for the week. Every game a starter plays between{" "}
          {span(period.startsOn, period.endsOn)} counts, and each player locks
          when he tips off for the first time.
        </p>

        {players.length === 0 && idle.length === 0 ? (
          <Empty title="Nobody plays this week" glyph="clock">
            College schedules are uneven, and a roster can draw a week where
            nothing lands. Try another week from the strip above.
          </Empty>
        ) : (
          <Lineup
            from={period.startsOn} to={period.endsOn}
            startable={players} settings={settings} eligible={eligible}
            offNight={offNight}
          />
        )}
      </div>
    </>
  );
}
