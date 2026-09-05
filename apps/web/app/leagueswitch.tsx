"use client";

import { switchLeague } from "./switch.ts";

/**
 * Which league you are looking at.
 *
 * Only rendered when there is a choice to make. A single-league manager — which
 * is nearly everyone — should not have to read a control that has one option.
 */
export function LeagueSwitch({
  leagues, current,
}: { leagues: { leagueId: number; leagueName: string }[]; current: number }) {
  if (leagues.length < 2) return null;
  return (
    <form className="leagueswitch" action={switchLeague}>
      <select
        // Uncontrolled, so it needs a fresh DOM node — not just a fresh
        // `defaultValue` prop — whenever the server-selected league changes,
        // or the picker's own label freezes at whatever it showed on first
        // mount even after a successful switch. `key` on `current` is what
        // remounts it.
        key={current}
        name="leagueId"
        aria-label="Which league"
        title={leagues.find((l) => l.leagueId === current)?.leagueName}
        defaultValue={String(current)}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {leagues.map((l) => (
          <option key={l.leagueId} value={l.leagueId}>{l.leagueName}</option>
        ))}
      </select>
    </form>
  );
}
