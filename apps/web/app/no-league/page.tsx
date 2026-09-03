import { signOut } from "../../auth.ts";

export default function NoLeague() {
  return (
    <div className="narrow">
      <div className="panel"><div className="panel-body">
        <h1>No league yet</h1>
        <p className="muted">
          You are signed in, but this address does not belong to a league. An
          invite has to be redeemed before a team exists to manage — ask your
          commissioner to send one.
        </p>
        <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </div></div>
  );
}
