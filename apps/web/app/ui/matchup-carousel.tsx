"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface CarouselItem {
  id: number | string;
  node: ReactNode;
}

/**
 * Every other matchup this week, one at a time.
 *
 * A grid of minibugs said "here they all are" but told a reader nothing they
 * could not get from the standings page. Stepping through the full scorebug —
 * arrow keys included, since a reader's hand is already on them from the rest
 * of the app — gives each matchup the same detail the viewer's own gets.
 *
 * Takes pre-rendered nodes rather than matchup data: a scorebug is built from
 * `@illini/league`, which reaches all the way down to `pg`, and this file is
 * a client component. Rendering it on the server and handing over the result
 * keeps that server-only dependency graph out of the browser bundle — only
 * the index state and the keyboard listener need to run here.
 */
export function MatchupCarousel({ items }: { items: CarouselItem[] }) {
  const count = items.length;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
      else if (e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  if (count === 0) return null;
  const current = items[index % count]!;

  return (
    <div className="carousel">
      <div className="carousel-nav">
        <button
          type="button" className="button sm" aria-label="Previous matchup"
          onClick={() => setIndex((i) => (i - 1 + count) % count)}
        >
          ‹
        </button>
        <span className="faint tnum" style={{ fontSize: "var(--t-xs)" }}>
          {index + 1} of {count} — use ← →
        </span>
        <button
          type="button" className="button sm" aria-label="Next matchup"
          onClick={() => setIndex((i) => (i + 1) % count)}
        >
          ›
        </button>
      </div>
      <div key={current.id}>{current.node}</div>
    </div>
  );
}
