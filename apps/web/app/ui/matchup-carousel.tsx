"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface CarouselItem {
  id: number | string;
  node: ReactNode;
}

/**
 * The week's matchups, one at a time.
 *
 * A grid of minibugs said "here they all are" but told a reader nothing they
 * could not get from the standings page. Stepping through the full matchup —
 * arrow keys included, since a reader's hand is already on them from the rest
 * of the app — gives each one the same detail.
 *
 * The viewer's own matchup is not lifted out above this and shown twice. It is
 * simply where the carousel opens (`initialIndex`), and the schedule's order is
 * kept around it, so stepping left and right lands somewhere stable rather than
 * on a list that has had a hole cut in it.
 *
 * Takes pre-rendered nodes rather than matchup data: a scorebug is built from
 * `@illini/league`, which reaches all the way down to `pg`, and this file is
 * a client component. Rendering it on the server and handing over the result
 * keeps that server-only dependency graph out of the browser bundle — only
 * the index state and the keyboard listener need to run here.
 */
export function MatchupCarousel({
  items, initialIndex = 0, labels,
}: {
  items: CarouselItem[];
  /** Which one to open on — the viewer's own, when they have one. */
  initialIndex?: number;
  /** Short names for the dot strip, so a reader can see where they are. */
  labels?: string[];
}) {
  const count = items.length;
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(count - 1, 0)));

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
        <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
          <span className="tnum">{index + 1} of {count}</span>
          {labels?.[index] ? <> · {labels[index]}</> : null}
          {count > 1 ? " — use ← →" : null}
        </span>
        <button
          type="button" className="button sm" aria-label="Next matchup"
          onClick={() => setIndex((i) => (i + 1) % count)}
        >
          ›
        </button>
      </div>
      {count > 1 ? (
        <div className="carousel-dots" role="tablist" aria-label="Matchups">
          {items.map((item, i) => (
            <button
              key={item.id} type="button" role="tab" aria-selected={i === index}
              aria-label={labels?.[i] ?? `Matchup ${i + 1}`}
              data-on={i === index || undefined}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
      <div key={current.id}>{current.node}</div>
    </div>
  );
}
