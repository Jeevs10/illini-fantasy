import Link from "next/link";
import { playedWeeks, topPerformances, weeklyLeaders, type PositionRole } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate } from "../../lib/session.ts";
import { PlayerRow, Dot } from "../ui/playerrow.tsx";
import { Empty, Score, SubTabs } from "../ui/bits.tsx";

export const dynamic = "force-dynamic";

const VIEWS = [{ href: "/players", label: "Players" }, { href: "/leaders", label: "Leaders" }];
const ROLES: PositionRole[] = ["G", "F", "B"];

type Span = "day" | "week" | "month" | "season";
const SPANS: { value: Span; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "season", label: "Season" },
];

type Metric = "best" | "weekly";
const METRICS: { value: Metric; label: string }[] = [
  { value: "best", label: "Best single game" },
  { value: "weekly", label: "Cumulative by week" },
];

function shiftDate(iso: string, byDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + byDays);
  return d.toISOString().slice(0, 10);
}

/** Trailing windows off today, rather than the league's own scoring weeks —
    leaders spans every player, not just rostered ones, so it does not owe
    the matchup schedule any alignment. */
function rangeFor(span: Span, today: string, season: number): { from: string; to: string } {
  switch (span) {
    case "day": return { from: today, to: today };
    case "week": return { from: shiftDate(today, -6), to: today };
    case "month": return { from: shiftDate(today, -29), to: today };
    case "season": return { from: `${season - 1}-11-01`, to: today };
  }
}

