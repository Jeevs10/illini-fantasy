import Link from "next/link";
import type { PlayoffPicture } from "@illini/league";
import { Avatar } from "../ui/identity.tsx";

const STATUS_LABEL: Record<PlayoffPicture["teams"][number]["status"], string> = {
  clinched: "Clinched", alive: "Alive", eliminated: "Eliminated",
};
const STATUS_PILL: Record<PlayoffPicture["teams"][number]["status"], string> = {
  clinched: "pill", alive: "pill ghost", eliminated: "pill ghost",
};

/**
 * Who is in, who is out, and who is still playing for it.
 *
 * Clinched and eliminated are the only two claims this can prove outright —
 * see `playoffPicture` — so a bubble team reads as "alive" on both sides of
 * the cut line rather than a guess about strength of schedule.
 */
export function Picture({ picture, mineId }: { picture: PlayoffPicture; mineId: number | null }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>The picture</h2>
          <p>
            Top {picture.cutLine} make the bracket.{" "}
            {picture.remainingWeeks === 0
              ? "The regular season is over."
              : `${picture.remainingWeeks} week${picture.remainingWeeks === 1 ? "" : "s"} left to settle it.`}
          </p>
        </div>
      </div>
      <table className="budgets picture">
        <caption className="sr-only">
          Every team in standings order; the line under {picture.cutLine} is the playoff cut
        </caption>
        <thead>
          <tr>
            <th scope="col" className="r">#</th>
            <th scope="col">Team</th>
            <th scope="col" className="r">Record</th>
            <th scope="col" className="r">Status</th>
          </tr>
        </thead>
        <tbody>
          {picture.teams.map((t) => (
            <tr key={t.fantasyTeamId} data-cut={t.rank === picture.cutLine || undefined}
                data-mine={t.fantasyTeamId === mineId || undefined}
                data-out={t.status === "eliminated" || undefined}>
              <td className="r tnum faint">{t.rank}</td>
              <th scope="row">
                <span className="budgets-team" style={{ marginBottom: 0 }}>
                  <Avatar name={t.name} seed={t.fantasyTeamId} size="xs" mine={t.fantasyTeamId === mineId} />
                  <Link href={`/teams/${t.fantasyTeamId}`} className="player-link">{t.name}</Link>
                </span>
              </th>
              <td className="r tnum">{t.wins}&ndash;{t.losses}{t.ties ? `–${t.ties}` : ""}</td>
              <td className="r"><span className={STATUS_PILL[t.status]}>{STATUS_LABEL[t.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
