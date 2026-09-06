import Link from "next/link";
import type {
  CountedGame, LeagueSettings, MatchupView, PendingGame, PlayerAvailability, PlayerWeek, TeamOutlook,
} from "@illini/league";
import { availabilityFor, seasonWeeks, weekMatchups } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { buildSlots } from "../team/slots.ts";
import { Avatar } from "../ui/identity.tsx";
import { AvailabilityTag, Empty, ET, LiveTag, Score } from "../ui/bits.tsx";
import { MatchupCarousel } from "../ui/matchup-carousel.tsx";
import { ScoreBug, type BugSide } from "../ui/scorebug.tsx";

export const dynamic = "force-dynamic";

export default async function LeaguePage({
  searchParams,
}: { searchParams: Promise<{ date?: string; week?: string }> }) {
  const { date, week } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, configId, settings, fantasyTeamId } = viewer.membership;
  const now = viewNow();
  const today = viewDate();

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

  // The viewer's own matchup is where the carousel opens rather than a second
  // copy pinned above it: one matchup on the screen at a time, and the
  // schedule's order kept around it so stepping left and right is stable.
  const mineIndex = matchups.findIndex(
    (m) => m.home.fantasyTeamId === fantasyTeamId || m.away.fantasyTeamId === fantasyTeamId);
  const { week: weekNumber, startsOn, endsOn } = matchups[0]!;

  // Every starter on every side, so the carousel's rosters carry the same
  // injury notes the viewer's own does. One lookup rather than one per
  // matchup: the carousel renders all of them on the server anyway.
  const everyone = matchups
    .flatMap((m) => [m.home, m.away])
    .flatMap((o) => [...o.pending.map((p) => p.playerId), ...o.players.map((p) => p.playerId)]);
  const availability = await availabilityFor(db, [...new Set(everyone)]);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Week {weekNumber}</h1>
          <p className="meta">
            <span>{startsOn} &ndash; {endsOn}</span>
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

      <div className="rise">
        <MatchupCarousel
          initialIndex={mineIndex < 0 ? 0 : mineIndex}
          labels={matchups.map((m, i) => (i === mineIndex
            ? "Your matchup"
            : `${m.home.name} v ${m.away.name}`))}
          items={matchups.map((m, i) => ({
            id: m.matchupId,
            node: (
              <Matchup
                view={m} today={today} now={now} settings={settings}
                availability={availability}
                // Only the viewer's own matchup names a side as theirs. On
                // everyone else's, neither team is "yours" and the home side
                // simply goes on the left.
                fantasyTeamId={i === mineIndex ? fantasyTeamId : null}
              />
            ),
          }))}
        />
      </div>
    </>
  );
}

/** One matchup in full: the bug, then both rosters under it. */
function Matchup({
  view, fantasyTeamId, today, now, settings, availability,
}: {
  view: MatchupView;
  fantasyTeamId: number | null;
  today: string;
  now: Date;
  settings: LeagueSettings;
  availability: Map<number, PlayerAvailability>;
}) {
  // Whoever the viewer runs goes on the left, on both screens — the bug and
  // the rosters have to agree about which side is which or the two halves of
  // one matchup read as two different games.
  const homeIsMine = view.home.fantasyTeamId === fantasyTeamId;
  const [left, right] = homeIsMine || fantasyTeamId === null
    ? [view.home, view.away] : [view.away, view.home];

  // A week with nothing left in it has no forecast to give, and a column of
  // projections that each restate the score beside them is a column of noise.
  // Decided for the matchup rather than per side, so the two panels keep the
  // same shape and stay readable across.
  const projecting = left.live + left.upcoming + right.live + right.upcoming > 0;

  return (
    <>
      <ScoreBug
        week={view.week} startsOn={view.startsOn} endsOn={view.endsOn}
        settled={view.settled} today={today}
        home={bug(view.home, fantasyTeamId)}
        away={bug(view.away, fantasyTeamId)}
      />
      <div className="rosters" style={{ marginTop: "var(--s-4)" }}>
        <RosterPanel side={left} mine={left.fantasyTeamId === fantasyTeamId} projecting={projecting}
                     now={now} settings={settings} availability={availability} />
        <RosterPanel side={right} mine={right.fantasyTeamId === fantasyTeamId} projecting={projecting}
                     now={now} settings={settings} availability={availability} />
      </div>
    </>
  );
}

function bug(o: MatchupView["home"], mineId: number | null): BugSide {
  return {
    fantasyTeamId: o.fantasyTeamId, name: o.name,
    total: o.total, projected: o.projected,
    gamesPlayed: o.gamesPlayed,
    live: o.live, upcoming: o.upcoming,
    pendingSlots: bySlot(o.pending),
    mine: o.fantasyTeamId === mineId,
  };
}

