import Link from "next/link";
import { rankedStandings } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";
import { Avatar } from "../ui/identity.tsx";
import { Bar, Empty, Score, SubTabs } from "../ui/bits.tsx";

const VIEWS = [{ href: "/standings", label: "Standings" }, { href: "/playoffs", label: "Playoffs" }];

export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, fantasyTeamId } = viewer.membership;
  const table = await rankedStandings(db, leagueId);
  const played = table.reduce((a, r) => a + r.wins + r.losses + r.ties, 0);
  const topPoints = Math.max(...table.map((r) => r.pointsFor), 0);
  // Scaled from just under the lowest total rather than from zero: ten teams
  // inside a hundred points of each other all read as full bars against a zero
  // baseline, which is a chart that says nothing.
  const floorPoints = Math.min(...table.map((r) => r.pointsFor), 0) * 0.985;
  const share = (pf: number) =>
    topPoints <= floorPoints ? 0 : Math.max(3, ((pf - floorPoints) / (topPoints - floorPoints)) * 100);
  const moved = table.some((r) => r.movement !== null);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Standings</h1>
          <p className="meta">
            <span>{leagueName}</span>
            <span>Settled weeks only</span>
            {moved ? <span>Movement since last week</span> : null}
          </p>
        </div>
        <div className="row" style={{ gap: "var(--s-3)" }}>
          <SubTabs tabs={VIEWS} active="/standings" />
          <Link className="button" href="/league">This week&rsquo;s matchups</Link>
        </div>
      </div>

      <div className="panel">
        {played === 0 ? (
          <Empty title="Nothing settled yet" glyph="league"
                 action={<Link className="button" href="/league">Watch the week</Link>}>
            Standings fill in as weeks are settled. A week in progress counts for
            nobody — its totals can still move when Torvik revises a box score.
          </Empty>
        ) : (
          <>
            <div className="stand-head" aria-hidden="true">
              <span>#</span><span>Team</span><span>Record</span>
              <span>Points for</span><span className="r">PA</span><span className="r">Diff</span>
            </div>
            {table.map((row) => {
              const diff = row.pointsFor - row.pointsAgainst;
              const mine = row.fantasyTeamId === fantasyTeamId;
              return (
                <div className="stand-row" key={row.fantasyTeamId} data-mine={mine || undefined}>
                  <span className="stand-rank">
                    <span className="tnum">{row.rank}</span>
                    {row.movement !== null && row.movement !== 0 ? (
                      <span className="delta" data-dir={row.movement > 0 ? "up" : "down"}>
                        {row.movement > 0 ? "↑" : "↓"}{Math.abs(row.movement)}
                      </span>
                    ) : row.movement === 0 ? (
                      <span className="delta" data-dir="flat" aria-label="unchanged">—</span>
                    ) : null}
                  </span>

                  <span className="plr-lead" style={{ minWidth: 0 }}>
                    <Avatar name={row.name} seed={row.fantasyTeamId} size="sm" mine={mine} />
                    <span className="plr-id">
                      <Link href={`/teams/${row.fantasyTeamId}`} className="plr-name">
                        {row.name}{mine ? <span className="pill mine" style={{ marginLeft: "var(--s-2)" }}>You</span> : null}
                      </Link>
                      <span className="plr-sub stand-inline">
                        <span>{row.wins}&ndash;{row.losses}{row.ties ? `–${row.ties}` : ""}</span>
                        <span className="dot" />
                        <span>{row.pointsFor.toFixed(1)} PF</span>
                      </span>
                    </span>
                  </span>

                  <span className="stand-rec">
                    <strong className="tnum">{row.wins}&ndash;{row.losses}{row.ties ? `–${row.ties}` : ""}</strong>
                  </span>

                  <span className="stand-pf">
                    <Score value={row.pointsFor} size="xs" />
                    <Bar percent={share(row.pointsFor)} />
                  </span>

                  <span className="r faint tnum" style={{ fontSize: "var(--t-sm)" }}>
                    {row.pointsAgainst.toFixed(1)}
                  </span>

                  <span className="r delta" data-dir={diff > 0 ? "up" : diff < 0 ? "down" : "flat"}>
                    {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                  </span>
                </div>
              );
            })}
            <p className="seatless">
              Ties are broken by points for. Movement compares this table with
              the one that stood a settled week ago, and is absent until there
              are two weeks to compare.
            </p>
          </>
        )}
      </div>
    </>
  );
}
