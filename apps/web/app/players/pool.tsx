"use client";

import { useActionState } from "react";
import type { PlayerAvailability, PoolPlayer, PoolSort } from "@illini/league";
import { add, type WaiverActionState } from "../waivers/actions.ts";
import { Avatar } from "../ui/identity.tsx";
import { AvailabilityTag, RoleTag, Score } from "../ui/bits.tsx";
import Link from "next/link";
import { Dot } from "../ui/playerrow.tsx";

export type PoolRow = PoolPlayer & { onWaivers: boolean; availability?: PlayerAvailability };

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
  players, offset, full, canAct, best, sort, sortHrefs,
}: {
  players: PoolRow[];
  offset: number;
  /** A full roster has to drop somebody, and that form lives on the waivers page. */
  full: boolean;
  canAct: boolean;
  /** The top average on this page, for the share bars. */
  best: number;
  /** The active sort, so its column header can say so. */
  sort: PoolSort;
  /** One href per sort, pre-built on the server — never a callback into a
      client component; see Phase 8's note on why that fails at runtime. */
  sortHrefs: Record<PoolSort, string>;
}) {
  const [state, submit, pending] = useActionState<WaiverActionState, FormData>(add, {});

  // Scaled across what is on this page rather than from zero. Fifty players
  // inside twenty points of each other all read as full bars against a zero
  // baseline, which is a column of decoration.
  const floor = Math.min(...players.map((p) => p.averageScore), best) * 0.97;
  const share = (v: number) => (best <= floor ? 0 : Math.max(5, ((v - floor) / (best - floor)) * 100));

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
        <SortHead label="GP" sortKey="games" active={sort} href={sortHrefs.games} />
        <SortHead label="Avg" sortKey="avg" active={sort} href={sortHrefs.avg} />
        <SortHead label="Total" sortKey="total" active={sort} href={sortHrefs.total} />
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
                <span className="pool-inline">
                  <Dot /><span>{player.averageScore.toFixed(1)} avg</span>
                  <Dot /><span>{player.games} GP</span>
                </span>
              </span>
            </span>
          </span>

          <span className="pool-role"><RoleTag role={player.role} /></span>
          <span className="pool-num r faint tnum">{player.games}</span>
          <span className="pool-num r">
            <Score value={player.averageScore} size="xs" />
          </span>
          <span className="pool-total">
            <span className="tnum faint" style={{ fontSize: "var(--t-xs)" }}>{player.totalScore.toFixed(1)}</span>
            <span className="bar thin" aria-hidden="true">
              <span style={{ width: `${share(player.averageScore)}%` }} />
            </span>
          </span>

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
