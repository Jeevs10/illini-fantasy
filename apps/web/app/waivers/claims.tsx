"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Claim } from "@illini/league";
import { reorder, withdraw, type WaiverActionState } from "./actions.ts";
import { Empty } from "../ui/bits.tsx";

export type ClaimRow = Claim & { runsLabel: string };

/**
 * A manager's own claims: what is still in, and what became of the rest.
 *
 * The settled half is not history for its own sake. A blind auction that only
 * ever says "you did not get him" is a black box, so every settled claim keeps
 * the sentence explaining which of the four things happened — outbid, beaten to
 * him, priced out, or refused for want of a roster spot.
 */
export function Claims({ pending, settled }: { pending: ClaimRow[]; settled: ClaimRow[] }) {
  const [state, submitWithdraw] = useActionState<WaiverActionState, FormData>(withdraw, {});
  const [, submitMove] = useActionState<WaiverActionState, FormData>(reorder, {});

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Your claims</h2>
        <span className="pill">{pending.length}</span>
      </div>

      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          </div>
        ) : null}
      </div>

      {pending.length === 0 ? (
        <Empty title="No bids in" glyph="waivers">
          A claim is sealed until the run that opens it. Bid on anyone on the
          wire and nobody &mdash; including whoever dropped him &mdash; sees
          your number before then.
        </Empty>
      ) : (
        <ol className="queue">
          {pending.map((claim, i) => (
            <li key={claim.id}>
              <span className="queue-rank num">{i + 1}</span>
              <span className="queue-who">
                <Link href={`/players/${claim.playerId}`} className="player-link">
                  {claim.playerName}
                </Link>
                <span className="sub">
                  ${claim.bid}
                  {claim.dropPlayerName ? ` · dropping ${claim.dropPlayerName}` : ""}
                  {` · opens ${claim.runsLabel}`}
                </span>
              </span>
              <span className="queue-actions">
                <form action={submitMove}>
                  <input type="hidden" name="claimId" value={claim.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button type="submit" aria-label={`Move the ${claim.playerName} claim up`} disabled={i === 0}>↑</button>
                </form>
                <form action={submitMove}>
                  <input type="hidden" name="claimId" value={claim.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button
                    type="submit"
                    aria-label={`Move the ${claim.playerName} claim down`}
                    disabled={i === pending.length - 1}
                  >↓</button>
                </form>
                <form action={submitWithdraw}>
                  <input type="hidden" name="claimId" value={claim.id} />
                  <button type="submit" aria-label={`Withdraw the bid on ${claim.playerName}`}>×</button>
                </form>
              </span>
            </li>
          ))}
        </ol>
      )}

      {pending.length > 1 ? (
        <p className="seatless">
          Order matters only against your own claims. A rival&rsquo;s higher bid
          wins whatever order you put yours in; this decides which of yours takes
          the last roster spot, or the last of the budget.
        </p>
      ) : null}

      {settled.length > 0 ? (
        <>
          <div className="panel-head" style={{ borderTop: "1px solid var(--rule)" }}>
            <h3>Settled</h3>
          </div>
          <div className="scroll">
            <table>
              <caption className="sr-only">Claims already opened, most recent first</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="r">Bid</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((claim) => (
                  <tr key={claim.id}>
                    <td>
                      <Link href={`/players/${claim.playerId}`} className="player-link">
                        {claim.playerName}
                      </Link>
                      <span className="sub">{claim.runsLabel}</span>
                    </td>
                    <td className="r num">${claim.bid}</td>
                    <td>
                      <span className={`pill ${claim.status === "won" ? "live" : ""}`}>
                        {claim.status}
                      </span>
                      {claim.reason ? <span className="sub">{claim.reason}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
