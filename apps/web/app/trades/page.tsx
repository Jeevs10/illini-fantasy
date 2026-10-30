import Link from "next/link";
import {
  listTrades, settleTrades, tradeableRosters, tradingClosed, type Trade,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Propose } from "./propose.tsx";
import { Offers } from "./offers.tsx";
import { Review } from "./review.tsx";
import { Deal, type DealRow } from "./deal.tsx";
import { Empty } from "../ui/bits.tsx";

export const dynamic = "force-dynamic";

/** Eastern, because the league is. Formatted here, never in the browser. */
const WHEN = new Intl.DateTimeFormat("en-US", {
  weekday: "short", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York", timeZoneName: "short",
});

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "America/New_York",
});

/** The deadline is a date rather than a moment, so it is read in UTC. */
const DEADLINE = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
});

/**
 * The one time on a trade that matters, worded.
 *
 * Which one it is depends on where the trade stands: an offer is about to
 * expire, an accepted deal is about to happen, and a settled one already did.
 * Three columns of dates would say the same thing and be read by nobody.
 */
function when(trade: Trade): string {
  if (trade.status === "proposed") return `expires ${WHEN.format(new Date(trade.expiresAt))}`;
  if (trade.status === "accepted") return `moves ${WHEN.format(new Date(trade.executesAt!))}`;
  if (trade.executedOn) return `${DAY.format(new Date(`${trade.executedOn}T12:00:00Z`))}`;
  return trade.settledAt ? DAY.format(new Date(trade.settledAt)) : "";
}

const worded = (trades: Trade[]): DealRow[] =>
  trades.map((trade) => ({ ...trade, whenLabel: when(trade) }));

export default async function TradesPage() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, fantasyTeamId, role, settings } = viewer.membership;
  const now = viewNow();
  const closed = tradingClosed(settings, now);

  // Reading is what executes them. There is no worker: any manager who loads
  // this page after a review window closes moves the players, at the moment the
  // window closed, and every later reader finds it already done.
  await settleTrades(db, { leagueId, now });

  const [rosters, ours, review, everything] = await Promise.all([
    tradeableRosters(db, { leagueId, on: viewDate() }),
    fantasyTeamId === null ? [] : listTrades(db, { leagueId, involving: fantasyTeamId }),
    listTrades(db, { leagueId, statuses: ["accepted"] }),
    listTrades(db, { leagueId, limit: 20 }),
  ]);

  const mine = rosters.find((t) => t.fantasyTeamId === fantasyTeamId);
  const others = rosters.filter((t) => t.fantasyTeamId !== fantasyTeamId);
  const incoming = ours.filter((t) => t.status === "proposed" && t.to.fantasyTeamId === fantasyTeamId);
  const outgoing = ours.filter((t) => t.status === "proposed" && t.from.fantasyTeamId === fantasyTeamId);
  const history = everything.filter((t) => t.status !== "proposed" && t.status !== "accepted");

  return (
    <>
      <div className="pagehead">
        <div>
        <h1>Trades</h1>
        <p className="meta">
          <span>{leagueName}</span>
          <span>
            {settings.tradeReviewHours === 0
              ? "No review window"
              : `${settings.tradeReviewHours}-hour review window`}
          </span>
          <span>Offers stand {settings.tradeOfferDays} days</span>
          {settings.tradeDeadline === null ? null : (
            <span>
              {closed ? "Trading closed" : "Deadline"}{" "}
              {DEADLINE.format(new Date(`${settings.tradeDeadline}T12:00:00Z`))}
            </span>
          )}
        </p>
        </div>
        <div className="controls">
          <Link className="button" href="/team">Your roster</Link>
          <Link className="button" href="/waivers">Waivers</Link>
        </div>
      </div>

      {/* An offer to you is the one thing here with a clock you must answer,
          so it comes before anything you might start. */}
      {incoming.length > 0 ? <Offers incoming={worded(incoming)} outgoing={[]} title="Waiting on you" /> : null}

      <div className="tradegrid">
        <div className="tradegrid-main">
          {fantasyTeamId === null || !mine ? (
            <div className="panel">
              <Empty title="No team here" glyph="team">
                You are a member of {leagueName} but do not run a team in it, so
                there is nobody to trade. Everything agreed in the league is
                alongside.
              </Empty>
            </div>
          ) : closed ? (
            // The form is gone rather than disabled. A control that argues with
            // you after you have filled it in is worse than one that was never
            // offered, and the deadline is not a thing a manager can fix.
            <div className="panel">
              <Empty title="Trading is closed" glyph="swap">
                Nothing has been offered or agreed in {leagueName} since{" "}
                {DEADLINE.format(new Date(`${settings.tradeDeadline!}T12:00:00Z`))}. Deals
                agreed before then still executed when their review window closed.
              </Empty>
            </div>
          ) : (
            <Propose mine={mine} others={others} />
          )}
        </div>

        <aside className="tradegrid-rail" aria-label="Trades in the league">
          {outgoing.length > 0 ? <Offers incoming={[]} outgoing={worded(outgoing)} title="Your open offers" /> : null}
          {/* Public on purpose, and only drawn when something is in it: the
              review window is in the page meta for anyone who wants the rule. */}
          {review.length > 0 ? <Review trades={worded(review)} commissioner={role === "commissioner"} /> : null}

          <div className="panel">
            <div className="panel-head">
              <h2>Trade history</h2>
              {history.length > 0 ? <span className="pill">{history.length}</span> : null}
            </div>
            {history.length === 0 ? (
              <p className="panel-body faint">
                Nothing has been traded in {leagueName} this season. Settled,
                turned-down and vetoed deals all land here.
              </p>
            ) : (
              <>
                <ul className="deals">
                  {worded(history).map((trade) => <Deal key={trade.id} trade={trade} />)}
                </ul>
                <p className="seatless">
                  A trade that could not be honoured says so rather than
                  disappearing: the sentence names the player whose move voided it.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
