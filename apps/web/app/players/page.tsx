import Link from "next/link";
import {
  availabilityFor, draftFor, playerPool, rosterLimit, rosterOn, settleWaivers, waiverWire,
  type PoolSort, type PositionRole,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Pool, type PoolRow } from "./pool.tsx";
import { Glyph } from "../ui/glyphs.tsx";
import { Empty, RoleGlossary, SubTabs } from "../ui/bits.tsx";

export const dynamic = "force-dynamic";

const VIEWS = [{ href: "/players", label: "Players" }, { href: "/leaders", label: "Leaders" }];
const PAGE = 50;
const ROLES: PositionRole[] = ["G", "F", "B"];
const SORTS: PoolSort[] = ["total", "avg", "games"];

export default async function PlayersPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; free?: string; page?: string; role?: string; sort?: string }> }) {
  const { q, free, page, role, sort } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, season, configId, fantasyTeamId, settings } = viewer.membership;
  const now = viewNow();

  // The pool is a place a manager arrives before the waivers page, so it has to
  // settle too — otherwise a player awarded at last night's run still reads as
  // free here, and the Add button on him would be refused.
  await settleWaivers(db, { leagueId, now });

  const roleFilter = ROLES.includes(role as PositionRole) ? (role as PositionRole) : null;
  const sortBy = SORTS.includes(sort as PoolSort) ? (sort as PoolSort) : "total";
  const offset = Math.max(0, Number(page ?? 0)) * PAGE;
  const availableOnly = free === "1";
  const [players, wire, roster, draft] = await Promise.all([
    playerPool(db, {
      leagueId, season, configId, limit: PAGE + 1, offset, availableOnly, search: q,
      roles: roleFilter ? [roleFilter] : undefined, sort: sortBy, asOf: viewDate(),
    }),
    waiverWire(db, { leagueId, now }),
    fantasyTeamId === null ? [] : rosterOn(db, fantasyTeamId, viewDate()),
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
    for (const [key, value] of Object.entries({ q, free, page, role, sort, ...over })) {
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
            <span>Ranked by season Player-Score under this league&rsquo;s config</span>
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
            {q ? `Nothing named “${q}”` : "No players"}
            {availableOnly ? " is unowned in this league." : " has scored games this season."}
          </Empty>
        </div>
      ) : (
        <Pool
          players={rows}
          offset={offset}
          full={full}
          canAct={fantasyTeamId !== null && draftComplete}
          best={Math.max(...rows.map((r) => r.averageScore), 0)}
          sort={sortBy}
          sortHrefs={{
            total: query({ sort: undefined, page: undefined }),
            avg: query({ sort: "avg", page: undefined }),
            games: query({ sort: "games", page: undefined }),
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
