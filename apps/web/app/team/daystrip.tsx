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

/**
 * Yesterday through the next five nights.
 *
 * Per-game locks make working ahead the only safe habit, so the day a manager
 * wants is usually not today. Without this the only way to reach tomorrow was
 * to hand-edit the query string.
 */
export function DayStrip({ day, today }: { day: string; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => shift(today, i - 1));
  return (
    <nav className="daystrip" aria-label="Choose a night">
      {days.map((d) => (
        <Link
          key={d}
          href={`/team?date=${d}`}
          data-active={d === day}
          aria-current={d === day ? "date" : undefined}
        >
          {d === today ? "Tonight" : label(d)}
        </Link>
      ))}
    </nav>
  );
}
