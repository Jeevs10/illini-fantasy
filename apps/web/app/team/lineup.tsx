"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { GameState, LeagueSettings, Slot, Startable } from "@illini/league";
import { autoFill, moveToSlot, type LineupState } from "./actions.ts";
import { RoleTag, Score } from "../ui/bits.tsx";

/**
 * Tip-off, always in Eastern.
 *
 * Not the viewer's timezone: formatting from the browser's zone means the
 * server renders one string and the client another, which is a hydration
 * mismatch and — as it turned out — a column that silently flipped to UTC on a
 * client-side navigation. College tip-offs are published in Eastern anyway.
 */
const ET = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
});
const time = (iso: string | null) => (iso === null ? "—" : ET.format(new Date(iso)));

/** A player, plus what his night is doing. Resolved on the server. */
export interface LineupPlayer extends Startable {
  score: number | null;
  state: GameState;
}

interface SlotRow { key: string; slot: Slot; player: LineupPlayer | null }

/**
 * The starting lineup as positions, not as a player list.
 *
 * The roster is what a manager owns; the lineup is what they set. Rendering the
 * roster sorted by projection with the slot in a column makes an unfilled
 * position invisible — the one thing they came to the page to check.
 */
function buildSlots(startable: LineupPlayer[], settings: LeagueSettings): SlotRow[] {
  const pool = [...startable];
  const rows: SlotRow[] = [];
  for (const { slot, count } of settings.starters) {
    for (let i = 0; i < count; i += 1) {
      const index = pool.findIndex((p) => p.slot === slot);
      rows.push({ key: `${slot}-${i}`, slot, player: index < 0 ? null : pool.splice(index, 1)[0]! });
    }
  }
  return rows;
}

