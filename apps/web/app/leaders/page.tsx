import Link from "next/link";
import { topPerformances, type PositionRole } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate } from "../../lib/session.ts";
import { PlayerRow, Dot } from "../ui/playerrow.tsx";
import { Empty, Score } from "../ui/bits.tsx";

export const dynamic = "force-dynamic";

const ROLES: PositionRole[] = ["G", "F", "B"];

type Span = "day" | "week" | "month" | "season";
const SPANS: { value: Span; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "season", label: "Season" },
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
}: { searchParams: Promise<{ span?: string; role?: string }> }) {
  const { span: spanParam, role } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, configId, season } = viewer.membership;
  const today = viewDate();

  const span: Span = SPANS.some((s) => s.value === spanParam) ? (spanParam as Span) : "day";
  const roleFilter = ROLES.includes(role as PositionRole) ? (role as PositionRole) : null;
  const { from, to } = rangeFor(span, today, season);

  const performances = await topPerformances(db, {
    leagueId, configId, from, to, roles: roleFilter ? [roleFilter] : undefined, limit: 25,
  });
  const best = performances.length === 0 ? 0 : performances[0]!.score;

  const query = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ span: spanParam, role, ...over })) {
      if (value) params.set(key, value);
    }
    const s = params.toString();
    return s ? `/leaders?${s}` : "/leaders";
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Leaders</h1>
          <p className="meta">
            <span>Best single-game scores, {from === to ? from : `${from} → ${to}`}</span>
          </p>
        </div>
      </div>

      <div className="controls">
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
        <nav className="segmented" aria-label="Role">
          <Link href={query({ role: undefined })} data-active={!roleFilter}>All</Link>
          {ROLES.map((r) => (
            <Link key={r} href={query({ role: r })} data-active={roleFilter === r}>{r}</Link>
          ))}
        </nav>
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
