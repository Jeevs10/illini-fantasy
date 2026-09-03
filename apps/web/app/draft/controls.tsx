"use client";

import { useActionState } from "react";
import type { DraftStatus } from "@illini/league";
import { runClock, setUpDraft, type DraftState } from "./actions.ts";

/**
 * Drawing the order.
 *
 * Shown once and then never again: a league has one draft, and re-drawing an
 * order people have already seen is not a feature. The defaults are the league
 * settings — seven starters and five bench — because a commissioner who has not
 * thought about round count should not have to.
 */
export function SetUp({
  readiness,
}: { readiness: { teams: number; rostered: number; ready: boolean } }) {
  const [state, submit, working] = useActionState<DraftState, FormData>(setUpDraft, {});

  if (!readiness.ready) {
    return (
      <div className="panel">
        <div className="empty">
          <h3>This league cannot be drafted yet</h3>
          <p>
            {readiness.rostered > 0
              ? `${readiness.rostered} players are already on rosters here. A draft deals out an empty league, so those tenures have to be released before one can be drawn.`
              : `A draft needs at least two teams and this league has ${readiness.teams}.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Set up the draft</h2>
        <p>The order is drawn at random when you create it, and cannot be redrawn.</p>
      </div>
      <div className="panel-body">
        <div role="status" aria-live="polite">
          {state.error ?? state.ok ? (
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          ) : null}
        </div>
        <form action={submit} className="inviteform">
          <label>
            <span>Rounds</span>
            <input type="number" name="rounds" min={1} max={30} defaultValue={12} required />
          </label>
          <label>
            <span>Seconds per pick</span>
            <input type="number" name="pickSeconds" min={0} max={3600} defaultValue={90} required />
          </label>
          <button type="submit" className="primary" disabled={working}>
            {working ? "Drawing…" : "Draw the order"}
          </button>
        </form>
        <p className="fineprint">
          Zero seconds means no clock at all — nobody is ever auto-picked, and the
          draft waits. Use it for a draft run in a room with everyone present.
        </p>
      </div>
    </div>
  );
}

/** Start, stop, and the escape hatch. */
export function Controls({ status, pickSeconds }: { status: DraftStatus; pickSeconds: number }) {
  const [state, submit, working] = useActionState<DraftState, FormData>(runClock, {});
  if (status === "complete") return null;

  return (
    <>
      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
        ) : null}
      </div>
      <div className="controls draft-controls">
        <form action={submit}>
          <input type="hidden" name="action" value={status === "live" ? "pause" : "start"} />
          <button type="submit" className="primary" disabled={working}>
            {status === "live" ? "Pause the clock"
              : status === "paused" ? "Resume" : "Start the draft"}
          </button>
        </form>
        <form action={submit}>
          <input type="hidden" name="action" value="finish" />
          <button type="submit" disabled={working || status === "scheduled"}>
            Auto-pick the rest
          </button>
        </form>
        <span className="faint">
          {status === "live" && pickSeconds > 0
            ? `${pickSeconds}s a pick. Resuming after a pause gives a full clock.`
            : status === "paused" ? "Nobody is on a deadline while this is stopped."
            : "Nothing is on the clock until you start it."}
        </span>
      </div>
    </>
  );
}
