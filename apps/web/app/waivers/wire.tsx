"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { WirePlayer } from "@illini/league";
import { bid, type WaiverActionState } from "./actions.ts";
import { Avatar } from "../ui/identity.tsx";
import { Empty } from "../ui/bits.tsx";
import { Dot } from "../ui/playerrow.tsx";

export interface Droppable { playerId: number; name: string }

/**
 * A wire row with its clear time already worded.
 *
 * Formatted on the server, deliberately. Three timezone bugs have been fixed in
 * this codebase; a browser rendering "Thursday" against its own zone while the
 * server settles the run against UTC would be the fourth.
 */
export type WireRow = WirePlayer & { clearsLabel: string };

/**
 * Everyone claimable by bid, and the form for bidding.
 *
 * The bid is sealed, so the row shows how many teams are in and never how much
 * they put up. Showing the count is the honest half: a manager is entitled to
 * know a player is contested, and not entitled to know the price.
 */
export function Wire({
  players, roster, remaining, full, canAct,
}: {
  players: WireRow[];
  roster: Droppable[];
  remaining: number;
  /** Whether a bid must name somebody to drop for there to be room. */
  full: boolean;
  canAct: boolean;
}) {
  const [state, submit, pending] = useActionState<WaiverActionState, FormData>(bid, {});

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>On the wire</h2>
          <p>Sealed bids. Nobody sees a number until the run opens them.</p>
        </div>
        <span className="pill ghost">{players.length} claimable</span>
      </div>

      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          </div>
        ) : null}
      </div>

      {players.length === 0 ? (
        <Empty title="Nobody is on waivers" glyph="waivers"
               action={<Link className="button" href="/players?free=1">Browse free agents</Link>}>
          A player lands here when somebody drops him, and stays until the next
          run. Everyone else who is unowned can simply be added.
        </Empty>
      ) : (
        players.map((player) => (
          <div className="wire-row" key={player.playerId}>
            <span className="plr-lead" style={{ minWidth: 0 }}>
              <Avatar name={player.name} seed={player.playerId} size="sm" />
              <span className="plr-id">
                <Link href={`/players/${player.playerId}`} className="plr-name">{player.name}</Link>
                <span className="plr-sub">
                  <span>{player.teamName ?? "—"}</span>
                  <Dot />
                  <span>Dropped by {player.droppedByName ?? "—"}</span>
                  <Dot />
                  <span>Clears {player.clearsLabel}</span>
                  {player.bids > 0 ? (
                    <><Dot /><span style={{ color: "var(--warn)", fontWeight: 700 }}>
                      {player.bids} bid{player.bids === 1 ? "" : "s"} in
                    </span></>
                  ) : null}
                </span>
              </span>
            </span>

            <form action={submit} className="bidform">
              <input type="hidden" name="playerId" value={player.playerId} />
              <input type="hidden" name="name" value={player.name} />
              <label className="sr-only" htmlFor={`bid-${player.playerId}`}>
                Bid on {player.name}, in dollars
              </label>
              <input
                id={`bid-${player.playerId}`}
                type="number" name="bid" min={0} max={remaining}
                defaultValue={0} inputMode="numeric" disabled={!canAct}
              />
              <label className="sr-only" htmlFor={`drop-${player.playerId}`}>
                Who to drop if you win {player.name}
              </label>
              <select
                id={`drop-${player.playerId}`}
                name="dropPlayerId" defaultValue=""
                disabled={!canAct || roster.length === 0}
              >
                <option value="">{full ? "Drop…" : "No drop"}</option>
                {roster.map((p) => (
                  <option key={p.playerId} value={p.playerId}>Drop {p.name}</option>
                ))}
              </select>
              <button type="submit" className="primary" disabled={!canAct || pending}>Bid</button>
            </form>
          </div>
        ))
      )}

      {full && players.length > 0 ? (
        <p className="seatless">
          Your roster is full, so a winning bid has to name somebody to come off.
          A claim that does not is refused at the run rather than silently
          overfilling the roster.
        </p>
      ) : null}
    </div>
  );
}
