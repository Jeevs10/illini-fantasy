import Link from "next/link";
import { members, openInvites, teamsInLeague } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";
import { Invites } from "./invites.tsx";

export const dynamic = "force-dynamic";

export default async function Commissioner() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, season, role } = viewer.membership;

  // The data layer refuses a non-commissioner on its own — inviteToLeague and
  // revokeInvite both call requireCommissioner — so this is about telling a
  // manager where they are rather than about keeping anyone out.
  if (role !== "commissioner") {
    return (
      <div className="narrow">
        <div className="panel"><div className="panel-body">
          <h1>Commissioner only</h1>
          <p className="muted">
            Managing invites and seats belongs to whoever runs {leagueName}. You
            are a manager in it, which is everything except this page.
          </p>
          <Link className="button" href="/team">Back to my team</Link>
        </div></div>
      </div>
    );
  }

  const [roster, teams, invites] = await Promise.all([
    members(db, leagueId),
    teamsInLeague(db, leagueId),
    openInvites(db, leagueId),
  ]);

  const claimed = teams.filter((t) => t.ownerId !== null).length;
  // A member with no team is a real state, not a bug: a commissioner joins the
  // league before claiming a seat, and the seats table is keyed by team, so
  // they would otherwise not appear on their own page at all.
  const seatless = roster.filter((m) => m.fantasyTeamId === null);

  return (
    <>
      <div className="pagehead">
        <div>
        <h1>Commissioner</h1>
        <p className="meta">
          <span>{leagueName}</span>
          <span>{season - 1}–{String(season).slice(2)}</span>
          <span>{claimed} of {teams.length} seats filled</span>
        </p>
        </div>
        <div className="controls">
          <Link className="button" href="/commissioner/settings">League settings</Link>
          <Link className="button" href="/standings">Standings</Link>
        </div>
      </div>

      <Invites teams={teams} open={invites} />

      <div className="panel">
        <div className="panel-head">
          <h2>Seats</h2>
          <p>
            Teams are created unowned. A manager takes one by redeeming an
            invite, so an empty seat is a person who has not joined yet — not a
            missing team.
          </p>
        </div>
        <div className="scroll">
          <table>
            <caption className="sr-only">Every team in the league and its manager</caption>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col">Manager</th>
                <th scope="col">Email</th>
                <th scope="col" className="r">Role</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const member = roster.find((m) => m.fantasyTeamId === team.id);
                return (
                  <tr key={team.id} data-mine={team.ownerId === viewer.userId}>
                    <td style={{ fontWeight: 600 }}>{team.name}</td>
                    <td className={team.ownerName === null ? "muted" : undefined}>
                      {team.ownerName ?? "Unclaimed"}
                    </td>
                    <td className="faint">{team.ownerEmail ?? "—"}</td>
                    <td className="r">
                      {member
                        ? <span className="pill">{member.role}</span>
                        : <span className="pill free">open</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {seatless.length > 0 ? (
          <p className="seatless">
            In the league without a team:{" "}
            {seatless.map((m) => `${m.displayName} (${m.role})`).join(", ")}.
          </p>
        ) : null}
      </div>
    </>
  );
}
