import Link from "next/link";

const SPAN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (iso: string) => SPAN.format(new Date(`${iso}T00:00:00Z`));

/**
 * The season as one line of weeks: the ones behind us filled, this one lit,
 * the rest outlined. Each station opens that week's matchups, so the line is
 * also the quickest way to any week of the schedule.
 */
export function SeasonLine({
  weeks, today,
}: { weeks: { week: number; startsOn: string; endsOn: string }[]; today: string }) {
  if (weeks.length === 0) return null;
  const current = weeks.find((w) => w.startsOn <= today && today <= w.endsOn)
    ?? weeks.find((w) => w.startsOn > today) ?? null;
  return (
    <nav className="seasonline" aria-label="Season schedule">
      <ol>
        {weeks.map((w) => {
          const state = w.endsOn < today ? "past" : w === current ? "now" : "ahead";
          return (
            <li key={w.week} data-state={state}>
              <Link href={`/league?week=${w.week}`} aria-current={state === "now" ? "step" : undefined}
                    title={`Week ${w.week}: ${day(w.startsOn)} – ${day(w.endsOn)}`}>
                <span className="station" aria-hidden="true" />
                <span className="wk">{w.week}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      {current ? (
        <p className="seasonline-now">
          Week {current.week} · {day(current.startsOn)} – {day(current.endsOn)}
        </p>
      ) : null}
    </nav>
  );
}
