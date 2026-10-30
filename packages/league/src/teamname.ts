import type { Queryable } from "./membership.ts";

/**
 * A manager names their own team.
 *
 * The owner, and only the owner: a commissioner can seat a team and run the
 * league, but a team's name is the one thing in it that belongs to the person
 * running it. Names are unique inside a league (the `(league_id, name)`
 * constraint since 003), trimmed, and capped so they fit the scorebug.
 */

export const TEAM_NAME_MAX = 32;

export class TeamNameTaken extends Error {
  constructor(readonly name: string) {
    super(`another team in this league is already called ${name}`);
    this.name = "TeamNameTaken";
  }
}

export class NotYourTeamError extends Error {
  constructor(readonly fantasyTeamId: number) {
    super(`team ${fantasyTeamId} is not yours to rename`);
    this.name = "NotYourTeamError";
  }
}

/** Why a name cannot be used, or null if it can. */
export function teamNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return "A team needs a name.";
  if (name.length > TEAM_NAME_MAX) return `Keep it to ${TEAM_NAME_MAX} characters.`;
  if (/[\u0000-\u001f]/.test(name)) return "That name has characters it cannot show.";
  return null;
}

export async function renameTeam(
  db: Queryable, { fantasyTeamId, byUserId, name: raw }: { fantasyTeamId: number; byUserId: number; name: string },
): Promise<{ from: string; to: string }> {
  const name = raw.trim().replace(/\s+/g, " ");
  const problem = teamNameProblem(name);
  if (problem) throw new Error(problem);

  const { rows } = await db.query<{ league_id: string; name: string; owner_id: string | null }>(
    "SELECT league_id, name, owner_id FROM fantasy_team WHERE id = $1", [fantasyTeamId]);
  const team = rows[0];
  if (!team || Number(team.owner_id) !== byUserId) throw new NotYourTeamError(fantasyTeamId);
  if (team.name === name) return { from: team.name, to: name };

  try {
    await db.query("UPDATE fantasy_team SET name = $2 WHERE id = $1", [fantasyTeamId, name]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new TeamNameTaken(name);
    throw error;
  }
  await db.query(
    `INSERT INTO transaction (league_id, kind, payload, created_by) VALUES ($1, 'rename', $2, $3)`,
    [team.league_id, JSON.stringify({ fantasyTeamId, from: team.name, to: name }), byUserId]);
  return { from: team.name, to: name };
}
