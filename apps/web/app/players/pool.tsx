"use client";

import { useActionState } from "react";
import type { PoolPlayer } from "@illini/league";
import { add, type WaiverActionState } from "../waivers/actions.ts";
import { Avatar } from "../ui/identity.tsx";
import { Score } from "../ui/bits.tsx";
import Link from "next/link";
import { Dot } from "../ui/playerrow.tsx";

export type PoolRow = PoolPlayer & { onWaivers: boolean };

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
  players, offset, full, canAct, best,
}: {
  players: PoolRow[];
  offset: number;
  /** A full roster has to drop somebody, and that form lives on the waivers page. */
  full: boolean;
  canAct: boolean;
  /** The top average on this page, for the share bars. */
  best: number;
}) {
  const [state, submit, pending] = useActionState<WaiverActionState, FormData>(add, {});

  // Scaled across what is on this page rather than from zero. Fifty players
  // inside twenty points of each other all read as full bars against a zero
  // baseline, which is a column of decoration.
  const floor = Math.min(...players.map((p) => p.averageScore), best) * 0.97;
  const share = (v: number) => (best <= floor ? 0 : Math.max(5, ((v - floor) / (best - floor)) * 100));

  return (
    <div className="panel">
      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          </div>
        ) : null}
      </div>

      <div className="pool-head" aria-hidden="true">
        <span>#</span><span>Player</span><span className="pool-role">Role</span>
        <span className="r">GP</span><span className="r">Avg</span><span className="r">Total</span>
        <span style={{ textAlign: "right" }}>Status</span>
      </div>

      {players.map((player, i) => (
        <div className="pool-row" key={player.playerId}>
          <span className="pool-rank tnum">{offset + i + 1}</span>

          <span className="plr-lead" style={{ minWidth: 0 }}>
            <Avatar name={player.name} seed={player.playerId} size="sm" />
            <span className="plr-id">
              <Link href={`/players/${player.playerId}`} className="plr-name">{player.name}</Link>
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

          <span className="pool-role muted">{player.role ?? "—"}</span>
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
