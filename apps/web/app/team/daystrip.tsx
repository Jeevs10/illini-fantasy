import Link from "next/link";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const DAYMONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const shift = (day: string, by: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

export const label = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY.format(d)} ${DAYMONTH.format(d)}`;
};

export const window7 = (today: string): { from: string; to: string } =>
  ({ from: shift(today, -1), to: shift(today, 5) });

/** The seven days of a scoring period, from its first day. */
export const periodDays = (startsOn: string): { from: string; to: string } =>
  ({ from: startsOn, to: shift(startsOn, 6) });

/**
 * Yesterday through the next five nights.
 *
 * Per-game locks make working ahead the only safe habit, so the night a manager
 * wants is usually not tonight. The count under each date is how many of their
 * players are scheduled that night: without it this is seven identical buttons
 * and a college slate is uneven enough that most of them are empty.
 */
export function DayStrip({
  day, today, slate, from,
}: {
  day: string; today: string; slate: Map<string, number>;
  /**
   * The strip's first day. Defaults to yesterday; the team page passes the
   * first day of the week it is showing, so stepping to week 3 shows week 3's
   * nights rather than this week's again.
   */
  from?: string;
}) {
  const first = from ?? shift(today, -1);
  const days = Array.from({ length: 7 }, (_, i) => shift(first, i));
  return (
    <nav className="daystrip" aria-label="Choose a night">
      {days.map((d) => {
        const games = slate.get(d) ?? 0;
        const date = new Date(`${d}T00:00:00Z`);
        return (
          <Link
            key={d}
            href={`/team?date=${d}`}
            data-active={d === day}
            aria-current={d === day ? "date" : undefined}
            aria-label={`${label(d)} — ${games} game${games === 1 ? "" : "s"}`}
          >
            <span className="dow">{d === today ? "Tonight" : WEEKDAY.format(date)}</span>
            <span className="dnum">{d === today ? DAYMONTH.format(date).split(" ")[1] : DAYMONTH.format(date).split(" ")[1]}</span>
            <span className="games">{games === 0 ? "—" : games}</span>
          </Link>
        );
      })}
    </nav>
  );
}
