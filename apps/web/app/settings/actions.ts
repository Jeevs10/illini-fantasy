"use server";

import { revalidatePath } from "next/cache";
import {
  AccountTaken, NotYourTeamError, TeamNameTaken, changePassword, passwordProblem, renameTeam, setUsername,
  teamNameProblem, usernameProblem,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";

export interface RenameState { error?: string; ok?: string; }
export interface PasswordState { error?: string; ok?: string; }

/**
 * A manager's own rename. `setUsername` already lets a self-rename to the
 * name you already hold through unchanged — the collision check excludes
 * your own row — so there is nothing extra to special-case here.
 */
export async function renameAccount(_state: RenameState, formData: FormData): Promise<RenameState> {
  const viewer = await requireViewer();
  const username = String(formData.get("username") ?? "").trim();

  const problem = usernameProblem(username);
  if (problem) return { error: problem };

  try {
    const account = await setUsername(db, { userId: viewer.userId, username });
    // The masthead reads the viewer's username/name on every page.
    revalidatePath("/", "layout");
    return { ok: `You're now signed in as ${account.username}.` };
  } catch (error) {
    if (error instanceof AccountTaken) return { error: `${username} is taken. Pick another.` };
    return { error: error instanceof Error ? error.message : "The username could not be changed." };
  }
}

/** A manager's own password change. Existing sessions, including this one, are untouched. */
export async function changeMyPassword(
  _state: PasswordState, formData: FormData,
): Promise<PasswordState> {
  const viewer = await requireViewer();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  const problem = passwordProblem(next);
  if (problem) return { error: problem };

  const ok = await changePassword(db, { userId: viewer.userId, current, next });
  if (!ok) return { error: "That isn't your current password." };
  return { ok: "Your password has been changed." };
}

export interface TeamNameState { error?: string; ok?: string; }

/** Renames the viewer's team in the league they are looking at. */
export async function renameMyTeam(_state: TeamNameState, formData: FormData): Promise<TeamNameState> {
  const viewer = await requireViewer();
  const { fantasyTeamId } = viewer.membership;
  if (fantasyTeamId === null) return { error: "You do not run a team in this league." };
  const name = String(formData.get("teamName") ?? "");
  const problem = teamNameProblem(name);
  if (problem) return { error: problem };
  try {
    const { to } = await renameTeam(db, { fantasyTeamId, byUserId: viewer.userId, name });
    // The team name is on the masthead, the scorebug, the standings and the board.
    revalidatePath("/", "layout");
    return { ok: `Your team is now ${to}.` };
  } catch (error) {
    if (error instanceof TeamNameTaken) return { error: `${error.name} is already a team in this league.` };
    if (error instanceof NotYourTeamError) return { error: "That team is not yours to rename." };
    throw error;
  }
}
