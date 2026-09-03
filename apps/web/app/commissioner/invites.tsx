"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Invite, LeagueTeam } from "@illini/league";
import { revoke, sendInvite, type InviteState } from "./actions.ts";

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "America/New_York",
});

/**
 * The invite desk: create one, see what is outstanding, kill one.
 *
 * Both actions share a single notice region rather than one each, because the
 * two are the same conversation — you revoke a link and immediately send its
 * replacement, and two stacked banners saying opposite things is worse than
 * one saying the latest.
 */
export function Invites({ teams, open }: { teams: LeagueTeam[]; open: Invite[] }) {
  const [sent, submitInvite, sending] = useActionState<InviteState, FormData>(sendInvite, {});
  const [killed, submitRevoke] = useActionState<InviteState, FormData>(revoke, {});

  // Whichever happened last, not whichever is listed first: revoking an invite
  // has to be able to replace the banner the creation left behind.
  const latest = (killed.at ?? 0) > (sent.at ?? 0) ? killed : sent;
  const message = latest.error ?? latest.ok;
  const bad = Boolean(latest.error);

  // A link the commissioner just killed must not stay on screen offering itself
  // for sending. Revoking somebody else's invite leaves this one alone, since
  // the link is unrecoverable and clearing it costs a seat's worth of work.
  const linkIsDead = latest === killed && killed.revokedEmail === sent.linkFor;

  const unclaimed = teams.filter((t) => t.ownerId === null);
  const named = new Map(teams.map((t) => [t.id, t.name]));

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>Invite a manager</h2>
          <p>
            {unclaimed.length === 0
              ? "Every team is claimed. A new invite needs a seat to hand over."
              : `${unclaimed.length} team${unclaimed.length === 1 ? "" : "s"} still unclaimed.`}
          </p>
        </div>

        <div className="panel-body">
          <form action={submitInvite} className="inviteform">
            <label>
              <span>Email</span>
              <input
                type="email"
                name="email"
                required
                placeholder="manager@example.com"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Team</span>
              <select name="fantasyTeamId" defaultValue="">
                <option value="">Next unclaimed</option>
                {unclaimed.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <button className="primary" type="submit" disabled={sending}>
              {sending ? "Creating…" : "Create invite"}
            </button>
          </form>

          <div role="status" aria-live="polite">
            {message ? <p className={`notice ${bad ? "bad" : "good"}`}>{message}</p> : null}
            {sent.link && !linkIsDead
              ? <OneTimeLink key={sent.at} link={sent.link} email={sent.linkFor ?? ""} />
              : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Outstanding invites</h2>
          <p>Links that have been created and not yet redeemed.</p>
        </div>

        {open.length === 0 ? (
          <div className="empty">
            <h3>Nothing outstanding</h3>
            <p>
              Every invite has been redeemed or revoked. Creating a second link
              for an address replaces the first, so there is never more than one
              live link per person.
            </p>
          </div>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">Invites awaiting redemption</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Team</th>
                  <th scope="col">Role</th>
                  <th scope="col">Expires</th>
                  <th scope="col" className="r">Revoke</th>
                </tr>
              </thead>
              <tbody>
                {open.map((invite) => (
                  <tr key={invite.id}>
                    <td style={{ fontWeight: 600 }}>{invite.email}</td>
                    <td className="muted">
                      {invite.fantasyTeamId === null
                        ? "Next unclaimed"
                        : named.get(invite.fantasyTeamId) ?? `Team ${invite.fantasyTeamId}`}
                    </td>
                    <td><span className="tag">{invite.role}</span></td>
                    <td className="num faint">
                      <time dateTime={invite.expiresAt}>
                        {DAY.format(new Date(invite.expiresAt))}
                      </time>
                    </td>
                    <td className="r">
                      <form action={submitRevoke}>
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <input type="hidden" name="email" value={invite.email} />
                        <RevokeButton email={invite.email} />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** Pending state per row, so revoking one invite does not grey out the rest. */
function RevokeButton({ email }: { email: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-label={`Revoke the invite for ${email}`}>
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}

/**
 * The link, shown once.
 *
 * Only the token's hash is stored, so this is the single moment it is legible.
 * That is worth saying on the page rather than in a comment: a commissioner who
 * navigates away assuming they can come back finds the invite listed with no
 * way to resend it, and has to create a replacement.
 */
function OneTimeLink({ link, email }: { link: string; email: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="onetime">
      <p className="onetime-head">
        Send this to <strong>{email}</strong> — it is not stored and will not be shown again.
      </p>
      <div className="onetime-row">
        <input
          readOnly
          value={link}
          aria-label={`Invite link for ${email}`}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              // Clipboard access needs a secure context; the field is selectable
              // either way, so say so rather than failing silently.
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="onetime-foot">
        The link works once, only for that address, and expires in 14 days.
      </p>
    </div>
  );
}
