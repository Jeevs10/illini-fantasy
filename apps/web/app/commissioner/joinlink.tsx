"use client";

import { useActionState, useState } from "react";
import { makeJoinLink, removeFromSeat, stopJoinLink, type LinkState } from "./actions.ts";

/**
 * The league's join link: one address anyone in the program can use to take
 * the next open team. Shown in full so it can be copied again later, unlike a
 * personal invite, because it is meant to be posted where the league talks.
 */
export function JoinLinkPanel({
  url, expiresLabel, expired, openSeats,
}: { url: string | null; expiresLabel: string | null; expired: boolean; openSeats: number }) {
  const [made, make, making] = useActionState<LinkState, FormData>(makeJoinLink, {});
  const [stopped, stop, stopping] = useActionState<LinkState, FormData>(stopJoinLink, {});
  const [copied, setCopied] = useState(false);
  const latest = (stopped.at ?? 0) > (made.at ?? 0) ? stopped : made;
  const live = url !== null && !expired;

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Join link</h2>
          <p>
            Anyone with it picks a username and takes the next open team as a
            manager. It stops working once every team has one.
          </p>
        </div>
        {live ? <span className="pill">{openSeats} open {openSeats === 1 ? "seat" : "seats"}</span> : null}
      </div>
      <div className="panel-body stack-sm">
        <div role="status" aria-live="polite">
          {latest.error ?? latest.ok ? (
            <p className={`notice ${latest.error ? "bad" : "good"}`}>{latest.error ?? latest.ok}</p>
          ) : null}
        </div>
        {live ? (
          <>
            <div className="joinlink">
              <label className="sr-only" htmlFor="join-url">League join link</label>
              <input id="join-url" type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="primary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
            </div>
            {/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) ? (
              // Copied from a dev server, the link points at the copier's own
              // computer and opens nothing for anyone else.
              <p className="notice bad">
                This address points at this computer, so it will not open for
                anyone else. Copy the link from the live site instead.
              </p>
            ) : null}
            <p className="fineprint">
              Works until {expiresLabel}
              {openSeats === 0 ? ", but every team has a manager, so nobody can use it now" : ""}.
              If it reaches someone it should not, make a new one: the old link stops working at once.
            </p>
            <div className="controls">
              <form action={make}>
                <input type="hidden" name="replace" value="1" />
                <button type="submit" disabled={making}>Make a new link</button>
              </form>
              <form action={stop}>
                <button type="submit" className="danger" disabled={stopping}>Turn off</button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              {url !== null && expired ? `The last link expired ${expiresLabel}. ` : ""}
              No join link is live. Personal invites below still work.
            </p>
            <form action={make}>
              <button type="submit" className="primary" disabled={making || openSeats === 0}>
                Make a join link
              </button>
            </form>
            {openSeats === 0 ? <p className="fineprint">Every team has a manager, so there is nothing to join.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Taking a manager off a seat, in two presses: the first says what will
 * happen, the second does it. No browser dialog, so the page keeps its focus.
 */
export function RemoveSeat({ teamId, teamName, owner }: { teamId: number; teamName: string; owner: string }) {
  const [state, submit, pending] = useActionState<LinkState, FormData>(removeFromSeat, {});
  const [asking, setAsking] = useState(false);
  if (state.ok) return <span className="faint">{state.ok}</span>;
  return (
    <span className="seat-remove">
      {state.error ? <span className="faint" role="alert">{state.error} </span> : null}
      {asking ? (
        <form action={submit} className="row" style={{ gap: "var(--s-2)", justifyContent: "flex-end" }}>
          <input type="hidden" name="fantasyTeamId" value={teamId} />
          <button type="submit" className="sm danger" disabled={pending}
                  aria-label={`Confirm removing ${owner} from ${teamName}`}>
            Remove {owner}
          </button>
          <button type="button" className="sm" onClick={() => setAsking(false)}>Keep</button>
        </form>
      ) : (
        <button type="button" className="sm" onClick={() => setAsking(true)}
                aria-label={`Remove ${owner} from ${teamName}`}>
          Remove
        </button>
      )}
    </span>
  );
}
