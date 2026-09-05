import Link from "next/link";
import type { CountedGame, MatchupView, PlayerAvailability, TeamOutlook } from "@illini/league";
import { availabilityFor, periodOutlook, seasonWeeks, weekMatchups } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Avatar } from "../ui/identity.tsx";
import { AvailabilityTag, Empty, ET, LiveTag, Score, SectionHead } from "../ui/bits.tsx";
import { ScoreBug, type BugSide } from "../ui/scorebug.tsx";

export const dynamic = "force-dynamic";

export default async function LeaguePage({
  searchParams,
}: { searchParams: Promise<{ date?: string; week?: string }> }) {
  const { date, week } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, configId, settings, fantasyTeamId } = viewer.membership;
  const now = viewNow();

  const [matchups, season] = await Promise.all([
    weekMatchups(db, {
      leagueId, configId, on: viewDate(date), settings,
      week: week ? Number(week) : undefined,
    }),
    seasonWeeks(db, leagueId),
  ]);

  if (matchups.length === 0) {
    return (
      <div className="panel">
        <Empty title="No schedule yet" glyph="matchup">
          This league has no matchups. A commissioner generates the schedule
          once every team has an owner.
        </Empty>
      </div>
    );
  }

  const mine = matchups.find(
    (m) => m.home.fantasyTeamId === fantasyTeamId || m.away.fantasyTeamId === fantasyTeamId);
  const others = matchups.filter((m) => m !== mine);
  const { week: weekNumber, startsOn, endsOn, settled } = matchups[0]!;

  const outlooks = mine
    ? await Promise.all([
        periodOutlook(db, { fantasyTeamId: mine.home.fantasyTeamId, configId, from: mine.startsOn, to: mine.endsOn, settings, now }),
        periodOutlook(db, { fantasyTeamId: mine.away.fantasyTeamId, configId, from: mine.startsOn, to: mine.endsOn, settings, now }),
      ])
    : null;
  const availability = outlooks
    ? await availabilityFor(db, [...outlooks[0].pending, ...outlooks[1].pending].map((p) => p.playerId))
    : new Map<number, PlayerAvailability>();

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Week {weekNumber}</h1>
          <p className="meta">
            <span>{startsOn} &ndash; {endsOn}</span>
            <span>Best {settings.gamesCap} games count</span>
          </p>
        </div>
        <nav className="controls" aria-label="Week navigation">
          {weekNumber > (season?.first ?? 1) ? (
            <Link className="button" href={`/league?week=${weekNumber - 1}`}>← Week {weekNumber - 1}</Link>
          ) : null}
          {/* A schedule of seventeen weeks should not offer an eighteenth. */}
          {season !== null && weekNumber < season.last ? (
            <Link className="button" href={`/league?week=${weekNumber + 1}`}>Week {weekNumber + 1} →</Link>
          ) : (
            <span className="pill ghost">Last week of the season</span>
          )}
        </nav>
      </div>

      {mine && outlooks ? (
        <>
          <div className="rise" style={{ marginBottom: "var(--s-5)" }}>
            <ScoreBug
              week={mine.week} startsOn={mine.startsOn} endsOn={mine.endsOn}
              settled={mine.settled} gamesCap={settings.gamesCap}
              home={bug(mine.home.fantasyTeamId, mine.home.name, outlooks[0], fantasyTeamId)}
              away={bug(mine.away.fantasyTeamId, mine.away.name, outlooks[1], fantasyTeamId)}
            />
          </div>
          <HeadToHead
            mine={mine} outlooks={outlooks} fantasyTeamId={fantasyTeamId}
            gamesCap={settings.gamesCap} now={now} availability={availability}
          />
        </>
      ) : null}

      <SectionHead title={mine ? "Around the league" : "This week"} />
      <div className="panel">
        {others.length === 0 ? (
          <Empty title="No other matchups this week" glyph="matchup" />
        ) : (
          others.map((m) => <MiniBug key={m.matchupId} view={m} />)
        )}
      </div>
    </>
  );
}

function bug(id: number, name: string, o: TeamOutlook, mineId: number | null): BugSide {
  return {
    fantasyTeamId: id, name,
    total: o.total, projected: o.projected,
    gamesCounted: o.gamesCounted, gamesPlayed: o.gamesPlayed,
    live: o.live, upcoming: o.upcoming,
    mine: id === mineId,
  };
}

/**
 * The matchup, game against game.
 *
 * Ranked rather than chronological, and interleaved rather than side by side:
 * a games cap means the week is decided by whose ninth-best night was better,
 * so the row that decides it should be a row, with the cap drawn across the
 * page under it. Everything below the line is what was left on the table.
 */
