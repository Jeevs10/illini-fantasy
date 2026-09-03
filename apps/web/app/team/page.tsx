import Link from "next/link";
import { eligibleSlots, rosterOn, startableOn, type Slot } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate } from "../../lib/session.ts";
import { Lineup } from "./lineup.tsx";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const viewer = await requireViewer();
  const { fantasyTeamId, fantasyTeamName, settings, configId, leagueName } = viewer.membership;
  const day = viewDate(date);

  if (fantasyTeamId === null) {
    return (
      <div className="panel">
        <h2>No team</h2>
        <p className="muted">You are a member of {leagueName} but do not run a team in it.</p>
      </div>
    );
  }

  const [startable, roster] = await Promise.all([
    startableOn(db, { fantasyTeamId, day, configId }),
    rosterOn(db, fantasyTeamId, day),
  ]);

  // Eligibility is resolved here rather than in the browser: it comes from the
  // archetype the scoring model assigned, so the two cannot disagree.
  const eligible: Record<number, Slot[]> = {};
  for (const player of startable) eligible[player.playerId] = eligibleSlots(player.archetype);

  const idle = roster.filter((p) => !startable.some((s) => s.playerId === p.playerId));

  return (
    <>
      <div className="pagehead">
        <h1>{fantasyTeamName}</h1>
        <p>
          <span>{leagueName}</span>
          <span>{roster.length} rostered</span>
          <span>{settings.starters.map((s) => `${s.count} ${s.slot}`).join(" · ")}</span>
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Tonight — {day}</h2>
        </div>
        {startable.length === 0 ? (
          <div className="empty">
            <h3>Nobody plays today</h3>
            <p>
              College schedules are uneven — most of a week&rsquo;s slate lands on
              Saturday, and a Thursday can be nearly empty for a roster of
              major-conference players.
            </p>
          </div>
        ) : (
          <div className="panel-body">
            <Lineup day={day} startable={startable} settings={settings} eligible={eligible} />
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Not playing today</h2>
          <span className="tag">{idle.length}</span>
        </div>
        {idle.length === 0 ? (
          <div className="empty"><p>Everyone on the roster has a game tonight.</p></div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>School</th>
                  <th>Role</th>
                  <th>Acquired</th>
                </tr>
              </thead>
              <tbody>
                {idle.map((player) => (
                  <tr key={player.playerId}>
                    <td>
                      <Link href={`/players/${player.playerId}`} className="player-link">
                        {player.name}
                      </Link>
                    </td>
                    <td>{player.teamName ?? "—"}</td>
                    <td className="muted">{player.role ?? "—"}</td>
                    <td className="faint">
                      <span className="tag">{player.acquiredVia}</span>
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
