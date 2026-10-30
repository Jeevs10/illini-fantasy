"use client";

import { useActionState } from "react";
import type { PlayerAvailability } from "@illini/league";
import { reserve, type LineupState } from "./actions.ts";
import { PlayerRow, Dot } from "../ui/playerrow.tsx";
import { AvailabilityTag, Empty, RoleTag, Score, WeekFigure } from "../ui/bits.tsx";

/** A `WeekPlayer` as the page hands it over, with his injury status. */
export interface EveryoneRow {
  playerId: number;
  name: string;
  teamName: string | null;
  primaryColor: string | null;
  role: string | null;
  projected: number | null;
  counting: boolean;
  held: boolean;
  reserve: boolean;
  games: { playedOn: string; tipoff: string | null; opponent: string | null; score: number | null; projected: number | null }[];
  scored: number;
  projectedWeek: number;
  availability?: PlayerAvailability;
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

/**
 * The week in a league where everybody plays.
 *
 * No slots and no lock per player — the roster that counts was fixed at
 * Sunday's lock, and the only decisions left are roster moves for next week.
 * So the page answers three questions in order: who is scoring for me this
 * week and how, who joins on Sunday, and who is on IR.
 */
export function EveryoneWeek({ rows, nextLock }: { rows: EveryoneRow[]; nextLock: string }) {
  const [state, submit, pending] = useActionState<LineupState, FormData>(reserve, {});
  const counting = rows.filter((r) => r.counting);
  const joining = rows.filter((r) => !r.counting && r.held && !r.reserve);
  const reserved = rows.filter((r) => r.held && r.reserve && !r.counting);

  const games = (r: EveryoneRow) => r.games.length === 0 ? "no games this week"
    : r.games.map((g) => `${day(g.playedOn)}${g.opponent ? ` ${g.opponent}` : ""}${
      g.score !== null ? ` ${g.score.toFixed(1)}` : g.projected !== null ? ` (proj ${g.projected.toFixed(1)})` : ""}`).join(" · ");

  const irButton = (r: EveryoneRow) => {
    if (!r.held) return null;
    if (r.reserve) {
      return (
        <form action={submit}>
          <input type="hidden" name="playerId" value={r.playerId} />
          <input type="hidden" name="name" value={r.name} />
          <input type="hidden" name="activate" value="1" />
          <button type="submit" className="sm" disabled={pending}>Activate</button>
        </form>
      );
    }
    if (r.availability?.status !== "out") return null;
    return (
      <form action={submit}>
        <input type="hidden" name="playerId" value={r.playerId} />
        <input type="hidden" name="name" value={r.name} />
        <button type="submit" className="sm" disabled={pending}
                title={`Move ${r.name} to IR from ${nextLock}`}>To IR</button>
      </form>
    );
  };

  const row = (r: EveryoneRow, right: React.ReactNode) => (
    <PlayerRow
      key={r.playerId}
      playerId={r.playerId}
      name={r.name}
      rail={r.primaryColor}
      dim={!r.counting}
      badge={<span className="row" style={{ gap: "var(--s-1)" }}>
        <RoleTag role={r.role} />
        <AvailabilityTag status={r.availability?.status} injury={r.availability?.injury} compact />
      </span>}
      meta={<>
        <span>{r.teamName ?? "—"}</span>
        {r.projected !== null ? <><Dot /><span>{r.projected.toFixed(1)} proj</span></> : null}
        <Dot /><span>{games(r)}</span>
        {!r.held ? <><Dot /><span>let go — his last week here</span></> : null}
        {r.counting && r.reserve ? <><Dot /><span>on IR from {nextLock}</span></> : null}
      </>}
      right={right}
    />
  );

  return (
    <>
      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <p className={`notice ${state.error ? "bad" : "good"}`} style={{ margin: "0 var(--s-4) var(--s-3)" }}>
            {state.error ?? state.ok}
          </p>
        ) : null}
      </div>

      {counting.length === 0 ? (
        <Empty title="Nobody is counting this week" glyph="team">
          Players held at Sunday&rsquo;s lock score for the whole week. Anyone
          added since starts with the next one.
        </Empty>
      ) : (
        <section aria-label="Counting this week">
          {counting.map((r) => row(r, (
            <span className="row" style={{ gap: "var(--s-2)" }}>
              {irButton(r)}
              <span style={{ textAlign: "right" }}>
                <WeekFigure scored={r.scored} projected={r.projectedWeek} size="sm" block
                            played={r.games.some((g) => g.score !== null)} />
              </span>
            </span>
          )))}
        </section>
      )}

      {joining.length > 0 ? (
        <section aria-label="Joining next week" style={{ marginTop: "var(--s-4)" }}>
          <h3 className="eyebrow" style={{ padding: "0 var(--s-4)" }}>From {nextLock}</h3>
          {joining.map((r) => row(r, <span className="row" style={{ gap: "var(--s-2)" }}>{irButton(r)}<span className="pill">Next week</span></span>))}
        </section>
      ) : null}

      {reserved.length > 0 ? (
        <section aria-label="Injured reserve" style={{ marginTop: "var(--s-4)" }}>
          <h3 className="eyebrow" style={{ padding: "0 var(--s-4)" }}>Injured reserve</h3>
          {reserved.map((r) => row(r, <span className="row" style={{ gap: "var(--s-2)" }}>{irButton(r)}<span className="pill">IR</span></span>))}
        </section>
      ) : null}
    </>
  );
}