function HeadToHead({
  mine, outlooks, fantasyTeamId, gamesCap, now, availability,
}: {
  mine: MatchupView; outlooks: [TeamOutlook, TeamOutlook];
  fantasyTeamId: number | null; gamesCap: number; now: Date;
  availability: Map<number, PlayerAvailability>;
}) {
  const homeIsMine = mine.home.fantasyTeamId === fantasyTeamId;
  const [left, right] = homeIsMine || fantasyTeamId === null
    ? [{ view: mine.home, out: outlooks[0] }, { view: mine.away, out: outlooks[1] }]
    : [{ view: mine.away, out: outlooks[1] }, { view: mine.home, out: outlooks[0] }];

  const depth = Math.max(left.out.games.length, right.out.games.length);
  const rows = Array.from({ length: depth }, (_, i) => ({
    rank: i + 1,
    left: left.out.games[i] ?? null,
    right: right.out.games[i] ?? null,
  }));

  const pending = [...left.out.pending.map((p) => ({ ...p, side: "left" as const })),
                   ...right.out.pending.map((p) => ({ ...p, side: "right" as const }))]
    .sort((a, b) => (a.tipoff ?? "~").localeCompare(b.tipoff ?? "~"));

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Game by game</h2>
          <p>Best night first. The line is the cap — everything under it was left on the table.</p>
        </div>
      </div>

      {pending.length > 0 ? (
        <>
          <div className="subhead"><h3>Still to play — {pending.length}</h3></div>
          {pending.map((p) => {
            const live = p.tipoff !== null && new Date(p.tipoff) <= now;
            return (
              <div className="plr" key={`${p.side}-${p.playerId}-${p.playedOn}`} data-state={live ? "live" : undefined}>
                <span className="plr-lead">
                  <Avatar name={p.side === "left" ? left.view.name : right.view.name}
                          seed={p.side === "left" ? left.view.fantasyTeamId : right.view.fantasyTeamId}
                          size="sm" mine={p.side === "left" && homeIsMine === (left.view === mine.home)} />
                </span>
                <span className="plr-id">
                  <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
                    <Link className="plr-name" href={`/players/${p.playerId}`} style={{ minWidth: 0, flex: "1 1 auto" }}>{p.playerName}</Link>
                    <AvailabilityTag status={availability.get(p.playerId)?.status} injury={availability.get(p.playerId)?.injury} compact />
                  </span>
                  <span className="plr-sub">
                    <span className="slot" data-slot={p.slot} style={{ minWidth: "2.6rem", height: 18, fontSize: 10 }}>{p.slot}</span>
                    <span>{p.opponent ? `vs ${p.opponent}` : "TBD"}</span>
                    <span className="dot" />
                    <span>{p.playedOn}</span>
                  </span>
                </span>
                <span className="plr-right">
                  {live ? <LiveTag /> : p.tipoff ? <span className="pill ghost"><ET iso={p.tipoff} /> ET</span> : <span className="pill ghost">TBD</span>}
                  <span className="plr-figure">
                    <Score value={p.projected} size="xs" tone="quiet" />
                    <span className="cap">proj</span>
                  </span>
                </span>
              </div>
            );
          })}
        </>
      ) : null}

      <div className="subhead">
        <h3>Scored</h3>
        <span className="row" style={{ gap: "var(--s-3)", fontSize: "var(--t-xs)", fontWeight: 700 }}>
          <span style={{ color: "var(--ink-2)" }}>{left.view.name}</span>
          <span className="faint">vs</span>
          <span style={{ color: "var(--ink-2)" }}>{right.view.name}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty title="No games scored yet" glyph="clock">
          Nothing in this week has a filed box score. Scores appear the morning
          after a night is ingested.
        </Empty>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.rank}>
              <div className="h2h" data-over={row.rank > gamesCap || undefined}>
                <Cell game={row.left} align="left" />
                <span className="h2h-rank">{row.rank}</span>
                <Cell game={row.right} align="right" />
              </div>
              {row.rank === gamesCap && depth > gamesCap ? (
                <div className="capline"><span>Cap — best {gamesCap} count</span></div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({ game, align }: { game: CountedGame | null; align: "left" | "right" }) {
  if (game === null) return <div className="h2h-cell" data-align={align} aria-hidden="true" />;
  return (
    <div className="h2h-cell" data-align={align}>
      <div className="h2h-who">
        <Link className="plr-name" href={`/players/${game.playerId}`}>{game.playerName}</Link>
        <span className="plr-sub">
          <span>{game.playedOn}</span>
          <span className="dot" />
          <span>{game.slot}</span>
        </span>
      </div>
      <Score value={game.score} size="xs" tone={game.counted ? "default" : "quiet"} />
    </div>
  );
}

function MiniBug({ view }: { view: MatchupView }) {
  const sum = view.home.total + view.away.total;
  const homeLeads = sum > 0 && view.home.total > view.away.total;
  const awayLeads = sum > 0 && view.away.total > view.home.total;
  return (
    <div className="minibug">
      <span className="side">
        <Avatar name={view.home.name} seed={view.home.fantasyTeamId} size="xs" />
        <span className="nm">{view.home.name}</span>
      </span>
      <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap" }}>
        <span className="score score-xs sc" data-lead={homeLeads}>{view.home.total.toFixed(1)}</span>
        <span className="dash">–</span>
        <span className="score score-xs sc" data-lead={awayLeads}>{view.away.total.toFixed(1)}</span>
      </span>
      <span className="side them">
        <Avatar name={view.away.name} seed={view.away.fantasyTeamId} size="xs" />
        <span className="nm">{view.away.name}</span>
      </span>
    </div>
  );
}
