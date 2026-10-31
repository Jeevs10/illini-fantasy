"use client";

import { useActionState } from "react";
import { Deal, type DealRow } from "./deal.tsx";
import { respond, withdraw, type TradeActionState } from "./actions.ts";
import { Empty } from "../ui/bits.tsx";

/**
 * Offers waiting on somebody.
 *
 * The page asks this for one direction at a time: offers waiting on you lead
 * the page, because they are the only thing on it with a clock you have to
 * answer, and your own unanswered ones sit in the rail. Neither is drawn when
 * it is empty, so the empty state only shows if the page passes both.
 */
export function Offers({
  incoming, outgoing, title = "Offers",
}: { incoming: DealRow[]; outgoing: DealRow[]; title?: string }) {
  const [state, answer, answering] = useActionState<TradeActionState, FormData>(respond, {});
  const [pulled, pull, pulling] = useActionState<TradeActionState, FormData>(withdraw, {});
  const latest = (pulled.at ?? 0) > (state.at ?? 0) ? pulled : state;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
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
          No offers waiting.
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
