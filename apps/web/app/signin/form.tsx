"use client";

import { useActionState, useState } from "react";
import { signInWithPassword, type SignInState } from "./actions.ts";

/**
 * The sign-in form.
 *
 * A client component so a wrong password comes back as a sentence under the
 * fields rather than as a page the browser re-fetches.
 *
 * The username is controlled state rather than an uncontrolled input, because
 * React resets a form once its action resolves — which on a failed sign-in
 * meant retyping the username you had just got right. The password is left to
 * clear, which is the behaviour you want from a password field.
 */
export function SignInForm({ next }: { next: string }) {
  const [state, submit, pending] = useActionState<SignInState, FormData>(
    signInWithPassword, {},
  );
  const [username, setUsername] = useState("");

  return (
    <form action={submit}>
      <input type="hidden" name="next" value={next} />

      <label className="field">
        <span>Username</span>
        <input
          type="text"
          name="username"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={24}
          placeholder="yourname"
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
        />
      </label>

      <div role="status" aria-live="polite">
        {state.error ? <p className="notice bad">{state.error}</p> : null}
      </div>

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
