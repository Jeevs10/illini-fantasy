"use client";

import { useActionState, useState } from "react";
import { registerAndJoin, type JoinState } from "./actions.ts";

/**
 * The limits, passed in rather than imported.
 *
 * `@illini/league` is where they are defined, but importing a *value* from it
 * here would drag the package — and with it `pg` — into the browser bundle.
 * Types erase; constants do not. The page reads them and hands them down.
 */
export interface Rules {
  usernameMax: number;
  usernameRule: string;
  passwordMin: number;
}

/**
 * Picking a username, and with it taking the team.
 *
 * One form rather than "register, then confirm": the invite is the reason the
 * account exists, and a manager who has just chosen a password has already said
 * yes. It is still a button rather than something that happens on load, because
 * redemption burns the link and a preview fetcher should not be able to spend
 * somebody's invite for them.
 *
 * The two text fields are controlled, because React resets a form when its
 * action resolves and "that username is taken" would otherwise wipe the name
 * you typed along with the one that failed.
 */
export function Register({
  token, email, suggestedName, rules,
}: { token: string; email: string; suggestedName: string; rules: Rules }) {
  const [state, submit, joining] = useActionState<JoinState, FormData>(registerAndJoin, {});
  const [username, setUsername] = useState(
    email.split("@")[0]?.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase() ?? "");
  const [name, setName] = useState(suggestedName);

  return (
    <form action={submit}>
      <input type="hidden" name="token" value={token} />

      <label className="field">
        <span>Username</span>
        <input
          type="text"
          name="username"
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={rules.usernameMax}
          placeholder="yourname"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <small className="fineprint">{rules.usernameRule}</small>
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          required
          minLength={rules.passwordMin}
          autoComplete="new-password"
          placeholder="••••••••"
        />
        <small className="fineprint">At least {rules.passwordMin} characters.</small>
      </label>

      <label className="field">
        <span>Your name</span>
        <input
          type="text"
          name="displayName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          autoComplete="name"
          placeholder="How the league sees you"
        />
      </label>

      <div role="status" aria-live="polite">
        {state.error ? <p className="notice bad">{state.error}</p> : null}
      </div>

      <button className="primary" type="submit" disabled={joining}>
        {joining ? "Joining…" : "Create account and join"}
      </button>
    </form>
  );
}