/** Still-to-play games, grouped by slot for the "N to play" breakdown. */
function bySlot(pending: TeamOutlook["pending"]): { slot: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of pending) counts.set(p.slot, (counts.get(p.slot) ?? 0) + 1);
  return [...counts.entries()].map(([slot, count]) => ({ slot, count }));
}

/**
 * One side's week, one row per starter.
 *
 * Laid out in the league's own slot order — every G, then every F, then the
 * B, then the FLEXes — with an empty row wherever a side has nobody in a
 * slot, so the two panels line up rank for rank and a reader can compare
 * across without counting. Ranking each side by its own points would put a
 * guard opposite a centre and make the side-by-side an accident.
 *
 * The number on a row is the player's *week*: what he has banked, with what
 * the rest of his slate is expected to add quoted under it. A starter with
 * three games is one row, not three — the game-by-game breakdown is evidence
 * for that number and opens underneath it, which is the right way round. The
 * old layout led with a list of individual pending games and made a reader
 * add up a player's week themselves.
 */
function RosterPanel({
  side, mine, projecting, now, settings, availability,
}: {
  side: MatchupView["home"];
  mine: boolean;
  /** Whether this week still has games in it worth quoting a forecast for. */
  projecting: boolean;
  now: Date; settings: LeagueSettings;
  availability: Map<number, PlayerAvailability>;
}) {
  // Each starter's nights, played and still to come, so a row can be opened
  // for the games its total is made of.
  const played = new Map<number, CountedGame[]>();
  for (const g of [...side.games].sort((a, b) => a.playedOn.localeCompare(b.playedOn))) {
    played.set(g.playerId, [...(played.get(g.playerId) ?? []), g]);
  }
  const pending = new Map<number, PendingGame[]>();
  for (const p of [...side.pending].sort((a, b) => (a.tipoff ?? "~").localeCompare(b.tipoff ?? "~"))) {
    pending.set(p.playerId, [...(pending.get(p.playerId) ?? []), p]);
  }

  const rows = buildSlots(side.players, settings);
  const seated = new Set(rows.map((r) => r.player?.playerId).filter(Boolean));
  // Legacy weeks set a night at a time can hold more starters than the league
  // has slots. They scored, so they are listed rather than dropped — after the
  // slots, where they cannot knock the two panels out of alignment.
  const overflow = side.players.filter((p) => !seated.has(p.playerId));

  const toPlay = side.live + side.upcoming;

  return (
    <div className="panel" data-density="compact">
      <div className="panel-head">
        <span className="row" style={{ gap: "var(--s-3)", minWidth: 0 }}>
          <Avatar name={side.name} seed={side.fantasyTeamId} size="md" mine={mine} />
          <span style={{ minWidth: 0 }}>
            <h2 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{side.name}</h2>
            <p>
              {side.gamesPlayed} game{side.gamesPlayed === 1 ? "" : "s"} played
              {toPlay > 0 ? ` · ${toPlay} to play` : ""}
            </p>
          </span>
        </span>
        {/* The score, with where the week is heading under it — the shape
          * every scoreboard in the sport uses, and the one a manager reads
          * without being told which number is which. */}
        <span style={{ textAlign: "right", flex: "none" }}>
          <div className="eyebrow">Score</div>
          <Score value={side.total} size="lg" tone={mine ? "accent" : "default"} />
          <div className="faint tnum" style={{ fontSize: "var(--t-xs)", marginTop: 1 }}>
            {toPlay > 0 ? <>proj <strong>{side.projected.toFixed(1)}</strong></>
              : side.gamesPlayed > 0 ? "final"
              : /* A week nobody played is not final; it is empty. */ "\u2014"}
          </div>
        </span>
      </div>

      <div className="subhead">
        <h3>The week, by starter</h3>
        <span className="pill ghost">{projecting ? "Week total · projected" : "Week total"}</span>
      </div>

      {side.players.length === 0 ? (
        <Empty title="No lineup for this week" glyph="clock">
          Nobody is set to start, so there is nothing to project. Lineups are
          set on the team page.
        </Empty>
      ) : (
        <>
          {rows.map((row) => (
            row.player === null
              ? <EmptySlot key={row.key} slot={row.slot} />
              : (
                <StarterRow
                  key={row.key} slot={row.slot} player={row.player} now={now}
                  projecting={projecting}
                  played={played.get(row.player.playerId) ?? []}
                  pending={pending.get(row.player.playerId) ?? []}
                  availability={availability.get(row.player.playerId)}
                />
              )
          ))}
          {overflow.length > 0 ? (
            <>
              <div className="capline"><span>Also started this week</span></div>
              {overflow.map((p) => (
                <StarterRow
                  key={p.playerId} slot={p.slot} player={p} now={now}
                  projecting={projecting}
                  played={played.get(p.playerId) ?? []}
                  pending={pending.get(p.playerId) ?? []}
                  availability={availability.get(p.playerId)}
                />
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC",
});
const dayOf = (ymd: string) => DAY.format(new Date(`${ymd}T00:00:00Z`));

function StarterRow({
  slot, player, played, pending, now, projecting, availability,
}: {
  slot: string;
  player: PlayerWeek;
  played: CountedGame[];
  pending: PendingGame[];
  now: Date;
  projecting: boolean;
  availability?: PlayerAvailability;
}) {
  const projected = player.projected ?? player.total;
  const next = pending[0];
  const live = pending.some((p) => p.tipoff !== null && new Date(p.tipoff) <= now);
  const games = played.length + pending.length;

  return (
    <details className="wk">
      <summary className="plr" data-state={live ? "live" : undefined}>
        <span className="plr-lead">
          <span className="slot" data-slot={slot}
                style={{ minWidth: "2.6rem", height: 22, fontSize: 10 }}>{slot}</span>
        </span>
        <span className="plr-id">
          <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
            <span className="plr-name">{player.playerName}</span>
            <AvailabilityTag status={availability?.status} injury={availability?.injury} compact />
          </span>
          <span className="plr-sub">
            <span>{games} game{games === 1 ? "" : "s"}</span>
            {played.length > 0 && pending.length > 0 ? (
              <><span className="dot" /><span>{played.length} in</span></>
            ) : null}
            {live ? (
              <><span className="dot" /><LiveTag /></>
            ) : next ? (
              <>
                <span className="dot" />
                <span>
                  {next.opponent ? `vs ${next.opponent} ` : ""}
                  {next.tipoff ? <ET iso={next.tipoff} /> : dayOf(next.playedOn)}
                </span>
              </>
            ) : null}
          </span>
        </span>
        {/* Banked and projected, one above the other. Two numbers rather than
          * one because they answer different questions, and a week that still
          * has games in it is not described by either alone. */}
        <span className="plr-right">
          <span className="plr-figure">
            <Score value={player.total} size="sm" tone={played.length === 0 ? "quiet" : "default"} />
            <span className="cap">pts</span>
          </span>
          {projecting ? (
            <span className="plr-figure" style={{ minWidth: "3.1rem" }}>
              <span className="tnum" style={{
                fontSize: "var(--t-sm)", fontWeight: 650,
                color: pending.length > 0 ? "var(--ink-2)" : "var(--ink-3)",
              }}>
                {projected.toFixed(1)}
              </span>
              <span className="cap">proj</span>
            </span>
          ) : null}
        </span>
      </summary>

      {played.map((g) => (
        <div className="plr" key={`p-${g.playedOn}`}>
          <span className="plr-lead">
            <span className="slot" data-slot={g.slot}
                  style={{ minWidth: "2.6rem", height: 22, fontSize: 10 }}>{g.slot}</span>
          </span>
          <span className="plr-id">
            <span className="plr-name">{dayOf(g.playedOn)}</span>
            <span className="plr-sub"><span>final</span></span>
          </span>
          <span className="plr-right"><Score value={g.score} size="xs" /></span>
        </div>
      ))}
      {pending.map((g) => (
        <div className="plr" key={`n-${g.playedOn}`}>
          <span className="plr-lead">
            <span className="slot" data-slot={g.slot}
                  style={{ minWidth: "2.6rem", height: 22, fontSize: 10 }}>{g.slot}</span>
          </span>
          <span className="plr-id">
            <span className="plr-name">{dayOf(g.playedOn)}</span>
            <span className="plr-sub">
              <span>{g.opponent ? `vs ${g.opponent}` : "TBD"}</span>
              {g.tipoff ? <><span className="dot" /><span><ET iso={g.tipoff} /> ET</span></> : null}
            </span>
          </span>
          <span className="plr-right">
            <span className="plr-figure">
              <Score value={g.projected} size="xs" tone="quiet" />
              <span className="cap">proj</span>
            </span>
          </span>
        </div>
      ))}
    </details>
  );
}

/**
 * A slot this side has nobody in.
 *
 * Rendered rather than skipped: the two panels are read across, and a missing
 * row would slide every row under it out of line with the opponent's.
 */
function EmptySlot({ slot }: { slot: string }) {
  return (
    <div className="plr" data-state="empty">
      <span className="plr-lead">
        <span className="slot" data-slot={slot} data-empty="true"
              style={{ minWidth: "2.6rem", height: 22, fontSize: 10 }}>{slot}</span>
      </span>
      <span className="plr-id">
        <span className="plr-name" style={{ color: "var(--warn)" }}>Empty {slot}</span>
        <span className="plr-sub"><span>nobody is scoring here</span></span>
      </span>
      <span className="plr-right">
        <span className="plr-figure">
          <Score value={0} size="sm" tone="quiet" />
          <span className="cap">pts</span>
        </span>
      </span>
    </div>
  );
}
