"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Startable, LeagueSettings, Slot } from "@illini/league";
import { autoFill, moveToSlot, type LineupState } from "./actions.ts";

const START_ORDER: Slot[] = ["G", "F", "C", "FLEX"];

/**
 * Tip-off, always in Eastern.
 *
 * Not the viewer's timezone: formatting from the browser's zone means the
 * server renders one string and the client another, which is a hydration
 * mismatch and — as it turned out — a column that silently flips to UTC on a
 * client-side navigation. College tip-offs are published in Eastern, so a
 * fixed zone is the more useful answer as well as the stable one.
 */
const ET = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
});

function Tipoff({ iso }: { iso: string | null }) {
  if (iso === null) return <>—</>;
  return <time dateTime={iso}>{ET.format(new Date(iso))}</time>;
}

export function Lineup({
  day, startable, settings, eligible,
}: {
  day: string;
  startable: Startable[];
  settings: LeagueSettings;
  /** Slots each player may take, resolved on the server from their archetype. */
  eligible: Record<number, Slot[]>;
}) {
  const [state, submitMove, moving] = useActionState<LineupState, FormData>(
    moveToSlot, {});
  const [fillState, submitFill, filling] = useActionState<LineupState, FormData>(
    autoFill, {});
  const message = state.error ?? fillState.error ?? state.ok ?? fillState.ok;
  const bad = Boolean(state.error ?? fillState.error);

  const openSlots = new Map<Slot, number>(
    settings.starters.map(({ slot, count }) => [
      slot, count - startable.filter((s) => s.slot === slot).length,
    ]),
  );

  return (
    <>
      <div className="controls">
        <form action={submitFill}>
          <input type="hidden" name="day" value={day} />
          <button type="submit" disabled={filling}>
            {filling ? "Filling…" : "Auto-fill"}
          </button>
        </form>
        {START_ORDER.map((slot) => {
          const open = openSlots.get(slot);
          if (open === undefined) return null;
          return (
            <span key={slot} className="tag">
              {slot} {open > 0 ? `${open} open` : "full"}
            </span>
          );
        })}
      </div>

      <div role="status" aria-live="polite">
        {message ? <p className={`notice ${bad ? "bad" : "good"}`}>{message}</p> : null}
      </div>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Tip-off <span className="faint">ET</span></th>
              <th scope="col">Opponent</th>
              <th scope="col" className="r">Proj</th>
              <th scope="col">Slot</th>
            </tr>
          </thead>
          <tbody>
            {startable.map((player) => (
              <tr key={player.playerId}>
                <td>
                  <Link href={`/players/${player.playerId}`} className="player-link">
                    {player.name}
                  </Link>{" "}
                  <span className="tag">{player.archetype}</span>
                </td>
                <td className="num faint">
                  <Tipoff iso={player.tipoff} />
                </td>
                <td>
                  {player.opponent ?? "—"}
                  {player.opponentStrength !== null ? (
                    <span className="sub num">
                      strength {player.opponentStrength.toFixed(2)}
                    </span>
                  ) : null}
                </td>
                <td className="r num">{player.projected.toFixed(1)}</td>
                <td>
                  {player.locked ? (
                    <span
                      className="tag lock"
                      data-started={player.slot !== "BENCH" && player.slot !== "IR"}
                    >
                      {player.slot} · locked
                    </span>
                  ) : (
                    <form action={submitMove}>
                      <input type="hidden" name="day" value={day} />
                      <input type="hidden" name="playerId" value={player.playerId} />
                      <select
                        name="slot"
                        aria-label={`Slot for ${player.name}`}
                        defaultValue={player.slot}
                        disabled={moving}
                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                      >
                        {["BENCH", ...(eligible[player.playerId] ?? [])].map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
