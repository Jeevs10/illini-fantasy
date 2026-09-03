"use client";

import { useActionState } from "react";
import { redeem, type JoinState } from "./actions.ts";

/**
 * The last step, and a deliberate one.
 *
 * Redemption claims a team and burns the link, so it is a button rather than
 * something that happens on page load — a link preview fetcher or a second tab
 * should not be able to spend someone's invite for them.
 */
export function Confirm({ token, suggestedName }: { token: string; suggestedName: string }) {
  const [state, submit, joining] = useActionState<JoinState, FormData>(redeem, {});

  return (
    <form action={submit}>
      <input type="hidden" name="token" value={token} />
      <label className="field">
        <span>Your name</span>
        <input
          type="text"
          name="displayName"
          defaultValue={suggestedName}
          maxLength={60}
          autoComplete="name"
          placeholder="How the league sees you"
        />
      </label>

      <div role="status" aria-live="polite">
        {state.error ? <p className="notice bad">{state.error}</p> : null}
      </div>

      <button className="primary" type="submit" disabled={joining}>
        {joining ? "Joining…" : "Join the league"}
      </button>
    </form>
  );
}
