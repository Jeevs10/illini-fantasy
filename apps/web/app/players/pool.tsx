"use client";

import { useActionState } from "react";
import type { PlayerAvailability, PoolPlayer, PoolSort } from "@illini/league";
import { add, type WaiverActionState } from "../waivers/actions.ts";
import { Avatar } from "../ui/identity.tsx";
import { AvailabilityTag, RoleTag, Score } from "../ui/bits.tsx";
import Link from "next/link";
import { Dot } from "../ui/playerrow.tsx";

export type PoolRow = PoolPlayer & { onWaivers: boolean; availability?: PlayerAvailability };

/** Which scoring period the table is reporting, when it is not the season. */
export interface PoolWeekView {
  week: number;
  /** The week is over, so the numbers are results and not forecasts. */
  historic: boolean;
}

/**
 * The pool, ranked, with the one verb the season has.
 *
 * A player the league has to bid for is not an "Add" that would fail — he is a
 * different transaction on a different screen, so the row links there rather
 * than offering a button that gets refused. One action state for the whole
 * list, one notice: fifty rows each with their own would mean the answer
 * appears somewhere the reader is not looking.
 */
export function Pool({
  players, offset, full, canAct, sort, sortHrefs, week = null,
}: {
  players: PoolRow[];
  offset: number;
  /** A full roster has to drop somebody, and that form lives on the waivers page. */
  full: boolean;
  canAct: boolean;
  /** The active sort, so its column header can say so. */
  sort: PoolSort;
  /** One href per sort, pre-built on the server — never a callback into a
      client component; see Phase 8's note on why that fails at runtime. */
  sortHrefs: Record<PoolSort, string>;
  /**
   * Set when the reader picked a week. The three number columns then report
   * that week rather than the season — games in it, what he banked, and where
   * the week lands — because "who is the best player" and "who should I start
   * on Thursday" are different questions and only the second one has an
   * answer that changes week to week.
   */
  week?: PoolWeekView | null;
}) {
  const [state, submit, pending] = useActionState<WaiverActionState, FormData>(add, {});

  // Whichever number this table is ranked on: the season average, or the
  // week's result, or where the week is projected to land.
  const figure = (p: PoolRow) => (week === null ? p.averageScore
    : week.historic ? p.week?.scored ?? 0 : p.week?.projected ?? 0);

  /** What he averaged inside the week — over nights he actually played. */
  const perGame = (p: PoolRow) =>
    ((p.week?.played ?? 0) === 0 ? 0 : (p.week!.scored) / p.week!.played);

  return (
    <div className="panel" data-density="compact">
      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          </div>
        ) : null}
      </div>

      <div className="pool-head">
        <span aria-hidden="true">#</span>
        <span aria-hidden="true">Player</span>
        <span className="pool-role" aria-hidden="true">Pos</span>
        {/* A finished week reads exactly like the season does, scoped to the
            week: games, per game, total. One still to come has no per-game
            result to report and one number worth ranking on, so the third
            column becomes the forecast instead. */}
        {week === null ? (
          <>
            <SortHead label="GP" sortKey="games" active={sort} href={sortHrefs.games} />
            <SortHead label="Avg" sortKey="avg" active={sort} href={sortHrefs.avg} />
            <SortHead label="Total" sortKey="total" active={sort} href={sortHrefs.total} />
          </>
        ) : week.historic ? (
          <>
            <span className="r" aria-hidden="true">G</span>
            <span className="r" aria-hidden="true">Avg</span>
            <SortHead label="Pts" sortKey="weekPts" active={sort} href={sortHrefs.weekPts} />
          </>
        ) : (
          <>
            <span className="r" aria-hidden="true">G</span>
            <SortHead label="Pts" sortKey="weekPts" active={sort} href={sortHrefs.weekPts} />
            <SortHead label="Proj" sortKey="weekProj" active={sort} href={sortHrefs.weekProj} />
          </>
        )}
        <span aria-hidden="true" style={{ textAlign: "right" }}>Status</span>
      </div>

      {players.map((player, i) => (
        <div
          className="pool-row" key={player.playerId}
          data-rail={player.primaryColor ? true : undefined}
          style={player.primaryColor ? { ["--rail" as string]: player.primaryColor } : undefined}
        >
          <span className="pool-rank tnum">{offset + i + 1}</span>

          <span className="plr-lead" style={{ minWidth: 0 }}>
            <Avatar name={player.name} seed={player.playerId} size="sm" ring={player.primaryColor} />
            <span className="plr-id">
              <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
                <Link href={`/players/${player.playerId}`} className="plr-name">{player.name}</Link>
                <AvailabilityTag status={player.availability?.status} injury={player.availability?.injury} compact />
              </span>
              <span className="plr-sub">
                <span>{player.teamName ?? "—"}</span>
                {player.conference ? (
                  <span className="pool-conf"><Dot /><span>{player.conference}</span></span>
                ) : null}
                {/* On a phone the number columns are gone, so the ranking
                    number has to travel with the name or the list is sorted by
                    something the reader cannot see. */}
                <span className="pool-inline">
                  {week === null ? (
                    <>
                      <Dot /><span>{player.averageScore.toFixed(1)} avg</span>
                      <Dot /><span>{player.games} GP</span>
                    </>
                  ) : (
                    <>
                      <Dot />
                      <span>
                        {week.historic
                          ? `${(player.week?.scored ?? 0).toFixed(1)} in week ${week.week}`
                          : `${(player.week?.projected ?? 0).toFixed(1)} proj wk ${week.week}`}
                      </span>
                      <Dot />
                      <span>{player.week?.games ?? 0} game{(player.week?.games ?? 0) === 1 ? "" : "s"}</span>
                    </>
                  )}
                </span>
              </span>
            </span>
          </span>

          <span className="pool-role"><RoleTag role={player.role} /></span>
          {week === null ? (
            <>
              <span className="pool-num r faint tnum">{player.games}</span>
              <span className="pool-num r">
                <Score value={player.averageScore} size="xs" />
              </span>
              <span className="pool-total tnum">{player.totalScore.toFixed(1)}</span>
            </>
          ) : (
            <>
              <span className="pool-num r faint tnum">{player.week?.games ?? 0}</span>
              <span className="pool-num r">
                {week.historic ? (
                  <Score
                    value={perGame(player)} size="xs"
                    tone={(player.week?.played ?? 0) === 0 ? "quiet" : "default"}
                  />
                ) : (
                  <Score
                    value={player.week?.scored ?? 0} size="xs"
                    tone={(player.week?.played ?? 0) === 0 ? "quiet" : "default"}
                  />
                )}
              </span>
              <span className="pool-total tnum">{figure(player).toFixed(1)}</span>
            </>
          )}

          <span className="pool-act">
            {player.ownedBy ? (
              <span className="pill">{player.ownedBy}</span>
            ) : player.onWaivers ? (
              <Link className="button sm" href="/waivers">Bid</Link>
            ) : canAct ? (
              <form action={submit}>
                <input type="hidden" name="playerId" value={player.playerId} />
                <input type="hidden" name="name" value={player.name} />
                <button
                  type="submit"
                  className="sm primary"
                  disabled={full || pending}
                  // Disabled says nothing about why, and why is the whole state
                  // of the roster.
                  title={full
                    ? "Your roster is full — drop somebody on the waivers page first"
                    : `Add ${player.name}`}
                >
                  Add
                </button>
              </form>
            ) : (
              <span className="pill free">Free</span>
            )}
          </span>
        </div>
      ))}

      {players.length === 0 ? null : full && canAct ? (
        <p className="seatless">
          Your roster is full. Adding anyone means dropping somebody, which is a
          single action on the <Link href="/waivers">waivers page</Link>.
        </p>
      ) : null}
    </div>
  );
}

/** A column header that is also the link to sort by it. */
function SortHead({
  label, sortKey, active, href,
}: { label: string; sortKey: PoolSort; active: PoolSort; href: string }) {
  const isActive = sortKey === active;
  return (
    <Link href={href} className="r pool-sort" data-active={isActive || undefined}
          aria-current={isActive ? "true" : undefined}>
      {label}{isActive ? <span aria-hidden="true"> ↓</span> : null}
    </Link>
  );
}
