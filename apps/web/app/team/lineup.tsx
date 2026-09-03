"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { LeagueSettings, Slot, Startable } from "@illini/league";
import { autoFill, moveToSlot, type LineupState } from "./actions.ts";

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

const time = (iso: string | null) => (iso === null ? "—" : ET.format(new Date(iso)));

/** One starting position: which slot, and who is in it. */
interface SlotRow {
  key: string;
  slot: Slot;
  player: Startable | null;
}

/**
 * Builds the starting lineup as positions, not as a player list.
 *
 * The roster is what a manager owns; the lineup is what they set. Rendering the
 * roster sorted by projection and putting the slot in a column makes an unfilled
 * position invisible — the one thing they came to the page to check.
 */
function buildSlots(startable: Startable[], settings: LeagueSettings): SlotRow[] {
  const pool = [...startable];
  const rows: SlotRow[] = [];
  for (const { slot, count } of settings.starters) {
    for (let i = 0; i < count; i += 1) {
      const index = pool.findIndex((p) => p.slot === slot);
      rows.push({
        key: `${slot}-${i}`,
        slot,
        player: index < 0 ? null : pool.splice(index, 1)[0]!,
      });
    }
  }
  return rows;
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
  const [state, submitMove, moving] = useActionState<LineupState, FormData>(moveToSlot, {});
  const [fillState, submitFill, filling] = useActionState<LineupState, FormData>(autoFill, {});
  const message = state.error ?? fillState.error ?? state.ok ?? fillState.ok;
  const bad = Boolean(state.error ?? fillState.error);

  const slots = buildSlots(startable, settings);
  const started = new Set(slots.map((r) => r.player?.playerId).filter(Boolean));
  const bench = startable
    .filter((p) => !started.has(p.playerId))
    .sort((a, b) => (a.tipoff ?? "").localeCompare(b.tipoff ?? ""));

  const open = slots.filter((r) => r.player === null).length;
  const everyoneLocked = startable.every((p) => p.locked);

  return (
    <>
      <div className="controls lineup-controls">
        <form action={submitFill}>
          <input type="hidden" name="day" value={day} />
          <button type="submit" disabled={filling || everyoneLocked}>
            {filling ? "Filling…" : "Auto-fill"}
          </button>
        </form>
        {open > 0
          ? <span className="tag warn-tag">{open} slot{open === 1 ? "" : "s"} unfilled</span>
          : <span className="tag live">Lineup set</span>}
      </div>

      <div role="status" aria-live="polite">
        {message ? <p className={`notice ${bad ? "bad" : "good"}`}>{message}</p> : null}
      </div>

      <table className="lineup">
        <caption className="sr-only">Starting lineup by position</caption>
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col">Player</th>
            <th scope="col">Tip-off <span className="faint">ET</span></th>
            <th scope="col">Opponent</th>
            <th scope="col" className="r">Proj</th>
            <th scope="col">Move</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((row) => (
            <tr key={row.key} data-empty={row.player === null}>
              <td><span className="tag slot">{row.slot}</span></td>
              {row.player === null ? (
                <EmptySlot
                  slot={row.slot}
                  day={day}
                  bench={bench.filter((p) => !p.locked && (eligible[p.playerId] ?? []).includes(row.slot))}
                  submit={submitMove}
                  busy={moving}
                />
              ) : (
                <PlayerCells
                  player={row.player}
                  day={day}
                  eligible={eligible[row.player.playerId] ?? []}
                  submit={submitMove}
                  busy={moving}
                />
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="bench-head">Bench — {bench.length}</h3>
      {bench.length === 0 ? (
        <p className="muted bench-empty">Everyone with a game tonight is starting.</p>
      ) : (
        <table className="lineup">
          <caption className="sr-only">Bench players with a game tonight</caption>
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Tip-off <span className="faint">ET</span></th>
              <th scope="col">Opponent</th>
              <th scope="col" className="r">Proj</th>
              <th scope="col">Move</th>
            </tr>
          </thead>
          <tbody>
            {bench.map((player) => (
              <tr key={player.playerId}>
                <PlayerCells
                  player={player}
                  day={day}
                  eligible={eligible[player.playerId] ?? []}
                  submit={submitMove}
                  busy={moving}
                  onBench
                />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function PlayerCells({
  player, day, eligible, submit, busy, onBench = false,
}: {
  player: Startable; day: string; eligible: Slot[];
  submit: (formData: FormData) => void; busy: boolean; onBench?: boolean;
}) {
  return (
    <>
      <td>
        <Link href={`/players/${player.playerId}`} className="player-link">{player.name}</Link>{" "}
        <span className="tag">{player.archetype}</span>
      </td>
      <td className="num faint">
        {player.tipoff ? <time dateTime={player.tipoff}>{time(player.tipoff)}</time> : "—"}
      </td>
      <td>
        {player.opponent ?? "—"}
        {player.opponentStrength !== null ? (
          <span className="sub num">strength {player.opponentStrength.toFixed(2)}</span>
        ) : null}
      </td>
      <td className="r num">{player.projected.toFixed(1)}</td>
      <td>
        {player.locked ? (
          // A locked starter is the good outcome. A locked bench player is the
          // loss — those points are gone — so that is where the alarm belongs.
          <span className="tag lock" data-missed={onBench}>
            {onBench ? `Missed ${player.projected.toFixed(1)}` : "Locked"}
          </span>
        ) : (
          <form action={submit}>
            <input type="hidden" name="day" value={day} />
            <input type="hidden" name="playerId" value={player.playerId} />
            <select
              name="slot"
              aria-label={`Move ${player.name}`}
              defaultValue={player.slot}
              disabled={busy}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="BENCH">Bench</option>
              {eligible.map((slot) => <option key={slot} value={slot}>Start at {slot}</option>)}
            </select>
          </form>
        )}
      </td>
    </>
  );
}

function EmptySlot({
  slot, day, bench, submit, busy,
}: {
  slot: Slot; day: string; bench: Startable[];
  submit: (formData: FormData) => void; busy: boolean;
}) {
  return (
    <>
      <td colSpan={4} className="muted">
        {bench.length === 0
          ? "Nobody eligible is available tonight"
          : "Empty — nobody is scoring here"}
      </td>
      <td>
        {bench.length === 0 ? <span className="tag">—</span> : (
          <form action={submit}>
            <input type="hidden" name="day" value={day} />
            <input type="hidden" name="slot" value={slot} />
            <select
              name="playerId"
              aria-label={`Fill the ${slot} slot`}
              defaultValue=""
              disabled={busy}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="" disabled>Choose…</option>
              {bench.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name} · {p.projected.toFixed(1)}
                </option>
              ))}
            </select>
          </form>
        )}
      </td>
    </>
  );
}
