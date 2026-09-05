"use client";

import { useState } from "react";
import { PanelTabs } from "../../ui/tabs.tsx";

/**
 * The modal's own organisation of the card's three sections.
 *
 * The full page stacks all three because a page can scroll as far as it
 * needs to; a centred overlay wants a bound on how tall it gets, so here they
 * are panels behind tabs instead. Each section arrives already rendered —
 * server-computed JSX passed down as a prop, not a callback — so this stays a
 * thin client shell around content it never has to fetch or recompute.
 */
export function CardTabs({
  overview, seasonAverages, gameLog,
}: { overview: React.ReactNode; seasonAverages: React.ReactNode | null; gameLog: React.ReactNode }) {
  const tabs = [
    { key: "overview", label: "Overview" },
    ...(seasonAverages ? [{ key: "averages", label: "Season averages" }] : []),
    { key: "log", label: "Game log" },
  ];
  const [active, setActive] = useState("overview");

  return (
    <>
      <PanelTabs tabs={tabs} active={active} onSelect={setActive} ariaLabel="Player card sections" />
      <div style={{ marginTop: "var(--s-4)" }}>
        {active === "overview" ? overview : null}
        {active === "averages" ? seasonAverages : null}
        {active === "log" ? gameLog : null}
      </div>
    </>
  );
}
