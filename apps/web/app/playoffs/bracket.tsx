import Link from "next/link";
import type { BracketKind, BracketMatchView, BracketView } from "@illini/league";
import { Avatar } from "../ui/identity.tsx";
import { Score } from "../ui/bits.tsx";

const ROUND_TITLES: Record<string, string> = {
  QF: "Quarterfinals", SF: "Semifinals", F: "Final", "3rd": "Third place",
  R16: "Round of 16", R32: "Round of 32",
};

/**
 * A bracket, drawn as columns of matchup cards.
 *
 * The steel rule between columns carries "this round feeds that one" rather
 * than measuring pixels to draw an exact connector elbow for a shape that has
 * byes, a third-place game and a consolation pool feeding the same layout.
 * Each game wears the league's stitching: dashed until it is decided, doubled
 * once it is final.
 */
export function Bracket({
  view, title, bracket, rounds,
}: { view: BracketView; title: string; bracket: BracketKind; rounds: string[] }) {
  const matches = view.matches.filter((m) => m.bracket === bracket);
  if (matches.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-head"><h2>{title}</h2></div>
      <div className="bracket">
        {rounds.map((round) => {
          const inRound = matches.filter((m) => m.round === round);
          if (inRound.length === 0) return null;
          return (
            <div className="bracket-round" key={round}>
              <div className="bracket-roundlabel">{ROUND_TITLES[round] ?? round}</div>
              {inRound.map((m) => <MatchCard key={m.matchupId} match={m} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Side({ side, winner }: { side: BracketMatchView["home"]; winner: boolean }) {
  return (
    <div className="bracket-side" data-winner={winner || undefined}>
      <Avatar name={side.name ?? "TBD"} seed={side.fantasyTeamId ?? side.name ?? "tbd"} size="xs" />
      <span className="bracket-name">
        {side.name !== null
          ? <Link href={side.fantasyTeamId === null ? "/standings" : `/teams/${side.fantasyTeamId}`}>{side.name}</Link>
          : <span className="faint">TBD</span>}
        {side.seed !== null ? <span className="bracket-seed">{side.seed}</span> : null}
      </span>
      {side.points !== null ? <Score value={side.points} size="xs" tone={winner ? undefined : "quiet"} /> : null}
    </div>
  );
}

function MatchCard({ match }: { match: BracketMatchView }) {
  return (
    <div>
      <div className="bracket-match" data-stitch={match.winner ? "final" : "projected"}>
        <Side side={match.home} winner={match.winner === "home"} />
        <Side side={match.away} winner={match.winner === "away"} />
      </div>
      <div className="bracket-week">week {match.week}</div>
    </div>
  );
}