export default async function LeadersPage({
  searchParams,
}: { searchParams: Promise<{ metric?: string; span?: string; role?: string; week?: string }> }) {
  const { metric: metricParam, span: spanParam, role, week: weekParam } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, configId, season } = viewer.membership;
  const today = viewDate();

  const metric: Metric = METRICS.some((m) => m.value === metricParam) ? (metricParam as Metric) : "best";
  const roleFilter = ROLES.includes(role as PositionRole) ? (role as PositionRole) : null;

  const query = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      metric: metricParam, span: spanParam, role, week: weekParam, ...over,
    })) {
      if (value) params.set(key, value);
    }
    const s = params.toString();
    return s ? `/leaders?${s}` : "/leaders";
  };

  const roleNav = (
    <nav className="segmented" aria-label="Role">
      <Link href={query({ role: undefined })} data-active={!roleFilter}>All</Link>
      {ROLES.map((r) => (
        <Link key={r} href={query({ role: r })} data-active={roleFilter === r}>{r}</Link>
      ))}
    </nav>
  );

  const metricNav = (
    <nav className="segmented" aria-label="Metric">
      {METRICS.map((m) => (
        <Link
          key={m.value}
          href={query({ metric: m.value === "best" ? undefined : m.value, week: undefined })}
          data-active={metric === m.value}
        >
          {m.label}
        </Link>
      ))}
    </nav>
  );

  if (metric === "weekly") {
    const weeks = await playedWeeks(db, { leagueId });
    const latest = weeks[weeks.length - 1];
    const requested = Number(weekParam);
    const selected = weeks.find((w) => w.week === requested) ?? latest ?? null;
    const index = selected ? weeks.findIndex((w) => w.week === selected.week) : -1;
    const prevWeek = index > 0 ? weeks[index - 1] : null;
    const nextWeek = index >= 0 && index < weeks.length - 1 ? weeks[index + 1] : null;

    const leaders = selected
      ? await weeklyLeaders(db, {
          leagueId, configId, from: selected.startsOn, to: selected.endsOn,
          roles: roleFilter ? [roleFilter] : undefined, limit: 25,
        })
      : [];
    const best = leaders.length === 0 ? 0 : leaders[0]!.totalScore;

    return (
      <>
        <div className="pagehead">
          <div>
            <h1>Leaders</h1>
            <p className="meta">
              <span>
                {selected ? `Cumulative score, week ${selected.week} (${selected.startsOn} → ${selected.endsOn})`
                  : "No weeks have been played yet"}
              </span>
            </p>
          </div>
          <SubTabs tabs={VIEWS} active="/leaders" />
        </div>

        <div className="controls">
          {metricNav}
          {selected ? (
            <nav className="segmented" aria-label="Week">
              <Link
                href={prevWeek ? query({ week: String(prevWeek.week) }) : query({ week: undefined })}
                aria-disabled={!prevWeek}
                tabIndex={prevWeek ? undefined : -1}
                style={prevWeek ? undefined : { pointerEvents: "none", opacity: 0.4 }}
              >
                ‹ Week {prevWeek?.week ?? ""}
              </Link>
              <span data-active style={{ pointerEvents: "none" }}>Week {selected.week}</span>
              <Link
                href={nextWeek ? query({ week: String(nextWeek.week) }) : query({ week: undefined })}
                aria-disabled={!nextWeek}
                tabIndex={nextWeek ? undefined : -1}
                style={nextWeek ? undefined : { pointerEvents: "none", opacity: 0.4 }}
              >
                Week {nextWeek?.week ?? ""} ›
              </Link>
            </nav>
          ) : null}
          {roleNav}
        </div>

        <div className="panel">
          {leaders.length === 0 ? (
            <Empty title="No weeks scored yet" glyph="trophy">
              Once a scoring week settles, its cumulative leaders show up here.
            </Empty>
          ) : (
            leaders.map((p, i) => (
              <PlayerRow
                key={p.playerId}
                playerId={p.playerId}
                name={p.playerName}
                lead={<span className="stand-rank"><span className="tnum">{i + 1}</span></span>}
                meta={
                  <>
                    <span>{p.teamName ?? "Unaffiliated"}</span>
                    <Dot /><span>{p.games} {p.games === 1 ? "game" : "games"}</span>
                    {p.ownedBy ? (<><Dot /><span>{p.ownedBy}</span></>) : null}
                  </>
                }
                right={<Score value={p.totalScore} size="sm" tone={p.totalScore === best ? "accent" : "default"} />}
              />
            ))
          )}
        </div>
      </>
    );
  }

  const span: Span = SPANS.some((s) => s.value === spanParam) ? (spanParam as Span) : "day";
  const { from, to } = rangeFor(span, today, season);

  const performances = await topPerformances(db, {
    leagueId, configId, from, to, roles: roleFilter ? [roleFilter] : undefined, limit: 25,
  });
  const best = performances.length === 0 ? 0 : performances[0]!.score;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Leaders</h1>
          <p className="meta">
            <span>Best single-game scores, {from === to ? from : `${from} → ${to}`}</span>
          </p>
        </div>
        <SubTabs tabs={VIEWS} active="/leaders" />
      </div>

      <div className="controls">
        {metricNav}
        <nav className="segmented" aria-label="Span">
          {SPANS.map((s) => (
            <Link
              key={s.value}
              href={query({ span: s.value === "day" ? undefined : s.value })}
              data-active={span === s.value}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        {roleNav}
      </div>

      <div className="panel">
        {performances.length === 0 ? (
          <Empty title="No games in this window" glyph="trophy">
            Nothing has been scored in this window yet.
          </Empty>
        ) : (
          performances.map((p, i) => (
            <PlayerRow
              key={`${p.playerId}-${p.playedOn}`}
              playerId={p.playerId}
              name={p.playerName}
              lead={<span className="stand-rank"><span className="tnum">{i + 1}</span></span>}
              meta={
                <>
                  <span>{p.teamName ?? "Unaffiliated"}</span>
                  <Dot /><span>{p.playedOn}</span>
                  {p.ownedBy ? (<><Dot /><span>{p.ownedBy}</span></>) : null}
                </>
              }
              right={<Score value={p.score} size="sm" tone={p.score === best ? "accent" : "default"} />}
            />
          ))
        )}
      </div>
    </>
  );
}