export function Lineup({
  day, startable, settings, eligible,
}: {
  day: string;
  startable: LineupPlayer[];
  settings: LeagueSettings;
  /** Slots each player may take, resolved on the server from their archetype. */
  eligible: Record<number, Slot[]>;
}) {
  const [state, submitMove, moving] = useActionState<LineupState, FormData>(moveToSlot, {});
  const [fillState, submitFill, filling] = useActionState<LineupState, FormData>(autoFill, {});
  // Whichever answer is the more recent. A move refused a moment before an
  // auto-fill succeeded would otherwise leave its complaint on the screen
  // above a lineup it no longer describes.
  const latest = (fillState.at ?? 0) > (state.at ?? 0) ? fillState : state;
  const message = latest.error ?? latest.ok;
  const bad = Boolean(latest.error);

  const slots = buildSlots(startable, settings);
  const started = new Set(slots.map((r) => r.player?.playerId).filter(Boolean));
  const bench = startable
    .filter((p) => !started.has(p.playerId))
    .sort((a, b) => (a.tipoff ?? "~").localeCompare(b.tipoff ?? "~"));

  const open = slots.filter((r) => r.player === null).length;
  const everyoneLocked = startable.every((p) => p.locked);
  const missed = bench.filter((p) => p.locked && p.state !== "upcoming");
  const missedPoints = missed.reduce((a, p) => a + (p.score ?? p.projected), 0);

  return (
    <>
      <div className="subhead">
        <div className="row" style={{ gap: "var(--s-2)" }}>
          <form action={submitFill}>
            <input type="hidden" name="day" value={day} />
            <button type="submit" disabled={filling || everyoneLocked} className={open > 0 ? "primary" : ""}>
              {filling ? "Filling…" : "Auto-fill"}
            </button>
          </form>
          {open > 0
            ? <span className="pill warn">{open} slot{open === 1 ? "" : "s"} unfilled</span>
            : <span className="pill live">Lineup set</span>}
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? <div style={{ padding: "var(--s-3) var(--s-4) 0" }}><p className={`notice ${bad ? "bad" : "good"}`}>{message}</p></div> : null}
      </div>

      <div className="lineup">
        <div className="lineup-head" aria-hidden="true">
          <span>Slot</span><span>Player</span><span>Opponent</span><span>Tip-off ET</span><span className="r">Score</span><span>Move</span>
        </div>
        {slots.map((row) => (
          row.player === null ? (
            <EmptyRow
              key={row.key} slot={row.slot} day={day}
              bench={bench.filter((p) => !p.locked && (eligible[p.playerId] ?? []).includes(row.slot))}
              submit={submitMove} busy={moving}
            />
          ) : (
            <Row
              key={row.key} player={row.player} slot={row.slot} day={day}
              eligible={eligible[row.player.playerId] ?? []}
              submit={submitMove} busy={moving} revision={latest.at ?? 0}
            />
          )
        ))}
      </div>

      <div className="subhead">
        <h3>Bench — {bench.length}</h3>
        {missed.length > 0 ? (
          <span className="pill crit">{missedPoints.toFixed(1)} left on the bench</span>
        ) : null}
      </div>
      {bench.length === 0 ? (
        <p className="seatless">Everyone with a game tonight is starting.</p>
      ) : (
        <div className="lineup">
          {bench.map((player) => (
            <Row
              key={player.playerId} player={player} slot="BENCH" day={day}
              eligible={eligible[player.playerId] ?? []}
              submit={submitMove} busy={moving} onBench revision={latest.at ?? 0}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Row({
  player, slot, day, eligible, submit, busy, revision, onBench = false,
}: {
  player: LineupPlayer; slot: Slot; day: string; eligible: Slot[];
  submit: (formData: FormData) => void; busy: boolean;
  /** Bumped on every answer, so a refused move snaps the control back. */
  revision: number;
  onBench?: boolean;
}) {
  // A locked starter is the good outcome. A locked bench player is the loss —
  // those points are gone — so that is where the alarm belongs.
  const rowState = player.state === "live" && !onBench ? "live"
    : onBench && player.locked ? "missed"
    : undefined;

  return (
    <div className="lineup-row" data-state={rowState}>
      <span className="slot" data-slot={onBench ? "BENCH" : slot}>{onBench ? "BN" : slot}</span>

      <span className="plr-id">
        <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
          <Link href={`/players/${player.playerId}`} className="plr-name">{player.name}</Link>
          <RoleTag role={player.role} />
          {player.state === "live" ? <span className="pill live"><span className="livedot" />Live</span> : null}
        </span>
        <span className="lineup-mobilemeta">
          <span>{time(player.tipoff)} ET</span>
          <span className="dot" />
          <span>{player.opponent ?? "TBD"}</span>
        </span>
      </span>

      <span className="lineup-when">
        <span className="op">{player.opponent ?? "—"}</span>
        {player.opponentStrength !== null ? (
          <span className="st">strength {player.opponentStrength.toFixed(2)}</span>
        ) : null}
      </span>

      <span className="lineup-when">
        <span className="num" style={{ fontSize: "var(--t-sm)" }}>
          {player.tipoff ? <time dateTime={player.tipoff}>{time(player.tipoff)}</time> : "—"}
        </span>
        <span className="st">{player.state === "final" ? "final" : player.state === "live" ? "under way" : "ET"}</span>
      </span>

      <span className="lineup-proj">
        <Score
          value={player.score ?? player.projected}
          size="xs"
          tone={player.score === null ? "quiet" : player.state === "live" ? "live" : "default"}
        />
        <span className="cap" style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
          {player.score === null ? "proj" : "pts"}
        </span>
      </span>

      <span className="lineup-act">
        {player.locked ? (
          <span className={`pill${onBench ? " crit" : ""}`}>
            {onBench ? `Missed ${(player.score ?? player.projected).toFixed(1)}` : "Locked"}
          </span>
        ) : (
          <form action={submit}>
            <input type="hidden" name="day" value={day} />
            <input type="hidden" name="playerId" value={player.playerId} />
            <select
              key={`${player.slot}-${revision}`}
              name="slot"
              aria-label={`Move ${player.name}`}
              defaultValue={player.slot}
              disabled={busy}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="BENCH">Bench</option>
              {eligible.map((s) => <option key={s} value={s}>Start at {s}</option>)}
            </select>
          </form>
        )}
      </span>
    </div>
  );
}

function EmptyRow({
  slot, day, bench, submit, busy,
}: {
  slot: Slot; day: string; bench: LineupPlayer[];
  submit: (formData: FormData) => void; busy: boolean;
}) {
  return (
    <div className="lineup-row" data-state="empty">
      <span className="slot" data-slot={slot} data-empty="true">{slot}</span>
      <span className="plr-id" style={{ gridColumn: "2 / -2" }}>
        <span className="plr-name" style={{ color: "var(--warn)" }}>
          {bench.length === 0 ? `No eligible ${slot} available` : `Empty ${slot} — nobody is scoring here`}
        </span>
        <span className="plr-sub">
          {bench.length === 0
            ? "Nobody on the bench can take this slot tonight."
            : `${bench.length} eligible on the bench`}
        </span>
      </span>
      <span className="lineup-act">
        {bench.length === 0 ? <span className="pill">—</span> : (
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
      </span>
    </div>
  );
}
