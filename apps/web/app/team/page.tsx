import Link from "next/link";
import {
  activeLimit, availabilityFor, carryForwardLineup, eligibleSlots, periodContaining, periodForWeek,
  rosterLimit, rosterOn, seasonWeeks, slateByDay, startableInPeriod, TEAM_NAME_MAX, weekRoster, type Slot,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Lineup, type LineupPlayer, type OffNightPlayer } from "./lineup.tsx";
import { EveryoneWeek } from "./everyone.tsx";
import { TeamNameHeading } from "./teamname.tsx";
import { DayStrip, periodDays } from "./daystrip.tsx";
import { NextLock } from "./nextlock.tsx";
import { Avatar } from "../ui/identity.tsx";
import { Empty, LiveTag, Score, WeekFigure } from "../ui/bits.tsx";
import { Arrow } from "../ui/glyphs.tsx";

export const dynamic = "force-dynamic";

const SPAN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (from: string, to: string) =>
  `${SPAN.format(new Date(`${from}T00:00:00Z`))} – ${SPAN.format(new Date(`${to}T00:00:00Z`))}`;

export default async function TeamPage({
  searchParams,
}: { searchParams: Promise<{ date?: string; week?: string }> }) {
  const { date, week } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId, fantasyTeamName, settings, configId, leagueName, season: leagueSeason } = viewer.membership;
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
          The commissioner hasn&rsquo;t made the schedule yet.
        </Empty>
      </div>
    );
  }

  // The strip shows the week on the page, not the week around today: the
  // arrows move between weeks, and a strip that stayed put would contradict them.
  const { from, to } = periodDays(period.startsOn);

  if (settings.lineupMode === "everyone") {
    const [week, slate] = await Promise.all([
      weekRoster(db, {
        fantasyTeamId, from: period.startsOn, to: period.endsOn, configId, season: leagueSeason,
        settings, now, today,
      }),
      slateByDay(db, { fantasyTeamId, from, to }),
    ]);
    const availability = await availabilityFor(db, week.map((p) => p.playerId));
    const counting = week.filter((p) => p.counting);
    const held = counting.length;
    // Everyone who scored for the team this week, including players since let go.
    const scored = week.reduce((a, p) => a + p.scored, 0);
    const projectedWeek = week.reduce((a, p) => a + p.projectedWeek, 0);
    return (
      <>
        <div className="pagehead">
          <div className="row" style={{ gap: "var(--s-4)", flexWrap: "nowrap", minWidth: 0 }}>
            <Avatar name={fantasyTeamName ?? "Team"} seed={fantasyTeamId} size="xl" mine />
            <div style={{ minWidth: 0 }}>
              <TeamNameHeading name={fantasyTeamName ?? "Team"} max={TEAM_NAME_MAX} />
              <p className="meta">
                <span>{leagueName}</span>
                <span>{held} of {activeLimit(settings)} rostered</span>
                <span>Everyone plays</span>
              </p>
            </div>
          </div>
          <nav className="controls" aria-label="Team actions">
            <Link className={`button${held < activeLimit(settings) ? " primary" : ""}`} href="/waivers">Add or drop</Link>
            <Link className="button" href="/league">Matchup</Link>
          </nav>
        </div>

        <DayStrip day={day} today={today} slate={slate} from={from} />

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Week {period.week} <span className="faint" style={{ fontWeight: 500 }}>· {span(period.startsOn, period.endsOn)}</span></h2>
              <div className="row" style={{ gap: "var(--s-2)", marginTop: 2 }}>
                <WeekFigure scored={scored} projected={projectedWeek} tone="accent"
                            played={week.some((p) => p.games.some((g) => g.counted && g.score !== null))} />
                <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                  {counting.length} on the roster
                </span>
              </div>
            </div>
            {/* Stepping through weeks is reading, not the page's job: small, by the week it moves. */}
            <nav className="weekstep" aria-label="Week navigation">
              {period.week > (season?.first ?? 1) ? (
                <Link className="button sm" href={`/team?week=${period.week - 1}`}><Arrow dir="left" /> Week {period.week - 1}</Link>
              ) : null}
              {season !== null && period.week < season.last ? (
                <Link className="button sm" href={`/team?week=${period.week + 1}`}>Week {period.week + 1} <Arrow /></Link>
              ) : null}
            </nav>
          </div>
          {week.length === 0 ? (
            <Empty title="Your roster is empty"
                   action={<Link className="button primary" href="/players?free=1">Browse free agents</Link>}>
              Anyone added now scores from his next game.
            </Empty>
          ) : (
            <EveryoneWeek
              rows={week.map((p) => ({ ...p, availability: availability.get(p.playerId) }))}
            />
          )}
        </div>
      </>
    );
  }

  let [starters, roster, slate] = await Promise.all([
    startableInPeriod(db, {
      fantasyTeamId, from: period.startsOn, to: period.endsOn, configId, now,
    }),
    rosterOn(db, fantasyTeamId, today),
    slateByDay(db, { fantasyTeamId, from, to }),
  ]);

  // A lineup is a standing decision. A week nobody has touched inherits the
  // last one set, so a manager whose team has not changed does not have to
  // re-pick the same seven players every seven days to keep them. Only for a
  // week still open — a finished one is a record, and writing into it now
  // would be inventing a lineup nobody set at the time.
  if (period.endsOn >= today) {
    const carried = await carryForwardLineup(db, {
      fantasyTeamId, from: period.startsOn, to: period.endsOn, settings, startable: starters,
    });
    if (carried > 0) {
      starters = await startableInPeriod(db, {
        fantasyTeamId, from: period.startsOn, to: period.endsOn, configId, now,
      });
    }
  }
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

  // Everyone in a starting slot, which is exactly what `scorePeriod` counts —
  // so this header and the matchup screen cannot report different weeks. A
  // legacy week can hold more starters than there are slots; the table shows
  // those below the lineup rather than dropping them, because they scored.
  const started = players.filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
  const scored = started.reduce((a, p) => a + p.scored, 0);
  const projected = started.reduce((a, p) => a + p.projected, 0);
  const liveNow = started.filter((p) => p.games.some((g) => g.state === "live")).length;

  // The earliest game that has not started, across every player who can still
  // be moved — the deadline the page is really about.
  const next = players
    .filter((p) => !p.locked)
    .flatMap((p) => p.games.filter((g) => g.state === "upcoming" && g.tipoff !== null))
    .sort((a, b) => a.tipoff!.localeCompare(b.tipoff!))[0];

  return (
    <>
      <div className="pagehead">
        <div className="row" style={{ gap: "var(--s-4)", flexWrap: "nowrap", minWidth: 0 }}>
          <Avatar name={fantasyTeamName ?? "Team"} seed={fantasyTeamId} size="xl" mine />
          <div style={{ minWidth: 0 }}>
            <TeamNameHeading name={fantasyTeamName ?? "Team"} max={TEAM_NAME_MAX} />
            <p className="meta">
              <span>{leagueName}</span>
              <span>{roster.length} of {rosterLimit(settings)} rostered</span>
              <span>{settings.starters.map((s) => `${s.count}${s.slot}`).join(" · ")}</span>
            </p>
          </div>
        </div>
        <nav className="controls" aria-label="Week navigation">
          {period.week > (season?.first ?? 1) ? (
            <Link className="button" href={`/team?week=${period.week - 1}`}><Arrow dir="left" /> Week {period.week - 1}</Link>
          ) : null}
          {season !== null && period.week < season.last ? (
            <Link className="button" href={`/team?week=${period.week + 1}`}>Week {period.week + 1} <Arrow /></Link>
          ) : null}
          <Link className="button" href="/waivers">Add or drop</Link>
          <Link className="button" href="/league">Matchup</Link>
        </nav>
      </div>

      <DayStrip day={day} today={today} slate={slate} from={from} />

      <div className="panel">
        <div className="panel-head">
          <div className="row" style={{ gap: "var(--s-5)" }}>
            <div>
              <h2>Week {period.week} <span className="faint" style={{ fontWeight: 500 }}>· {span(period.startsOn, period.endsOn)}</span></h2>
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
              // No *movable* player has a game left, which is not the same as
              // the week being over: a roster can be locked solid on Wednesday
              // with three games still to play. Saying "every game has tipped
              // off" while the page lists a Saturday tip-off is just wrong.
              <span className="pill">
                {players.some((p) => p.games.some((g) => g.state !== "final"))
                  ? "Every starter is locked"
                  : "Week complete"}
              </span>
            ) : null}
          </div>
        </div>

        {/* One decision for the whole week: a starter is started for the period
          * and everything he plays in it counts, so the page says so once
          * rather than asking the same question again every night. */}

        {players.length === 0 && idle.length === 0 ? (
          <Empty title="Nobody plays this week" glyph="clock">
            Try another week.
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
