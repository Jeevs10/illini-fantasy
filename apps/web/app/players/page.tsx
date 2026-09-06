import Link from "next/link";
import {
  availabilityFor, draftFor, playerPool, rosterLimit, rosterOn, seasonSchedule, settleWaivers,
  waiverWire, type PoolSort, type PoolWindow, type PositionRole,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Pool, type PoolRow } from "./pool.tsx";
import { WeekPicker } from "./weekpicker.tsx";
import { Glyph } from "../ui/glyphs.tsx";
import { Empty, RoleGlossary, SubTabs } from "../ui/bits.tsx";

export const dynamic = "force-dynamic";

const VIEWS = [{ href: "/players", label: "Players" }, { href: "/leaders", label: "Leaders" }];
const PAGE = 50;
const ROLES: PositionRole[] = ["G", "F", "B"];
const SORTS: PoolSort[] = ["total", "avg", "games", "weekProj", "weekPts"];

const SPAN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (from: string, to: string) =>
  `${SPAN.format(new Date(`${from}T00:00:00Z`))}–${SPAN.format(new Date(`${to}T00:00:00Z`))}`;

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; free?: string; page?: string; role?: string; sort?: string; week?: string;
  }>;
}) {
  const { q, free, page, role, sort, week } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, season, configId, fantasyTeamId, settings } = viewer.membership;
  const now = viewNow();

  // The pool is a place a manager arrives before the waivers page, so it has to
  // settle too — otherwise a player awarded at last night's run still reads as
  // free here, and the Add button on him would be refused.
  await settleWaivers(db, { leagueId, now });

  const roleFilter = ROLES.includes(role as PositionRole) ? (role as PositionRole) : null;
  const offset = Math.max(0, Number(page ?? 0)) * PAGE;
  const availableOnly = free === "1";
  const today = viewDate();

  // Which scoring period the ranking is about, if the reader picked one. The
  // schedule is what a week even means here — the pool has no calendar of its
  // own, and inventing seven-day blocks beside the league's would rank a
  // "week" no matchup is ever played over.
  const schedule = await seasonSchedule(db, leagueId);
  const picked = week ? schedule.find((w) => w.week === Number(week)) ?? null : null;
  const window: PoolWindow | undefined = picked === null
    ? undefined
    : { from: picked.startsOn, to: picked.endsOn, today };
  // A week already behind us has nothing left to project, so ranking it by a
  // projection would be ranking it by its own result under a misleading
  // heading. It is sorted, and read, on what actually happened — which is what
  // makes the picker useful for scouting a free agent's last month as well as
  // for planning next week.
  const historic = picked !== null && picked.endsOn < today;
  const defaultSort: PoolSort = picked === null ? "total" : historic ? "weekPts" : "weekProj";
  const asked = SORTS.includes(sort as PoolSort) ? (sort as PoolSort) : null;
  const sortBy: PoolSort = asked ?? defaultSort;

  const [players, wire, roster, draft] = await Promise.all([
    playerPool(db, {
      leagueId, season, configId, limit: PAGE + 1, offset, availableOnly, search: q,
      roles: roleFilter ? [roleFilter] : undefined, sort: sortBy, asOf: today, window,
    }),
    waiverWire(db, { leagueId, now }),
    fantasyTeamId === null ? [] : rosterOn(db, fantasyTeamId, today),
    draftFor(db, leagueId),
  ]);
  const draftComplete = draft?.status === "complete";
  const onWaivers = new Set(wire.map((w) => w.playerId));
  const hasMore = players.length > PAGE;
  const paged = players.slice(0, PAGE);
  const availability = await availabilityFor(db, paged.map((p) => p.playerId));
  const rows: PoolRow[] = paged.map((p) => ({
    ...p, onWaivers: onWaivers.has(p.playerId), availability: availability.get(p.playerId),
  }));

  const query = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, free, page, role, sort, week, ...over })) {
      if (value) params.set(key, value);
    }
    const s = params.toString();
    return s ? `/players?${s}` : "/players";
  };

  const full = roster.length >= rosterLimit(settings);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Players</h1>
          <p className="meta">
            <span>
              {picked === null
                ? "Ranked by season Player-Score under this league\u2019s config"
                : historic
                ? `Week ${picked.week} · ${span(picked.startsOn, picked.endsOn)} · what they actually scored`
                : `Week ${picked.week} · ${span(picked.startsOn, picked.endsOn)} · projected from form and the slate`}
            </span>
            {wire.length > 0 ? <span>{wire.length} on waivers</span> : null}
            {fantasyTeamId !== null
              ? <span>{roster.length} of {rosterLimit(settings)} rostered</span>
              : null}
          </p>
        </div>
        <SubTabs tabs={VIEWS} active="/players" />
      </div>

      <RoleGlossary />

      {/* The controls stay put while fifty rows scroll under them: a filter you
          have to scroll back up to change is a filter nobody changes. */}
      <div className="stickybar">
        <form className="controls" action="/players" style={{ flexWrap: "nowrap", gap: "var(--s-2)" }}>
          <span className="searchfield">
            <span className="glyph"><Glyph name="search" size={17} /></span>
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="Search a name"
                   aria-label="Search players by name" />
          </span>
          {availableOnly ? <input type="hidden" name="free" value="1" /> : null}
          {roleFilter ? <input type="hidden" name="role" value={roleFilter} /> : null}
          {picked ? <input type="hidden" name="week" value={picked.week} /> : null}
          <button type="submit">Search</button>
        </form>
        <div className="controls" style={{ marginTop: "var(--s-2)" }}>
          <nav className="segmented" aria-label="Availability">
            <Link href={query({ free: undefined, page: undefined })} data-active={!availableOnly}>
              Everyone
            </Link>
            <Link href={query({ free: "1", page: undefined })} data-active={availableOnly}>
              Free agents
            </Link>
          </nav>
          <nav className="segmented" aria-label="Role">
            <Link href={query({ role: undefined, page: undefined })} data-active={!roleFilter}>
              All
            </Link>
            {ROLES.map((r) => (
              <Link key={r} href={query({ role: r, page: undefined })} data-active={roleFilter === r}>
                {r}
              </Link>
            ))}
          </nav>
          <WeekPicker
            weeks={schedule.map((w) => ({ week: w.week, label: span(w.startsOn, w.endsOn) }))}
            active={picked?.week ?? null}
            hidden={Object.fromEntries(Object.entries({ q, free, role })
              .filter(([, v]) => Boolean(v)) as [string, string][])}
          />
          {q ? (
            <Link className="button sm" href={query({ q: undefined, page: undefined })}>
              Clear &ldquo;{q}&rdquo; ×
            </Link>
          ) : null}
          {full && fantasyTeamId !== null ? (
            <span className="pill warn">Roster full — drop first</span>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="panel">
          <Empty title="No players match" glyph="search"
                 action={<Link className="button" href="/players">Clear filters</Link>}>
            {q ? `Nothing named \u201c${q}\u201d` : "No players"}
            {availableOnly ? " is unowned in this league." : " has scored games this season."}
          </Empty>
        </div>
      ) : (
        <Pool
          players={rows}
          offset={offset}
          full={full}
          canAct={fantasyTeamId !== null && draftComplete}
          week={picked === null ? null : { week: picked.week, historic }}
          sort={sortBy}
          sortHrefs={{
            total: query({ sort: undefined, page: undefined }),
            avg: query({ sort: "avg", page: undefined }),
            games: query({ sort: "games", page: undefined }),
            weekProj: query({ sort: "weekProj", page: undefined }),
            weekPts: query({ sort: "weekPts", page: undefined }),
          }}
        />
      )}

      <nav className="controls" aria-label="Pages">
        {offset > 0 ? (
          <Link className="button" href={query({ page: String(offset / PAGE - 1) })}>← Previous</Link>
        ) : null}
        <span className="faint" style={{ fontSize: "var(--t-sm)" }}>
          {offset + 1}–{offset + rows.length}
        </span>
        {hasMore ? (
          <Link className="button" href={query({ page: String(offset / PAGE + 1) })}>Next →</Link>
        ) : null}
      </nav>
    </>
  );
}
