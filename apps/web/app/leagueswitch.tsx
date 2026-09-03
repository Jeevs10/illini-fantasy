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
        name="leagueId"
        aria-label="Which league"
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
