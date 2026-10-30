"use server";

import { revalidatePath } from "next/cache";
import {
  createJoinLink, inviteToLeague, removeManager, revokeInvite, revokeJoinLink, teamsInLeague,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";
import { joinUrl } from "../../lib/join.ts";

export interface InviteState {
  error?: string;
  ok?: string;
  /**
   * When this result was produced.
   *
   * Creating and revoking are two independent action states on one panel, and
   * React holds both. Without a stamp there is no way to tell which one
   * happened last, and a fixed priority leaves the older banner standing —
   * "Invite created" sitting above an invite that was just revoked.
   */
  at?: number;
  /** The address whose invite was revoked, so a dead link can be taken off screen. */
  revokedEmail?: string;
  /**
   * The one-time link, held in the client's action state and nowhere else.
   *
   * Only the token's hash is stored, so this string exists for exactly one
   * render and is unrecoverable afterwards. It is deliberately not put in the
   * URL or a redirect: a bearer credential in a query string ends up in the
   * browser history and in every access log between here and there.
   */
  link?: string;
  /** The address the link above belongs to, so a second invite cannot be confused for it. */
  linkFor?: string;
}


export async function sendInvite(
  _state: InviteState, formData: FormData,
): Promise<InviteState> {
  const viewer = await requireViewer();
  const { leagueId, role } = viewer.membership;
  if (role !== "commissioner") {
    return { error: "Only the commissioner can invite managers.", at: Date.now() };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "That does not look like an email address.", at: Date.now() };
  }

  const raw = String(formData.get("fantasyTeamId") ?? "");
  const fantasyTeamId = raw === "" ? undefined : Number(raw);

  // Refuse before minting rather than after redeeming. An invite with no seat
  // behind it looks identical to a good one right up until the manager clicks
  // it, and by then the failure is theirs to report rather than the
  // commissioner's to notice.
  const teams = await teamsInLeague(db, leagueId);
  if (fantasyTeamId === undefined) {
    if (teams.every((t) => t.ownerId !== null)) {
      return {
        error: "Every team is claimed. Name a specific team, or add one first.",
        at: Date.now(),
      };
    }
  } else {
    const team = teams.find((t) => t.id === fantasyTeamId);
    if (!team) return { error: "That team is not in this league.", at: Date.now() };
    if (team.ownerId !== null) {
      return { error: `${team.name} already belongs to ${team.ownerName}.`, at: Date.now() };
    }
  }

  let invite;
  try {
    invite = await inviteToLeague(db, {
      leagueId, email, invitedBy: viewer.userId, fantasyTeamId,
    });
  } catch (error) {
    console.error("invite failed", error);
    return { error: "The invite could not be created.", at: Date.now() };
  }

  revalidatePath("/commissioner");
  return {
    ok: `Invite created for ${invite.email}. The link is shown once — copy it now.`,
    link: joinUrl(invite.token!),
    linkFor: invite.email,
    at: Date.now(),
  };
}

export async function revoke(
  _state: InviteState, formData: FormData,
): Promise<InviteState> {
  const viewer = await requireViewer();
  if (viewer.membership.role !== "commissioner") {
    return { error: "Only the commissioner can revoke an invite.", at: Date.now() };
  }

  const inviteId = Number(formData.get("inviteId"));
  const email = String(formData.get("email") ?? "");

  const killed = await revokeInvite(db, { inviteId, byUserId: viewer.userId });
  revalidatePath("/commissioner");
  return killed
    ? { ok: `The link for ${email} no longer works.`, revokedEmail: email, at: Date.now() }
    : { error: "That invite was already used or revoked.", at: Date.now() };
}

export interface LinkState { error?: string; ok?: string; at?: number }

/** Makes the league's join link, or replaces the live one. */
export async function makeJoinLink(_state: LinkState, formData: FormData): Promise<LinkState> {
  const viewer = await requireViewer();
  const { leagueId, role } = viewer.membership;
  if (role !== "commissioner") return { error: "Only the commissioner can make a join link.", at: Date.now() };
  const replacing = formData.get("replace") === "1";
  try {
    await createJoinLink(db, { leagueId, byUserId: viewer.userId });
  } catch (error) {
    return { error: (error as Error).message, at: Date.now() };
  }
  revalidatePath("/commissioner");
  return {
    ok: replacing ? "New link made. The old one no longer works." : "Join link made. Copy it and post it for the league.",
    at: Date.now(),
  };
}

/** Turns the join link off. */
export async function stopJoinLink(_state: LinkState): Promise<LinkState> {
  const viewer = await requireViewer();
  const { leagueId, role } = viewer.membership;
  if (role !== "commissioner") return { error: "Only the commissioner can turn the link off.", at: Date.now() };
  await revokeJoinLink(db, { leagueId, byUserId: viewer.userId });
  revalidatePath("/commissioner");
  return { ok: "The join link is off. Anyone who already joined keeps their team.", at: Date.now() };
}

/** Frees a seat: the manager comes off, the team and its roster stay. */
export async function removeFromSeat(_state: LinkState, formData: FormData): Promise<LinkState> {
  const viewer = await requireViewer();
  const { leagueId, role } = viewer.membership;
  if (role !== "commissioner") return { error: "Only the commissioner can remove a manager.", at: Date.now() };
  const fantasyTeamId = Number(formData.get("fantasyTeamId"));
  try {
    const { teamName, removed } = await removeManager(db, { leagueId, fantasyTeamId, byUserId: viewer.userId });
    revalidatePath("/commissioner");
    revalidatePath("/", "layout");
    return { ok: `${removed} is off ${teamName}. The seat is open, roster intact.`, at: Date.now() };
  } catch (error) {
    return { error: (error as Error).message, at: Date.now() };
  }
}
