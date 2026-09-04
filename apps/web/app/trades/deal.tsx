import Link from "next/link";
import type { Trade, TradeSide, TradeStatus } from "@illini/league";
import { Avatar } from "../ui/identity.tsx";

/** How a settled trade should read. Live ones say their own thing. */
const TONE: Record<TradeStatus, string> = {
  proposed: "pill live",
  accepted: "pill live",
  executed: "pill",
  rejected: "pill",
  cancelled: "pill",
  expired: "pill",
  vetoed: "pill warn",
  invalid: "pill warn",
};

/** A trade with its times already worded. */
export type DealRow = Trade & { whenLabel: string };

function Side({ side, heading }: { side: TradeSide; heading: string }) {
  return (
    <div className="deal-side">
      <p className="deal-head">
        <Avatar name={side.teamName} seed={side.fantasyTeamId} size="xs" />
        <span className="deal-team">{side.teamName}</span>
        <span className="deal-verb">{heading}</span>
      </p>
      {side.gives.length === 0 ? (
        <p className="deal-nothing">nothing</p>
      ) : (
        <ul className="deal-players">
          {side.gives.map((player) => (
            <li key={player.playerId}>
              <Link href={`/players/${player.playerId}`} className="player-link">
                {player.name}
              </Link>
              <span className="sub">{player.teamName ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One deal, both sides of it.
 *
 * The sides are labelled by what each team *gives up* rather than by what it
 * gets, because that is the sentence a manager checks before agreeing: a trade
 * is refused over the price, not over the prize.
 *
 * Shared between the inbox, the outbox, the review window and the history, so
 * a deal looks the same wherever it is read — which is most of what makes an
 * offer legible once the reason column starts filling up.
 */
export function Deal({ trade, children }: { trade: DealRow; children?: React.ReactNode }) {
  return (
    <li className="deal" data-status={trade.status}>
      <div className="deal-sides">
        <Side side={trade.from} heading="gives" />
        <span className="deal-swap" aria-hidden="true">⇄</span>
        <Side side={trade.to} heading="gives" />
      </div>

      <p className="deal-meta">
        <span className={TONE[trade.status]}>{trade.status}</span>
        <span>{trade.whenLabel}</span>
        {trade.vetoedByName ? <span>vetoed by {trade.vetoedByName}</span> : null}
      </p>

      {trade.message ? <p className="deal-message">&ldquo;{trade.message}&rdquo;</p> : null}
      {trade.reason ? <p className="deal-reason">{trade.reason}</p> : null}

      {children ? <div className="controls deal-actions">{children}</div> : null}
    </li>
  );
}
