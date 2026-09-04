"use client";

import { useActionState } from "react";
import { drawBracket, type DrawState } from "./actions.ts";

/**
 * The commissioner's one-shot button. Shown once — a bracket already drawn
 * is a bracket the standings screen won't let anyone redraw.
 */
export function DrawBracket() {
  const [state, submit, working] = useActionState<DrawState, FormData>(drawBracket, {});
  return (
    <div className="panel">
      <div className="panel-body">
        <p className="prose" style={{ margin: 0 }}>
          Drawing the bracket seeds it from the table above and locks in the
          weeks it plays across. It cannot be redrawn, so do this once the
          regular season is the one that should count.
        </p>
        <form action={submit} style={{ marginTop: "var(--s-4)" }}>
          <button className="primary" type="submit" disabled={working}>
            {working ? "Drawing…" : "Draw the bracket"}
          </button>
        </form>
        <div role="status" aria-live="polite" style={{ marginTop: "var(--s-3)" }}>
          {state.error ?? state.ok ? (
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
