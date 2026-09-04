import Link from "next/link";
import {
  PASSWORD_MIN, USERNAME_MAX, USERNAME_RULE, accountByEmail, inviteByToken,
} from "@illini/league";
import { db } from "../../../lib/db.ts";
import { who } from "../../../lib/session.ts";
import { Confirm } from "./confirm.tsx";
import { Register } from "./register.tsx";
import { signOutToJoin } from "./actions.ts";

export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "long", day: "numeric", timeZone: "America/New_York",
});

/**
 * Redeeming an invite.
 *
 * The commissioner hands out a link; this is where it lands. For somebody new
 * it is also where their account begins — the link is what says they are
 * allowed one, so signing up and joining are the same submit.
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
  const signInHere = `/signin?next=${encodeURIComponent(`/join/${token}`)}`;

  if (found.state === "anonymous") {
    // An address the commissioner invited may already have an account — a
    // manager in a second league, or a seat reset. Offering them a fresh
    // username would only fail on the way in.
    const existing = await accountByEmail(db, invite.email);

    if (existing) {
      return (
        <Shell title={`Join ${invite.leagueName}`}>
          <p className="muted">
            <strong>{invite.email}</strong> already has an account here. Sign in
            as <strong>{existing.username}</strong> and this page will pick the
            invite back up.
          </p>
          <Link className="button" href={signInHere}>Sign in to claim the team</Link>
        </Shell>
      );
    }

    return (
      <Shell title={`Join ${invite.leagueName}`}>
        <p className="muted">
          You are taking over{" "}
          <strong>{invite.fantasyTeamName ?? "the next unclaimed team"}</strong> as{" "}
          {invite.role === "commissioner" ? "a commissioner" : "a manager"}, under{" "}
          <strong>{invite.email}</strong>. Pick a username and a password and the
          team is yours.
        </p>
        <Register
          token={token}
          email={invite.email}
          suggestedName={invite.email.split("@")[0] ?? ""}
          rules={{
            usernameMax: USERNAME_MAX,
            usernameRule: USERNAME_RULE,
            passwordMin: PASSWORD_MIN,
          }}
        />
      </Shell>
    );
  }

  const signedInAs = found.state === "member" ? found.viewer.email : found.email;

  if (signedInAs.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell title="Signed in as somebody else">
        <p className="muted">
          This invite belongs to <strong>{invite.email}</strong>, and you are
          signed in as <strong>{signedInAs}</strong>. An invite names one seat
          and one person — sign out and take it as the address it was sent to.
        </p>
        <form action={signOutToJoin}>
          <input type="hidden" name="token" value={token} />
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
