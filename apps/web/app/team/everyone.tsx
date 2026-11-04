"use client";

import { useActionState } from "react";
import type { PlayerAvailability } from "@illini/league";
import { reserve, type LineupState } from "./actions.ts";
import { PlayerRow, Dot } from "../ui/playerrow.tsx";
import { AvailabilityTag, Empty, RoleTag, Score, WeekFigure } from "../ui/bits.tsx";

/**
 * @illini/league's `IR_ELIGIBLE`, copied rather than imported so this client
 * component keeps pulling only types from the server package. moveToReserve
 * enforces the real rule; this only decides whether to show the button.
 */
const irEligible = (status: string | undefined) =>
  status === "out" || status === "doubtful" || status === "questionable";

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
  games: { playedOn: string; tipoff: string | null; opponent: string | null; score: number | null; projected: number | null; counted: boolean }[];
  scored: number;
  projectedWeek: number;
  availability?: PlayerAvailability;
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

/**
 * The week in a league where everybody plays.
 *
 * No slots: a game counts for whoever holds the player at its tip-off. So the
 * page answers three questions in order: who is on the roster and what they
 * are scoring, who was let go this week with points already banked, and who
 * is on IR. A game that did not count here (before he arrived, after he left,
 * or on IR) is shown struck through rather than hidden.
 */
export function EveryoneWeek({ rows }: { rows: EveryoneRow[] }) {
  const [state, submit, pending] = useActionState<LineupState, FormData>(reserve, {});
  const counting = rows.filter((r) => r.counting);
  const gone = rows.filter((r) => !r.held);
  const reserved = rows.filter((r) => r.held && r.reserve);

  const games = (r: EveryoneRow) => r.games.length === 0 ? "no games this week"
    : r.games.map((g) => `${day(g.playedOn)}${g.opponent ? ` ${g.opponent}` : ""}${
      g.score !== null ? ` ${g.score.toFixed(1)}` : g.projected !== null ? ` (proj ${g.projected.toFixed(1)})` : ""}${
      g.counted ? "" : " — not yours"}`).join(" · ");

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
    if (!irEligible(r.availability?.status)) return null;
    return (
      <form action={submit}>
        <input type="hidden" name="playerId" value={r.playerId} />
        <input type="hidden" name="name" value={r.name} />
        <button type="submit" className="sm" disabled={pending}
                title={`Move ${r.name} to IR — his seat opens now`}>To IR</button>
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
        {!r.held ? <><Dot /><span>let go — what he scored for you stays</span></> : null}
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
        <Empty title="Nobody on the roster" glyph="team">
          Add free agents to start scoring.
        </Empty>
      ) : (
        <section aria-label="On the roster">
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

      {gone.length > 0 ? (
        <section aria-label="Let go this week" style={{ marginTop: "var(--s-4)" }}>
          <h3 className="eyebrow" style={{ padding: "0 var(--s-4)" }}>Let go this week</h3>
          {gone.map((r) => row(r, <Score value={r.scored} size="sm" />))}
        </section>
      ) : null}

      {reserved.length > 0 ? (
        <section aria-label="Injured reserve" style={{ marginTop: "var(--s-4)" }}>
          <h3 className="eyebrow" style={{ padding: "0 var(--s-4)" }}>Injured reserve</h3>
          {reserved.map((r) => row(r, (
            <span className="row" style={{ gap: "var(--s-2)" }}>
              {irButton(r)}
              {r.scored !== 0 ? <Score value={r.scored} size="sm" /> : <span className="pill">IR</span>}
            </span>
          )))}
        </section>
      ) : null}
    </>
  );
}
