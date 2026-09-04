import type { PlayoffPicture } from "@illini/league";
import { Avatar } from "../ui/identity.tsx";

const STATUS_LABEL: Record<PlayoffPicture["teams"][number]["status"], string> = {
  clinched: "Clinched", alive: "Alive", eliminated: "Eliminated",
};
const STATUS_PILL: Record<PlayoffPicture["teams"][number]["status"], string> = {
  clinched: "pill mine", alive: "pill ghost", eliminated: "pill crit",
};

/**
 * Who is in, who is out, and who is still playing for it.
 *
 * Clinched and eliminated are the only two claims this can prove outright —
 * see `playoffPicture` — so a bubble team reads as "alive" on both sides of
 * the cut line rather than a guess about strength of schedule.
 */
export function Picture({ picture }: { picture: PlayoffPicture }) {
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
      <div className="panel-body stack-sm">
        {picture.teams.map((t) => (
          <div className="row" key={t.fantasyTeamId} style={{ justifyContent: "space-between" }}
               data-cut={t.rank === picture.cutLine || undefined}>
            <span className="row" style={{ gap: "var(--s-2)" }}>
              <span className="tnum faint" style={{ minWidth: "1.5ch" }}>{t.rank}</span>
              <Avatar name={t.name} seed={t.fantasyTeamId} size="xs" />
              <span style={{ fontWeight: 600 }}>{t.name}</span>
              <span className="faint" style={{ fontSize: "var(--t-sm)" }}>
                {t.wins}&ndash;{t.losses}{t.ties ? `–${t.ties}` : ""}
              </span>
            </span>
            <span className={STATUS_PILL[t.status]}>{STATUS_LABEL[t.status]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
