import Link from "next/link";
import { playerPool } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";

export const dynamic = "force-dynamic";

const PAGE = 50;

export default async function PlayersPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; free?: string; page?: string }> }) {
  const { q, free, page } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, season, configId } = viewer.membership;

  const offset = Math.max(0, Number(page ?? 0)) * PAGE;
  const availableOnly = free === "1";
  const players = await playerPool(db, {
    leagueId, season, configId,
    limit: PAGE + 1, offset, availableOnly, search: q,
  });
  const hasMore = players.length > PAGE;
  const rows = players.slice(0, PAGE);

  const query = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, free, page, ...over })) {
      if (value) params.set(key, value);
    }
    const s = params.toString();
    return s ? `/players?${s}` : "/players";
  };

  return (
    <>
      <div className="pagehead">
        <h1>Player pool</h1>
        <p><span>Ranked by season Player-Score under this league&rsquo;s config</span></p>
      </div>

      <form className="controls" action="/players">
        <input type="search" name="q" defaultValue={q ?? ""} placeholder="Search a name" />
        {availableOnly ? <input type="hidden" name="free" value="1" /> : null}
        <button type="submit">Search</button>
        <Link className="button" href={query({ free: availableOnly ? undefined : "1", page: undefined })}>
          {availableOnly ? "Showing free agents" : "Show free agents only"}
        </Link>
      </form>

      <div className="panel">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>School</th>
                <th>Role</th>
                <th className="r">GP</th>
                <th className="r">Total</th>
                <th className="r">Avg</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((player, i) => (
                <tr key={player.playerId}>
                  <td className="faint num">{offset + i + 1}</td>
                  <td>
                    <Link href={`/players/${player.playerId}`} className="player-link">
                      {player.name}
                    </Link>
                  </td>
                  <td>
                    {player.teamName ?? "—"}
                    {player.conference ? <span className="sub">{player.conference}</span> : null}
                  </td>
                  <td className="muted">{player.role ?? "—"}</td>
                  <td className="r num">{player.games}</td>
                  <td className="r num">{player.totalScore.toFixed(1)}</td>
                  <td className="r num">{player.averageScore.toFixed(1)}</td>
                  <td>
                    {player.ownedBy
                      ? <span className="tag">{player.ownedBy}</span>
                      : <span className="tag free">Free</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <h3>No players match</h3>
            <p>
              {q ? `Nothing named "${q}"` : "No players"}
              {availableOnly ? " is unowned in this league." : " has scored games this season."}
            </p>
            <div className="controls">
              <Link className="button" href="/players">Clear filters</Link>
            </div>
          </div>
        ) : null}
      </div>

      <nav className="controls">
        {offset > 0 ? (
          <Link className="button" href={query({ page: String(offset / PAGE - 1) })}>← Previous</Link>
        ) : null}
        {hasMore ? (
          <Link className="button" href={query({ page: String(offset / PAGE + 1) })}>Next →</Link>
        ) : null}
      </nav>
    </>
  );
}
