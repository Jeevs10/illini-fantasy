import Link from "next/link";
import type { CountedGame, MatchupView, TeamPeriod } from "@illini/league";
import { weekMatchups } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate } from "../../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function LeaguePage({
  searchParams,
}: { searchParams: Promise<{ date?: string; week?: string }> }) {
  const { date, week } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, configId, settings, fantasyTeamId } = viewer.membership;

  const matchups = await weekMatchups(db, {
    leagueId, configId, on: viewDate(date), settings,
    week: week ? Number(week) : undefined,
  });

  if (matchups.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          <h3>No schedule yet</h3>
          <p>
            This league has no matchups. A commissioner generates the schedule
            once every team has an owner.
          </p>
        </div>
      </div>
    );
  }

  const mine = matchups.find(
    (m) => m.home.fantasyTeamId === fantasyTeamId || m.away.fantasyTeamId === fantasyTeamId);
  const others = matchups.filter((m) => m !== mine);
  const { week: weekNumber, startsOn, endsOn, settled } = matchups[0]!;

  return (
    <>
      <div className="pagehead">
        <h1>Week {weekNumber}</h1>
        <p>
          <span>{startsOn} — {endsOn}</span>
          {settled
            ? <span className="tag">Settled</span>
            : <span className="tag live">In progress</span>}
          <span>Best {settings.gamesCap} games count</span>
        </p>
      </div>

      {mine ? (
        <div className="panel">
          <Scoreline view={mine} />
          <div className="sides">
            <Side period={mine.home} />
            <Side period={mine.away} />
          </div>
        </div>
      ) : null}

      <h2 style={{ marginBottom: "var(--s-3)" }}>Around the league</h2>
      <div className="panel">
        {others.length === 0 ? (
          <div className="empty"><p>No other matchups this week.</p></div>
        ) : (
          others.map((m) => <Scoreline key={m.matchupId} view={m} compact />)
        )}
      </div>

      <nav className="controls" aria-label="Week navigation">
        {weekNumber > 1 ? (
          <Link className="button" href={`/league?week=${weekNumber - 1}`}>
            ← Week {weekNumber - 1}
          </Link>
        ) : null}
        <Link className="button" href={`/league?week=${weekNumber + 1}`}>
          Week {weekNumber + 1} →
        </Link>
      </nav>
    </>
  );
}

function Scoreline({ view, compact = false }: { view: MatchupView; compact?: boolean }) {
  const homeLeads = view.home.total >= view.away.total;
  return (
    <div className="scoreline" style={compact ? { borderBottom: "1px solid var(--rule)" } : undefined}>
      <div className="side">
        <div className="team">{view.home.name}</div>
        <div className="total num" data-lead={homeLeads}>{view.home.total.toFixed(1)}</div>
        <div className="meta">{view.home.gamesCounted} of {view.home.gamesPlayed} games count</div>
      </div>
      <div className="vs">VS</div>
      <div className="side away">
        <div className="team">{view.away.name}</div>
        <div className="total num" data-lead={!homeLeads}>{view.away.total.toFixed(1)}</div>
        <div className="meta">{view.away.gamesCounted} of {view.away.gamesPlayed} games count</div>
      </div>
    </div>
  );
}

/**
 * Every started game, best first. Games past the cap are dimmed rather than
 * hidden — what was left on the table is the point of having a cap.
 */
function Side({ period }: { period: TeamPeriod & { name: string } }) {
  return (
    <div>
      <h3>{period.name}</h3>
      {period.games.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--t-sm)", margin: 0 }}>
          No games started yet this week.
        </p>
      ) : (
        <table>
          <caption className="sr-only">
            {period.name} — started games, best first
          </caption>
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Slot</th>
              <th scope="col" className="r">Score</th>
            </tr>
          </thead>
          <tbody>
            {period.games.map((game: CountedGame) => (
              <tr key={`${game.playerId}-${game.playedOn}`} data-counted={game.counted}>
                <td>
                  <Link href={`/players/${game.playerId}`} className="player-link">
                    {game.playerName}
                  </Link>
                  <span className="sub">
                    {game.playedOn}{game.counted ? "" : " · over the cap"}
                  </span>
                </td>
                <td><span className="tag slot">{game.slot}</span></td>
                <td className="r num">{game.score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
