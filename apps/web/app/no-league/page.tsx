import { signOut } from "../../auth.ts";

export default function NoLeague() {
  return (
    <div className="narrow">
      <div className="panel"><div className="panel-body">
        <h1>No league yet</h1>
        <p className="muted">
          You are signed in, but this address does not belong to a league. An
          invite has to be redeemed before a team exists to manage.
        </p>
        <p className="muted">
          If your commissioner has sent you a link, open it now — you are signed
          in, so it will go straight through. Otherwise ask them for one; a link
          is issued to a single address and works once.
        </p>
        <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </div></div>
  );
}
