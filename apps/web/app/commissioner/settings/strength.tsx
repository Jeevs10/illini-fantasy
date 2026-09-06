"use client";

import { useActionState } from "react";
import type { StrengthAdjustment } from "@illini/league";
import { setStrength, type StrengthState } from "./actions.ts";

/**
 * Whether a score counts who it was scored against.
 *
 * Given its own panel rather than a row in the settings form, because it is
 * not the same kind of setting. Everything in that form binds what happens
 * next; this one changes what every unsettled week is currently worth, and a
 * control that rewrites the standings should not sit in a grid of spinners
 * beside "bench seats" as though it were one of them.
 */
export function StrengthToggle({ state: current }: { state: StrengthAdjustment }) {
  const [state, submit, pending] = useActionState<StrengthState, FormData>(setStrength, {});
  const on = state.on ?? current.on;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Strength of schedule</h2>
          <p>
            Every score ends in a multiplier for who the player was up against,
            from &times;0.67 against the weakest opponents to &times;1.33
            against the strongest. Turn it off and the box score is the box
            score.
          </p>
        </div>
        <span className={`pill ${on ? "live" : "ghost"}`}>{on ? "Adjusted" : "Flat"}</span>
      </div>

      <div className="panel-body">
        <p className="prose" style={{ margin: 0 }}>
          Both versions of every night are already stored, so this switches
          between them rather than re-scoring anything — nothing is lost, and
          it can be switched back.{" "}
          {current.settledWeeks > 0 ? (
            <>
              The {current.settledWeeks} week
              {current.settledWeeks === 1 ? "" : "s"} already settled keep the
              rules they settled under; every week that has not settled will
              move, including the one being played.
            </>
          ) : (
            <>Nothing has settled yet, so this applies to the whole season.</>
          )}
        </p>

        <div role="status" aria-live="polite">
          {state.error ?? state.ok ? (
            <p className={`notice ${state.error ? "bad" : "good"}`} style={{ marginTop: "var(--s-4)" }}>
              {state.error ?? state.ok}
            </p>
          ) : null}
        </div>

        <form action={submit} className="controls" style={{ marginTop: "var(--s-4)" }}>
          <input type="hidden" name="on" value={on ? "off" : "on"} />
          <button type="submit" disabled={pending} className={on ? "" : "primary"}>
            {pending
              ? "Switching…"
              : on ? "Turn the adjustment off" : "Turn the adjustment back on"}
          </button>
          <span className="faint" style={{ fontSize: "var(--t-sm)" }}>
            {on
              ? "Scores will become raw production, ignoring the opponent."
              : "Scores will be weighted by opponent strength again."}
          </span>
        </form>
      </div>
    </div>
  );
}
