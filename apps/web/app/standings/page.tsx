import Link from "next/link";
import { rankedStandings } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";
import { Avatar } from "../ui/identity.tsx";
import { SubTabs } from "../ui/bits.tsx";
import { Rafters } from "../ui/rafters.tsx";
import { Arrow } from "../ui/glyphs.tsx";

const VIEWS = [{ href: "/standings", label: "Standings" }, { href: "/playoffs", label: "Playoffs" }];

export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, fantasyTeamId } = viewer.membership;
  const table = await rankedStandings(db, leagueId);
  const played = table.reduce((a, r) => a + r.wins + r.losses + r.ties, 0);
  const moved = table.some((r) => r.movement !== null);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Standings</h1>
          <p className="meta">
            <span>{leagueName}</span>
            <span>{played === 0 ? "No week settled yet" : "Settled weeks only"}</span>
            {moved ? <span>Movement since last week</span> : null}
          </p>
        </div>
        <div className="row" style={{ gap: "var(--s-3)" }}>
          <SubTabs tabs={VIEWS} active="/standings" />
          <Link className="button" href="/league">This week&rsquo;s matchups</Link>
        </div>
      </div>

      <Rafters teams={table.map((r) => ({
        fantasyTeamId: r.fantasyTeamId, name: r.name, rank: r.rank, wins: r.wins, losses: r.losses,
        ties: r.ties, pointsFor: r.pointsFor, mine: r.fantasyTeamId === fantasyTeamId,
      }))} />

      <div className="panel">
        <div className="scroll">
          <table className="standtable">
            <caption className="sr-only">League standings</caption>
            <thead>
              <tr>
                <th scope="col" className="r">#</th>
                <th scope="col">Team</th>
                <th scope="col" className="r">Record</th>
                <th scope="col" className="r">Points for</th>
                <th scope="col" className="r">Against</th>
                <th scope="col" className="r">Diff</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const diff = row.pointsFor - row.pointsAgainst;
                const mine = row.fantasyTeamId === fantasyTeamId;
                return (
                  <tr key={row.fantasyTeamId} data-mine={mine || undefined}>
                    <td className="r tnum">
                      {played === 0 ? "—" : row.rank}
                      {row.movement !== null && row.movement !== 0 ? (
                        <span className="delta" data-dir={row.movement > 0 ? "up" : "down"}
                              aria-label={`${row.movement > 0 ? "up" : "down"} ${Math.abs(row.movement)}`}>
                          {" "}<Arrow dir={row.movement > 0 ? "up" : "down"} size={12} />{Math.abs(row.movement)}
                        </span>
                      ) : null}
                    </td>
                    <th scope="row">
                      <span className="row" style={{ gap: "var(--s-3)", flexWrap: "nowrap" }}>
                        <Avatar name={row.name} seed={row.fantasyTeamId} size="sm" mine={mine} />
                        <Link href={`/teams/${row.fantasyTeamId}`} className="player-link">{row.name}</Link>
                        {mine ? <span className="pill mine">You</span> : null}
                      </span>
                    </th>
                    <td className="r tnum" style={{ fontWeight: 700 }}>
                      {row.wins}&ndash;{row.losses}{row.ties ? `–${row.ties}` : ""}
                    </td>
                    <td className="r tnum" style={{ fontWeight: 700 }}>{row.pointsFor.toFixed(1)}</td>
                    <td className="r tnum faint">{row.pointsAgainst.toFixed(1)}</td>
                    <td className="r tnum delta" data-dir={diff > 0 ? "up" : diff < 0 ? "down" : "flat"}>
                      {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="seatless">
          {played === 0
            ? "The order fills in once Week 1 settles."
            : "Ties are broken by points for. Movement compares this table with the one a settled week ago."}
        </p>
      </div>
    </>
  );
}
