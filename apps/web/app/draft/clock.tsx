"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BoardPick, DraftStatus } from "@illini/league";
import { monogram } from "../ui/identity.tsx";

/** A pick still to be made, as the on-deck strip shows it. */
export interface OnDeck { overall: number; round: number; teamName: string; mine: boolean }

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
  picksMade, totalPicks, upNext,
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
  /** The next picks in order, the one on the clock first. */
  upNext: OnDeck[];
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
      <section className="clockbar" data-state="complete" aria-labelledby="clock-head">
        <div className="clock-now">
          <h2 id="clock-head" className="clock-team">The draft is done</h2>
          <p className="clock-sub">All {totalPicks} picks are in and every roster is set.</p>
        </div>
        <Link className="button primary" href="/team">See your roster</Link>
      </section>
    );
  }

  if (status === "scheduled") {
    return (
      <section className="clockbar" data-state="scheduled" aria-labelledby="clock-head">
        <div className="clock-now">
          <h2 id="clock-head" className="clock-team">
            {onTheClock ? `${onTheClock.teamName} picks first` : "The order is drawn"}
          </h2>
          <p className="clock-sub">
            {totalPicks} picks, snaking back every round.
            {yourNextPick !== null ? ` You pick at ${yourNextPick}.` : ""}
          </p>
        </div>
        <Deck picks={upNext} label="The first picks" />
      </section>
    );
  }

  const urgent = left !== null && left <= 15;
  const who = onTheClock?.teamName ?? "Nobody";
  return (
    <section className="clockbar" data-state={status} data-yours={yourTurn} data-urgent={urgent}
             aria-labelledby="clock-head">
      <div className="clock-now">
        <h2 id="clock-head" className="clock-team">
          {yourTurn ? "You're on the clock" : `${who} ${status === "paused" ? "is up when it resumes" : "is on the clock"}`}
        </h2>
        <p className="clock-sub tnum">
          Pick {onTheClock?.overall ?? picksMade + 1}, round {onTheClock?.round ?? "—"}
          {yourNextPick !== null && !yourTurn ? `. You pick at ${yourNextPick}, ${picksAway(yourNextPick, onTheClock?.overall ?? picksMade + 1)}.` : ""}
        </p>
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
      <Deck picks={upNext.slice(1)} label="On deck" />
      <p className="sr-only" role="status" aria-live="polite">
        {status === "paused" ? "The draft is paused."
          : yourTurn ? "You are on the clock."
          : `${who} is on the clock.`}
      </p>
    </section>
  );
}

const picksAway = (yours: number, current: number) => {
  const n = yours - current;
  return n === 1 ? "the next pick" : `${n} picks away`;
};

/**
 * The picks still to come, hung as small banners in the order they fall. The
 * snake is the thing a manager cannot do in their head, and this is it drawn:
 * how many teams pick before you, and who.
 */
function Deck({ picks, label }: { picks: OnDeck[]; label: string }) {
  if (picks.length === 0) return null;
  return (
    <ol className="ondeck" aria-label={label}>
      {picks.map((p, i) => (
        <Fragment key={p.overall}>
          {/* Where the order turns back on itself for a new round. */}
          {i > 0 && picks[i - 1]!.round !== p.round ? (
            <li className="ondeck-turn" aria-label={`Round ${p.round} starts, order reversed`}>R{p.round}</li>
          ) : null}
          <li data-mine={p.mine || undefined}
              aria-label={`Pick ${p.overall}: ${p.teamName}${p.mine ? " (you)" : ""}`}>
            <span className="ondeck-pick tnum">{p.overall}</span>
            <span className="ondeck-mark" aria-hidden="true">{monogram(p.teamName)}</span>
            <span className="ondeck-name" aria-hidden="true">{p.mine ? "You" : p.teamName}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
