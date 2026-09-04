import { redirect } from "next/navigation";
import { safeNext, sessionUser } from "../../lib/auth.ts";
import { SignInForm } from "./form.tsx";

export default async function SignIn({
  searchParams,
}: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safeNext(next, "/home");

  // Without this the layout renders the signed-in masthead above a form telling
  // you to sign in.
  if (await sessionUser()) redirect(destination);

  return (
    <div className="narrow">
      <div className="signin-brand">
        <span className="mark" aria-hidden="true">IF</span>
        <div>
          <h1>Illini Fantasy Hoops</h1>
          <p className="faint" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
            College basketball, scored on the CBB Player-Score model
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <SignInForm next={destination} />
        </div>
        <p className="seatless">
          No account yet? A league is invite-only — your commissioner sends a
          link, and picking a username is the last step of redeeming it. Lost
          your password? Your commissioner can set a new one.
        </p>
      </div>
    </div>
  );
}
