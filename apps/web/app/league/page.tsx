import Link from "next/link";
import type { CountedGame, MatchupView, PlayerAvailability, TeamOutlook } from "@illini/league";
import { availabilityFor, seasonWeeks, weekMatchups } from "@illini/league";
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
      leagueId, configId, on: viewDate(date), settings, now,
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

  const outlooks: [TeamOutlook, TeamOutlook] | null = mine ? [mine.home, mine.away] : null;
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
          <Rosters
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
    pendingSlots: bySlot(o.pending),
    mine: id === mineId,
  };
}

/** Still-to-play games, grouped by slot for the "N to play" breakdown. */
function bySlot(pending: TeamOutlook["pending"]): { slot: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of pending) counts.set(p.slot, (counts.get(p.slot) ?? 0) + 1);
  return [...counts.entries()].map(([slot, count]) => ({ slot, count }));
}

/**
 * Both rosters for the week, side by side.
 *
 * Not ranked against each other and not interleaved — the two teams are
 * fielding different starters against different real games, so pairing them
 * row-for-row invites a comparison the schedule never asked for. Each side is
 * its own roster: who is still to play, who is already in the books, and
 * what the cap left on the table, under the total that roster projects to.
 */
function Rosters({
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

  return (
    <div className="rosters">
      <RosterPanel side={left} mine={left.view.fantasyTeamId === fantasyTeamId}
                   gamesCap={gamesCap} now={now} availability={availability} />
      <RosterPanel side={right} mine={right.view.fantasyTeamId === fantasyTeamId}
                   gamesCap={gamesCap} now={now} availability={availability} />
    </div>
  );
}

function RosterPanel({
  side, mine, gamesCap, now, availability,
}: {
  side: { view: MatchupView["home"]; out: TeamOutlook };
  mine: boolean; gamesCap: number; now: Date;
  availability: Map<number, PlayerAvailability>;
}) {
  const { view, out } = side;
  const pending = [...out.pending].sort((a, b) => (a.tipoff ?? "~").localeCompare(b.tipoff ?? "~"));
  const scored = [...out.games].sort((a, b) => b.score - a.score);
  const counted = scored.filter((g) => g.counted);
  const overflow = scored.filter((g) => !g.counted);

  return (
    <div className="panel" data-density="compact">
      <div className="panel-head">
        <span className="row" style={{ gap: "var(--s-3)", minWidth: 0 }}>
          <Avatar name={view.name} seed={view.fantasyTeamId} size="md" mine={mine} />
          <span style={{ minWidth: 0 }}>
            <h2 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{view.name}</h2>
            <p>{out.gamesCounted} of {out.gamesPlayed} played count</p>
          </span>
        </span>
        <span style={{ textAlign: "right", flex: "none" }}>
          <div className="eyebrow">Projected</div>
          <Score value={out.projected} size="lg" tone={mine ? "accent" : "default"} />
        </span>
      </div>

      {pending.length > 0 ? (
        <>
          <div className="subhead"><h3>Still to play — {pending.length}</h3></div>
          {pending.map((p) => {
            const live = p.tipoff !== null && new Date(p.tipoff) <= now;
            return (
              <div className="plr" key={`${p.playerId}-${p.playedOn}`} data-state={live ? "live" : undefined}>
                <span className="plr-lead">
                  <span className="slot" data-slot={p.slot} style={{ minWidth: "2.6rem", height: 22, fontSize: 10 }}>{p.slot}</span>
                </span>
                <span className="plr-id">
                  <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
                    <Link className="plr-name" href={`/players/${p.playerId}`} style={{ minWidth: 0, flex: "1 1 auto" }}>{p.playerName}</Link>
                    <AvailabilityTag status={availability.get(p.playerId)?.status} injury={availability.get(p.playerId)?.injury} compact />
                  </span>
                  <span className="plr-sub">
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

      <div className="subhead"><h3>Scored</h3></div>
      {counted.length === 0 && overflow.length === 0 ? (
        <Empty title="No games scored yet" glyph="clock">
          Nothing has a filed box score yet. Scores appear the morning after a
          night is ingested.
        </Empty>
      ) : (
        <>
          {counted.map((g) => <ScoredRow key={`${g.playerId}-${g.playedOn}`} game={g} />)}
          {overflow.length > 0 ? (
            <details>
              <summary className="capline">
                <span aria-hidden="true" className="chev">▸</span>
                <span>Cap — best {gamesCap} count · {overflow.length} more, not counted</span>
              </summary>
              {overflow.map((g) => <ScoredRow key={`${g.playerId}-${g.playedOn}`} game={g} />)}
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function ScoredRow({ game }: { game: CountedGame }) {
  return (
    <div className="plr">
      <span className="plr-lead">
        <span className="slot" data-slot={game.slot} style={{ minWidth: "2.6rem", height: 22, fontSize: 10 }}>{game.slot}</span>
      </span>
      <span className="plr-id">
        <Link className="plr-name" href={`/players/${game.playerId}`}>{game.playerName}</Link>
        <span className="plr-sub"><span>{game.playedOn}</span></span>
      </span>
      <span className="plr-right">
        <Score value={game.score} size="xs" tone={game.counted ? "default" : "quiet"} />
      </span>
    </div>
  );
}

function MiniBug({ view }: { view: MatchupView }) {
  const sum = view.home.total + view.away.total;
  const homeLeads = sum > 0 && view.home.total > view.away.total;
  const awayLeads = sum > 0 && view.away.total > view.home.total;
  const remaining = view.home.live + view.home.upcoming + view.away.live + view.away.upcoming;
  return (
    <div className="minibug">
      <Link className="side" href={`/teams/${view.home.fantasyTeamId}`}>
        <Avatar name={view.home.name} seed={view.home.fantasyTeamId} size="xs" />
        <span className="nm">{view.home.name}</span>
      </Link>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap" }}>
          <span className="score score-xs sc" data-lead={homeLeads}>{view.home.total.toFixed(1)}</span>
          <span className="dash">–</span>
          <span className="score score-xs sc" data-lead={awayLeads}>{view.away.total.toFixed(1)}</span>
        </span>
        {remaining > 0 ? (
          <span className="sub" style={{ fontSize: 10, whiteSpace: "nowrap" }}>
            Proj {view.home.projected.toFixed(1)} – {view.away.projected.toFixed(1)}
          </span>
        ) : null}
      </span>
      <Link className="side them" href={`/teams/${view.away.fantasyTeamId}`}>
        <Avatar name={view.away.name} seed={view.away.fantasyTeamId} size="xs" />
        <span className="nm">{view.away.name}</span>
      </Link>
    </div>
  );
}
