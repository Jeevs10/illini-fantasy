import { standings } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, fantasyTeamId } = viewer.membership;
  const table = await standings(db, leagueId);
  const played = table.reduce((a, r) => a + r.wins + r.losses + r.ties, 0);

  return (
    <>
      <div className="pagehead">
        <h1>Standings</h1>
        <p>
          <span>{leagueName}</span>
          <span>Settled weeks only</span>
        </p>
      </div>

      <div className="panel">
        {played === 0 ? (
          <div className="empty">
            <h3>Nothing settled yet</h3>
            <p>
              Standings fill in as weeks are settled. A week in progress counts
              for nobody — its totals can still move when Torvik revises a box
              score.
            </p>
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="r">W</th>
                  <th className="r">L</th>
                  <th className="r">T</th>
                  <th className="r">PF</th>
                  <th className="r">PA</th>
                  <th className="r">Diff</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row, i) => (
                  <tr key={row.fantasyTeamId}
                      data-mine={row.fantasyTeamId === fantasyTeamId}>
                    <td className="faint num">{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td className="r num">{row.wins}</td>
                    <td className="r num">{row.losses}</td>
                    <td className="r num">{row.ties}</td>
                    <td className="r num">{row.pointsFor.toFixed(1)}</td>
                    <td className="r num">{row.pointsAgainst.toFixed(1)}</td>
                    <td className="r num" style={{
                      color: row.pointsFor >= row.pointsAgainst ? "var(--ok)" : "var(--crit)",
                    }}>
                      {row.pointsFor >= row.pointsAgainst ? "+" : ""}
                      {(row.pointsFor - row.pointsAgainst).toFixed(1)}
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
