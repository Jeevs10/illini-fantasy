"use client";

import { useActionState } from "react";
import { Deal, type DealRow } from "./deal.tsx";
import { respond, withdraw, type TradeActionState } from "./actions.ts";
import { Empty } from "../ui/bits.tsx";

/**
 * Offers waiting on somebody, in both directions.
 *
 * Incoming and outgoing share a panel because they are one question — what is
 * outstanding — and separating them into two panels puts an empty box on the
 * screen of every manager who has only ever been offered a trade.
 */
export function Offers({ incoming, outgoing }: { incoming: DealRow[]; outgoing: DealRow[] }) {
  const [state, answer, answering] = useActionState<TradeActionState, FormData>(respond, {});
  const [pulled, pull, pulling] = useActionState<TradeActionState, FormData>(withdraw, {});
  const latest = (pulled.at ?? 0) > (state.at ?? 0) ? pulled : state;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Offers</h2>
        <span className="pill">{incoming.length + outgoing.length}</span>
      </div>

      <div role="status" aria-live="polite">
        {latest.error ?? latest.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${latest.error ? "bad" : "good"}`}>{latest.error ?? latest.ok}</p>
          </div>
        ) : null}
      </div>

      {incoming.length + outgoing.length === 0 ? (
        <Empty title="Nothing outstanding" glyph="trades">
          An offer stands until it is answered or it expires. Nothing moves when
          one is made &mdash; only when it is accepted, and then only after the
          review window.
        </Empty>
      ) : (
        <ul className="deals">
          {incoming.map((trade) => (
            <Deal key={trade.id} trade={trade}>
              <form action={answer}>
                <input type="hidden" name="tradeId" value={trade.id} />
                <input type="hidden" name="answer" value="accept" />
                <button type="submit" className="primary" disabled={answering}>Accept</button>
              </form>
              <form action={answer}>
                <input type="hidden" name="tradeId" value={trade.id} />
                <input type="hidden" name="answer" value="reject" />
                <button type="submit" className="danger" disabled={answering}>Turn down</button>
              </form>
              <span className="deal-note">
                Accepting is the last say either of you gets. From there it is
                the league&rsquo;s.
              </span>
            </Deal>
          ))}
          {outgoing.map((trade) => (
            <Deal key={trade.id} trade={trade}>
              <form action={pull}>
                <input type="hidden" name="tradeId" value={trade.id} />
                <button type="submit" disabled={pulling}>Withdraw</button>
              </form>
              <span className="deal-note">Yours, and unanswered.</span>
            </Deal>
          ))}
        </ul>
      )}
    </div>
  );
}
