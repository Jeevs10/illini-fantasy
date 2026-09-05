import { PASSWORD_MIN, USERNAME_MAX, USERNAME_RULE } from "@illini/league";
import { requireViewer } from "../../lib/session.ts";
import { AccountForms } from "./form.tsx";

export const dynamic = "force-dynamic";

/**
 * A manager's own account, as opposed to `/commissioner/settings`'s league
 * settings — `changePassword`/`setUsername` have existed in `@illini/league`
 * since the password sign-in phase, with nothing calling them until this.
 */
export default async function Settings() {
  const viewer = await requireViewer();

  return (
    <div className="narrow">
      <div className="pagehead">
        <div>
          <h1>Your account</h1>
          <p className="meta">
            <span>{viewer.email}</span>
          </p>
        </div>
      </div>

      <AccountForms
        username={viewer.username}
        rules={{ usernameMax: USERNAME_MAX, usernameRule: USERNAME_RULE, passwordMin: PASSWORD_MIN }}
      />
    </div>
  );
}
