import Link from "next/link";
import { winProbability } from "@illini/league";
import { Avatar } from "./identity.tsx";
import { Score, LiveTag } from "./bits.tsx";

/**
 * The scorebug.
 *
 * A fantasy week is a contest, and a contest has a scoreboard: two names, two
 * numbers, and one bar saying who is ahead by how much. Everything else on the
 * matchup screen is evidence for what this says at a glance.
 *
 * Your team is always on the left. The schedule's idea of home and away means
 * nothing here — there is no venue — and reading your own score in a different
 * place each week is the one thing a scoreboard must never do.
 */

export interface BugSide {
  fantasyTeamId: number;
  name: string;
  total: number;
  /** Where the week lands if the pending games score their projections. */
  projected: number;
  gamesCounted: number;
  gamesPlayed: number;
  live: number;
  upcoming: number;
  mine: boolean;
  /** Slots still to play tonight and beyond — the "yet to play" breakdown. */
  pendingSlots?: { slot: string; count: number }[];
}

const MONTHDAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (from: string, to: string) =>
  `${MONTHDAY.format(new Date(`${from}T00:00:00Z`))} – ${MONTHDAY.format(new Date(`${to}T00:00:00Z`))}`;

export function ScoreBug({
  week, startsOn, endsOn, settled, gamesCap, home, away, href, today,
}: {
  week: number; startsOn: string; endsOn: string; settled: boolean; gamesCap: number;
  home: BugSide; away: BugSide; href?: string;
  /** The date the app treats as today — what makes a week past, current, or ahead. */
  today: string;
}) {
  const [left, right] = away.mine ? [away, home] : [home, away];

  // With nothing played neither side leads, and a plain `>=` painted every
  // future week's first team in leader-orange.
  const decided = left.total !== right.total;
  const leftLeads = decided && left.total > right.total;
  const liveNow = left.live + right.live;
  const remaining = left.live + left.upcoming + right.live + right.upcoming;

  const sum = left.total + right.total;
  const share = sum === 0 ? 50 : (left.total / sum) * 100;
  const ahead = startsOn > today;
  const over = endsOn < today;
  // Nothing played, nothing pending, and the week is behind us: the schedule
  // held it and the season never filled it in. A 50/50 bar and a "winner"
  // would both be lies. A week still ahead is not this — it has projections
  // to show — and calling it "never played" was the bug that made every
  // future matchup read 0.0.
  const unplayed = sum === 0 && remaining === 0
    && left.gamesPlayed === 0 && right.gamesPlayed === 0 && !ahead;
  const margin = left.mine || right.mine ? (left.mine ? left : right).total - (left.mine ? right : left).total : null;

  // From projected finals rather than totals-so-far — the model's whole point
  // is to say something about the games that have not happened yet.
  const leftWinProb = winProbability(left.projected - right.projected, remaining);

  return (
    <section className="scorebug" data-live={liveNow > 0 || undefined}>
      <div className="scorebug-top">
        <span className="eyebrow">Week {week}</span>
        <span className="eyebrow" style={{ color: "var(--ink-2)" }}>{span(startsOn, endsOn)}</span>
        {/*
          * Settled first, and a week whose last night has passed second. A
          * settled week is final by definition, and one that is simply over is
          * final in every way a manager cares about — waiting on a box score
          * that never came for a player who did not dress is not "in progress".
          * Ranking a live badge above those is what left a November week
          * reading "2 playing" in January.
          */}
        {settled ? <span className="pill">Final</span>
          : unplayed ? <span className="pill ghost">Not played</span>
          : over ? <span className="pill">Final</span>
          : liveNow > 0 ? <LiveTag label={`${liveNow} playing`} />
          : ahead ? <span className="pill ghost">Scheduled</span>
          : remaining > 0 ? <span className="pill ghost">In progress</span>
          : <span className="pill ghost">Scheduled</span>}
        <span className="pill ghost">Best {gamesCap} count</span>
      </div>

      <div className="scorebug-body">
        <Team side={left} lead={leftLeads} unplayed={unplayed} anyMine={left.mine || right.mine} />
        <div className="scorebug-mid"><span className="vs">VS</span></div>
        <Team side={right} lead={decided && !leftLeads} unplayed={unplayed} anyMine={left.mine || right.mine} them />
      </div>

      {unplayed ? null : (
        <div className="winprob" title="Modeled from projected final totals, not a fact about who wins">
          <div className="leadbar thin" role="img"
               aria-label={`Model: ${left.name} ${Math.round(leftWinProb * 100)}%, ${right.name} ${Math.round((1 - leftWinProb) * 100)}%`}>
            <span style={{ transform: `scaleX(${leftWinProb})` }} data-tone={left.mine ? undefined : "them"} />
            <span style={{ transform: `scaleX(${1 - leftWinProb})` }} data-tone={right.mine ? undefined : "them"} />
          </div>
          <div className="scorebug-legend">
            <span>{Math.round(leftWinProb * 100)}%</span>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>
              Model — win probability
            </span>
            <span>{Math.round((1 - leftWinProb) * 100)}%</span>
          </div>
        </div>
      )}

      <div className="scorebug-foot">
        <div className="leadbar" data-empty={unplayed || undefined} role="img"
             aria-label={unplayed ? "Not played"
               : `${left.name} ${left.total.toFixed(1)}, ${right.name} ${right.total.toFixed(1)}`}>
          {unplayed ? null : (
            <>
              <span style={{ transform: `scaleX(${share / 100})` }} data-tone={left.mine ? undefined : "them"} />
              <span style={{ transform: `scaleX(${(100 - share) / 100})` }} data-tone={right.mine ? undefined : "them"} />
            </>
          )}
        </div>
        <div className="scorebug-legend">
          <span>{unplayed ? "" : `${left.gamesCounted} of ${left.gamesPlayed} count`}</span>
          <span style={{ color: "var(--ink-2)", textAlign: "center", fontWeight: 700 }}>
            {/*
              * Before a week starts there is no lead to report, only a
              * forecast — so the margin is quoted off the projections, and
              * said to be one.
              */}
            {unplayed
              ? "This week was never played"
              : ahead && sum === 0
              ? (() => {
                  const gap = (left.mine ? left : right).projected - (left.mine ? right : left).projected;
                  const [front, back] = left.projected >= right.projected ? [left, right] : [right, left];
                  return margin === null
                    ? `${front.name} projected by ${(front.projected - back.projected).toFixed(1)}`
                    : `Projected ${gap >= 0 ? "ahead" : "behind"} by ${Math.abs(gap).toFixed(1)}`;
                })()
              : margin === null
              ? decided ? `${leftLeads ? left.name : right.name} by ${Math.abs(left.total - right.total).toFixed(1)}` : "Level"
              : margin === 0 ? "Level"
              : `${margin > 0 ? "Leading" : "Trailing"} by ${Math.abs(margin).toFixed(1)}`}
            {remaining > 0 ? ` · ${remaining} to play` : ""}
          </span>
          <span>{unplayed ? "" : `${right.gamesCounted} of ${right.gamesPlayed} count`}</span>
        </div>
        {href ? (
          <Link className="button sm" href={href} style={{ justifySelf: "center", marginTop: "var(--s-2)" }}>
            Player by player
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Team({
  side, lead, unplayed = false, them = false, anyMine = side.mine,
}: { side: BugSide; lead: boolean; unplayed?: boolean; them?: boolean; anyMine?: boolean }) {
  const pending = side.live + side.upcoming;
  return (
    <div className="scorebug-side" data-lead={lead} data-mine={side.mine || undefined}>
      <span className="who">
        <Avatar name={side.name} seed={side.fantasyTeamId} size="lg" mine={side.mine} />
        <span style={{ minWidth: 0 }}>
          <span className="name">{side.name}</span>
          <span className="sub">
            {[
              side.mine ? "Your team" : anyMine ? "Opponent" : null,
              side.live > 0 ? `${side.live} live` : null,
            ].filter(Boolean).join(" · ")}
          </span>
        </span>
      </span>
      <Score value={side.total} size="2xl"
             tone={unplayed ? "quiet" : side.mine ? "accent" : lead ? "default" : "quiet"} />
      {unplayed ? (
        <span className="sub" style={{ textAlign: them ? "right" : "left" }}>Not played</span>
      ) : pending > 0 ? (
        <span className="sub" style={{ textAlign: them ? "right" : "left" }}>
          Proj <strong className="tnum" style={{ color: "var(--ink-2)" }}>{side.projected.toFixed(1)}</strong>
          {" · "}{pending} to play
          {side.pendingSlots && side.pendingSlots.length > 0
            ? ` — ${side.pendingSlots.map((s) => `${s.count} ${s.slot}`).join(" · ")}`
            : ""}
        </span>
      ) : (
        <span className="sub" style={{ textAlign: them ? "right" : "left" }}>
          {lead ? "Winner" : "All games in"}
        </span>
      )}
    </div>
  );
}
