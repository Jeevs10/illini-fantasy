import Link from "next/link";
import { winProbability, type MatchupView, type TeamOutlook } from "@illini/league";
import { Avatar } from "./identity.tsx";

type Side = TeamOutlook & { name: string };

/**
 * A week's matchups as one list, the way a manager scans the league: every
 * game on one screen, theirs lifted to the top and stitched in orange, the
 * rest a step dimmer behind it.
 *
 * Each side shows what kind of number it is by its stitching. Points that
 * have been scored sit plain; a side with nothing scored yet leads with its
 * projection inside a dashed box, because "0.0" is not what a week that has
 * not started is worth. The win chance is the model's, from the projected
 * finals, for the side the reader cares about.
 */
export function MatchupList({
  matchups, mineId, today, selectedId = null, linkTo = (m) => `/league?week=${m.week}`,
}: {
  matchups: MatchupView[]; mineId: number | null; today: string;
  /** The matchup open below the list, on the matchup page. */
  selectedId?: number | null;
  linkTo?: (m: MatchupView) => string;
}) {
  const ordered = [...matchups].sort((a, b) => Number(isMine(b, mineId)) - Number(isMine(a, mineId)));
  return (
    <ol className="mlist">
      {ordered.map((m) => {
        const mine = isMine(m, mineId);
        // Yours on the left, always; otherwise home on the left.
        const [left, right] = m.away.fantasyTeamId === mineId ? [m.away, m.home] : [m.home, m.away];
        const remaining = left.live + left.upcoming + right.live + right.upcoming;
        const prob = winProbability(left.projected - right.projected, remaining);
        const live = left.live + right.live > 0;
        const ahead = m.startsOn > today;
        const unset = rosterless(left) && rosterless(right);
        return (
          <li key={m.matchupId} data-mine={mine || undefined} data-live={live || undefined}
              data-selected={m.matchupId === selectedId || undefined}>
            <Link href={linkTo(m)} className="mrow" scroll={selectedId === null ? undefined : false}
                  aria-current={m.matchupId === selectedId ? "true" : undefined}
                  aria-label={`${left.name} ${figure(left)} against ${right.name} ${figure(right)}`}>
              <SideCell side={left} mine={left.fantasyTeamId === mineId} align="left" settled={m.settled} />
              <span className="mrow-mid">
                {m.settled ? <span className="mrow-state">Final</span>
                  : live ? <span className="mrow-state" data-live>Live</span>
                  : unset ? <span className="mrow-state">No rosters</span>
                  : ahead ? <span className="mrow-state">Projected</span>
                  : <span className="mrow-state">{remaining} to play</span>}
                {!m.settled && remaining > 0 && !unset ? (
                  <span className="mrow-prob tnum" title="The model's chance from projected finals">
                    {Math.round(prob * 100)}–{Math.round((1 - prob) * 100)}
                  </span>
                ) : null}
              </span>
              <SideCell side={right} mine={right.fantasyTeamId === mineId} align="right" settled={m.settled} />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

const isMine = (m: MatchupView, mineId: number | null) =>
  mineId !== null && (m.home.fantasyTeamId === mineId || m.away.fantasyTeamId === mineId);

/** No one on the roster: no score and no projection, so neither is shown. */
const rosterless = (s: Side) =>
  s.players.length === 0 && s.pending.length === 0 && s.total === 0 && s.projected === 0;

/** Nothing scored and nothing final: the projection is the number. */
const leadsWithProjection = (s: Side) => s.gamesPlayed === 0 && s.total === 0;

const figure = (s: Side) => (rosterless(s) ? "no roster yet" : leadsWithProjection(s)
  ? `projected ${s.projected.toFixed(1)}` : `${s.total.toFixed(1)}, projected ${s.projected.toFixed(1)}`);

function SideCell({ side, mine, align, settled }: { side: Side; mine: boolean; align: "left" | "right"; settled: boolean }) {
  const projected = leadsWithProjection(side) && !settled;
  const empty = rosterless(side);
  return (
    <span className="mside" data-align={align}>
      <Avatar name={side.name} seed={side.fantasyTeamId} size="sm" mine={mine} />
      <span className="mside-id">
        <span className="mside-name">{side.name}</span>
        <span className="mside-sub tnum">
          {empty ? "no roster yet" : projected ? `${side.upcoming} games ahead`
            : `${side.gamesPlayed} played · proj ${side.projected.toFixed(1)}`}
        </span>
      </span>
      <span className="mside-score tnum" data-stitch={empty ? "none" : settled ? "final" : projected ? "projected" : "actual"}>
        {empty ? "—" : (projected ? side.projected : side.total).toFixed(1)}
      </span>
    </span>
  );
}
