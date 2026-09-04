"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardPick, DraftStatus } from "@illini/league";

/** How often an open room asks the server what happened. */
const POLL_MS = 5000;

const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Whose pick it is, and how long they have.
 *
 * Two jobs, and they are the same job. The countdown runs off the server's
 * deadline rather than the browser's clock, and when it reaches zero the
 * component asks the server to re-render — which is what actually makes the
 * autopick, since settling the clock happens on read. An open draft room is
 * therefore the thing that drives the draft forward, and a closed one costs
 * nothing: the next reader settles every pick that was due, at the time it was
 * due.
 */
export function Clock({
  status, onTheClock, secondsLeft, deadline, nowIso, yourTurn, yourNextPick,
  picksMade, totalPicks,
}: {
  status: DraftStatus;
  onTheClock: BoardPick | null;
  secondsLeft: number | null;
  deadline: string | null;
  nowIso: string;
  yourTurn: boolean;
  yourNextPick: number | null;
  picksMade: number;
  totalPicks: number;
}) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(secondsLeft);

  useEffect(() => {
    if (status !== "live" || deadline === null) { setLeft(null); return; }
    // The offset between the two clocks, measured once. The server's is the one
    // the deadline is judged against, so the browser's is only a stopwatch.
    const skew = Date.now() - new Date(nowIso).getTime();
    const tick = () => {
      const remaining = (new Date(deadline).getTime() - (Date.now() - skew)) / 1000;
      setLeft(Math.max(0, Math.round(remaining)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [status, deadline, nowIso]);

  useEffect(() => {
    if (status !== "live") return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [status, router]);

  // The buzzer. Refreshing is what makes the pick the deadline has earned.
  useEffect(() => {
    if (status !== "live" || left === null || left > 0) return;
    const timer = setTimeout(() => router.refresh(), 1200);
    return () => clearTimeout(timer);
  }, [status, left, router]);

  if (status === "complete") {
    return (
      <div className="clockbar" data-state="complete">
        <div>
          <span className="eyebrow">Draft complete</span>
          <strong className="clock-team">{totalPicks} picks made</strong>
        </div>
        <span className="pill live">Rosters are set</span>
      </div>
    );
  }

  if (status === "scheduled") {
    return (
      <div className="clockbar" data-state="scheduled">
        <div>
          <span className="eyebrow">Not started</span>
          <strong className="clock-team">
            {onTheClock ? `${onTheClock.teamName} picks first` : "The order is drawn"}
          </strong>
        </div>
        <span className="pill">{totalPicks} picks</span>
      </div>
    );
  }

  const urgent = left !== null && left <= 15;
  return (
    <div className="clockbar" data-state={status} data-yours={yourTurn} data-urgent={urgent}>
      <div>
        <span className="eyebrow">
          {status === "paused" ? "Paused" : yourTurn ? "You are on the clock" : "On the clock"}
        </span>
        <strong className="clock-team">{onTheClock?.teamName ?? "—"}</strong>
        <span className="clock-sub">
          Pick {onTheClock?.overall ?? picksMade + 1} &middot; round {onTheClock?.round ?? "—"}
          {yourNextPick !== null && !yourTurn ? ` · you pick at ${yourNextPick}` : ""}
        </span>
      </div>
      {status === "paused" ? (
        <span className="pill warn">Clock stopped</span>
      ) : left === null ? (
        <span className="pill">No clock</span>
      ) : (
        // aria-live off by design: a per-second countdown read aloud is unusable.
        // The turn change below it is the announcement that matters.
        <span className="countdown num" aria-hidden="true">{mmss(left)}</span>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {status === "paused" ? "The draft is paused."
          : yourTurn ? "You are on the clock."
          : `${onTheClock?.teamName ?? "Nobody"} is on the clock.`}
      </p>
    </div>
  );
}
