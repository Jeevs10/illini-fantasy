"use client";

import { useActionState } from "react";
import { Deal, type DealRow } from "./deal.tsx";
import { veto, type TradeActionState } from "./actions.ts";
import { Empty } from "../ui/bits.tsx";

/**
 * Every agreed deal the league can still see coming.
 *
 * This panel is public on purpose. The window is the whole reason trades have
 * one: an agreed trade nobody can see is an agreed trade nobody can object to,
 * and a commissioner who only hears about a deal afterwards is being asked to
 * unwind it rather than to stop it.
 */
export function Review({ trades, commissioner }: { trades: DealRow[]; commissioner: boolean }) {
  const [state, submit, pending] = useActionState<TradeActionState, FormData>(veto, {});

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Under review</h2>
        <span className="pill">{trades.length}</span>
      </div>

      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          </div>
        ) : null}
      </div>

      {trades.length === 0 ? (
        <Empty title="Nothing agreed" glyph="check">
          An accepted trade waits here, in the open, before the players move.
          Anyone can see it; the commissioner can stop it.
        </Empty>
      ) : (
        <ul className="deals">
          {trades.map((trade) => (
            <Deal key={trade.id} trade={trade}>
              {commissioner ? (
                <form action={submit} className="vetoform">
                  <input type="hidden" name="tradeId" value={trade.id} />
                  <label className="sr-only" htmlFor={`veto-${trade.id}`}>
                    Why you are stopping the {trade.from.teamName} and {trade.to.teamName} trade
                  </label>
                  <input
                    id={`veto-${trade.id}`}
                    type="text"
                    name="reason"
                    placeholder="Why you are stopping it"
                    maxLength={200}
                    required
                  />
                  <button type="submit" className="danger" disabled={pending}>Veto</button>
                </form>
              ) : (
                <span className="deal-note">
                  Agreed. Only the commissioner can stop it now.
                </span>
              )}
            </Deal>
          ))}
        </ul>
      )}

      {commissioner && trades.length > 0 ? (
        <p className="seatless">
          A veto has to be said out loud &mdash; the reason is stored and shown
          to both teams. And it only works inside the window: once the players
          have moved, stopping the trade would mean rewriting who owned whom on
          nights that have already been scored.
        </p>
      ) : null}
    </div>
  );
}
