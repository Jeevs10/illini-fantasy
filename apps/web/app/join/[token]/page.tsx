import Link from "next/link";
import { inviteByToken } from "@illini/league";
import { signOut } from "../../../auth.ts";
import { db } from "../../../lib/db.ts";
import { who } from "../../../lib/session.ts";
import { Confirm } from "./confirm.tsx";
import { signInToJoin } from "./actions.ts";

export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "long", day: "numeric", timeZone: "America/New_York",
});

/**
 * Redeeming an invite.
 *
 * The commissioner hands out a link; this is where it lands. Signing in is
 * required first, because the address is what the invite is addressed to and a
 * magic link is the only thing here that proves it.
 */
export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await inviteByToken(db, token);

  if (!invite) return <Dead />;

  if (invite.expired) {
    return (
      <Shell title="This link has expired">
        <p className="muted">
          The invite for <strong>{invite.email}</strong> ran out on{" "}
          {DAY.format(new Date(invite.expiresAt))}. Invites last fourteen days.
          Ask your commissioner to send a new one — creating it replaces this
          link rather than adding to it.
        </p>
      </Shell>
    );
  }

  const found = await who();

  if (found.state === "anonymous") {
    return (
      <Shell title={`Join ${invite.leagueName}`}>
        <p className="muted">
          This invite is addressed to <strong>{invite.email}</strong>
          {invite.fantasyTeamName ? <> and hands over <strong>{invite.fantasyTeamName}</strong></> : null}.
          Confirm the address is yours and a sign-in link arrives by email.
        </p>
        <form action={signInToJoin} className="joinform">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="email" value={invite.email} />
          <input type="email" value={invite.email} readOnly aria-label="Invited address" />
          <button className="primary" type="submit">Email me a link</button>
        </form>
        <p className="fineprint">
          The link comes back to this page, so the invite is still here when you
          return.
        </p>
      </Shell>
    );
  }

  const signedInAs = found.state === "member" ? found.viewer.email : found.email;

  if (signedInAs.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell title="Signed in as somebody else">
        <p className="muted">
          This invite belongs to <strong>{invite.email}</strong>, and you are
          signed in as <strong>{signedInAs}</strong>. An invite is not
          transferable — whoever holds the mailbox holds the team.
        </p>
        <form action={async () => {
          "use server";
          await signOut({ redirectTo: `/join/${encodeURIComponent(token)}` });
        }}>
          <button type="submit">Sign out and use {invite.email}</button>
        </form>
      </Shell>
    );
  }

  if (found.state === "member" && found.viewer.membership.leagueId === invite.leagueId) {
    return (
      <Shell title="You are already in">
        <p className="muted">
          {invite.email} already runs{" "}
          <strong>{found.viewer.membership.fantasyTeamName ?? "a team"}</strong> in{" "}
          {invite.leagueName}. This link is spare.
        </p>
        <Link className="button" href="/team">Go to my team</Link>
      </Shell>
    );
  }

  const suggested = found.state === "member" ? found.viewer.name : found.name;

  return (
    <Shell title={`Join ${invite.leagueName}`}>
      <p className="muted">
        You are taking over{" "}
        <strong>{invite.fantasyTeamName ?? "the next unclaimed team"}</strong> as{" "}
        {invite.role === "commissioner" ? "a commissioner" : "a manager"}.
      </p>
      <Confirm token={token} suggestedName={suggested} />
    </Shell>
  );
}

function Dead() {
  return (
    <Shell title="This link does not work">
      <p className="muted">
        An invite link works once. This one has already been redeemed, was
        revoked, or was mistyped — the three look the same from here on purpose.
        Ask your commissioner for a new one.
      </p>
      <Link className="button" href="/signin">Sign in instead</Link>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="narrow">
      <div className="panel"><div className="panel-body">
        <h1>{title}</h1>
        {children}
      </div></div>
    </div>
  );
}
