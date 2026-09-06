"use client";

/**
 * Which week the pool is ranked for.
 *
 * A real navigation rather than a client-side filter: the ranking is a
 * different query, the answer is worth bookmarking, and the back button should
 * undo it. So this is an ordinary GET form that reloads `/players` with a
 * `week` in the query string, carrying whatever filters were already on.
 *
 * Seventeen weeks is too many for a segmented control and exactly right for a
 * `<select>`. It submits on change — a picker with a Go button beside it is a
 * picker half the league never finishes using — and keeps the button anyway
 * for anyone without JavaScript, where the change event never fires.
 */
export function WeekPicker({
  weeks, active, hidden,
}: {
  weeks: { week: number; label: string }[];
  /** The selected week, or null for the season-long ranking. */
  active: number | null;
  /** The other filters, preserved across the navigation. */
  hidden: Record<string, string>;
}) {
  if (weeks.length === 0) return null;
  return (
    <form className="weekpick" action="/players">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="pool-week">Rank for</label>
      <select
        id="pool-week"
        name="week"
        defaultValue={active === null ? "" : String(active)}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">Whole season</option>
        {weeks.map((w) => (
          <option key={w.week} value={w.week}>Week {w.week} · {w.label}</option>
        ))}
      </select>
      <noscript><button type="submit" className="sm">Go</button></noscript>
    </form>
  );
}
