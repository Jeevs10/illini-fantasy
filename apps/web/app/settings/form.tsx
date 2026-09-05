"use client";

import { useActionState, useState } from "react";
import { changeMyPassword, renameAccount, type PasswordState, type RenameState } from "./actions.ts";

/**
 * The limits, passed in rather than imported live — `join/[token]/register.tsx`
 * carries the same comment: `@illini/league` drags `pg` into the browser
 * bundle if a value (not just a type) is pulled from it in a client component.
 */
export interface Rules {
  usernameMax: number;
  usernameRule: string;
  passwordMin: number;
}

export function AccountForms({ username, rules }: { username: string; rules: Rules }) {
  return (
    <>
      <RenameForm username={username} rules={rules} />
      <PasswordForm rules={rules} />
    </>
  );
}

function RenameForm({ username, rules }: { username: string; rules: Rules }) {
  const [state, submit, saving] = useActionState<RenameState, FormData>(renameAccount, {});
  // Controlled, the same reason SignInForm's username field is: a failed
  // submit would otherwise wipe out what was typed along with the attempt.
  const [value, setValue] = useState(username);

  return (
    <form action={submit} className="panel">
      <div className="panel-head">
        <div>
          <h2>Username</h2>
          <p>What you sign in as.</p>
        </div>
      </div>
      <div className="panel-body">
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
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <small className="fineprint">{rules.usernameRule}</small>
        </label>

        <div role="status" aria-live="polite">
          {state.error ?? state.ok ? (
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          ) : null}
        </div>

        <div className="controls">
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Change username"}
          </button>
        </div>
      </div>
    </form>
  );
}

function PasswordForm({ rules }: { rules: Rules }) {
  const [state, submit, saving] = useActionState<PasswordState, FormData>(changeMyPassword, {});

  return (
    <form action={submit} className="panel">
      <div className="panel-head">
        <div>
          <h2>Password</h2>
          <p>Changing it does not sign out any session already open.</p>
        </div>
      </div>
      <div className="panel-body">
        <label className="field">
          <span>Current password</span>
          <input
            type="password" name="current" required
            autoComplete="current-password" placeholder="••••••••"
          />
        </label>

        <label className="field">
          <span>New password</span>
          <input
            type="password" name="next" required
            minLength={rules.passwordMin}
            autoComplete="new-password" placeholder="••••••••"
          />
          <small className="fineprint">At least {rules.passwordMin} characters.</small>
        </label>

        <div role="status" aria-live="polite">
          {state.error ?? state.ok ? (
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          ) : null}
        </div>

        <div className="controls">
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Change password"}
          </button>
        </div>
      </div>
    </form>
  );
}
