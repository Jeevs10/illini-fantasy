"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type {
  LeagueSettings, PeriodStarter, PlayerAvailability, Slot,
} from "@illini/league";
import { autoFill, moveToSlot, type LineupState } from "./actions.ts";
import { buildSlots } from "./slots.ts";
import { AvailabilityTag, RoleTag, Score } from "../ui/bits.tsx";

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
const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC",
});
const time = (iso: string | null) => (iso === null ? "—" : ET.format(new Date(iso)));
const dayOf = (ymd: string) => DAY.format(new Date(`${ymd}T00:00:00Z`));

/** A starter, plus the availability note the roster screens share. */
export interface LineupPlayer extends PeriodStarter {
  availability?: PlayerAvailability;
}

/**
 * A rostered player whose real team plays no game at all this week.
 *
 * He has no game, so no slot and no projection — but he is still on the roster,
 * and a manager scanning the bench for cover should find him there rather than
 * in a second list further down the page. Kept as its own type because he has
 * no `PeriodStarter` to stand on: there is nothing to be startable for, and
 * inventing a game would put him in the auto-fill's pool.
 */
export interface OffNightPlayer {
  playerId: number;
  name: string;
  role: string | null;
  teamName: string | null;
  primaryColor: string | null;
  availability?: PlayerAvailability;
  acquiredVia: string;
}

/**
 * A `<select>` disabled only while its own form is submitting.
 *
 * `useFormStatus` reads the nearest enclosing `<form>`, not a `busy` flag
 * shared across the whole lineup — so choosing a slot for one player no
 * longer greys out every other player's control while the request is in
 * flight, the way a single action-state pending flag threaded down as a prop
 * used to.
 */
function SlotSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { pending } = useFormStatus();
  return <select {...props} disabled={pending} />;
}

export function Lineup({
  from, to, startable, settings, eligible, offNight = [],
}: {
  from: string;
  to: string;
  startable: LineupPlayer[];
  settings: LeagueSettings;
  /** Slots each player may take, resolved on the server from their archetype. */
  eligible: Record<number, Slot[]>;
  /** Rostered players with no game this week — shown on the bench, scoring nothing. */
  offNight?: OffNightPlayer[];
}) {
  const [state, submitMove] = useActionState<LineupState, FormData>(moveToSlot, {});
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
    .sort((a, b) => b.projected - a.projected);

  const open = slots.filter((r) => r.player === null).length;
  const everyoneLocked = startable.every((p) => p.locked);
  // Points sitting on the bench that the week can still be losing — a benched
  // player who has already played is a decision that cost something, and one
  // who has not is a decision that still can.
  const missed = bench.filter((p) => p.projected > 0);
  const missedPoints = missed.reduce((a, p) => a + p.projected, 0);

  return (
    <>
      <div className="subhead">
        <div className="row" style={{ gap: "var(--s-2)" }}>
          <form action={submitFill}>
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <button type="submit" disabled={filling || everyoneLocked} className={open > 0 ? "primary" : ""}>
              {filling ? "Filling…" : "Auto-fill the week"}
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
          <span>Slot</span><span>Player</span><span>Games this week</span><span>Next</span><span className="r">Points</span><span>Move</span>
        </div>
        {slots.map((row) => (
          row.player === null ? (
            <EmptyRow
              key={row.key} slot={row.slot} from={from} to={to}
              bench={bench.filter((p) => !p.locked && (eligible[p.playerId] ?? []).includes(row.slot))}
              submit={submitMove}
            />
          ) : (
            <Row
              key={row.key} player={row.player} slot={row.slot} from={from} to={to}
              eligible={eligible[row.player.playerId] ?? []}
              submit={submitMove} revision={latest.at ?? 0}
            />
          )
        ))}
      </div>

      <div className="subhead">
        <h3>Bench — {bench.length + offNight.length}</h3>
        {missedPoints > 0 ? (
          <span className="pill crit">{missedPoints.toFixed(1)} projected on the bench</span>
        ) : null}
      </div>
      {bench.length + offNight.length === 0 ? (
        <p className="seatless">Everyone with a game this week is starting.</p>
      ) : (
        <div className="lineup">
          {bench.map((player) => (
            <Row
              key={player.playerId} player={player} slot="BENCH" from={from} to={to}
              eligible={eligible[player.playerId] ?? []}
              submit={submitMove} onBench revision={latest.at ?? 0}
            />
          ))}
          {/*
            * Below the players who could have started: same bench, but these
            * had no game to be started for. Ordering them last keeps the ones a
            * manager can still act on at the top.
            */}
          {offNight.map((player) => (
            <OffNightRow key={player.playerId} player={player} />
          ))}
        </div>
      )}
    </>
  );
}

function Row({
  player, slot, from, to, eligible, submit, revision, onBench = false,
}: {
  player: LineupPlayer; slot: Slot; from: string; to: string; eligible: Slot[];
  submit: (formData: FormData) => void;
  /** Bumped on every answer, so a refused move snaps the control back. */
  revision: number;
  onBench?: boolean;
}) {
  const played = player.games.filter((g) => g.score !== null).length;
  const next = player.games.find((g) => g.score === null) ?? null;
  const live = next !== null && next.tipoff !== null && new Date(next.tipoff) <= new Date();
  // A locked starter is the good outcome. A locked bench player is the loss —
  // whatever he scored this week is gone — so that is where the alarm belongs.
  const rowState = live && !onBench ? "live" : onBench && player.locked ? "missed" : undefined;

  return (
    <div
      className="lineup-row" data-state={rowState}
      data-rail={player.primaryColor ? true : undefined}
      style={player.primaryColor ? { ["--rail" as string]: player.primaryColor } : undefined}
    >
      <span className="slot" data-slot={onBench ? "BENCH" : slot}>{onBench ? "BN" : slot}</span>

      <span className="plr-id">
        <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
          <Link href={`/players/${player.playerId}`} className="plr-name">{player.name}</Link>
          <RoleTag role={player.role} />
          <AvailabilityTag status={player.availability?.status} injury={player.availability?.injury} compact />
        </span>
        <span className="lineup-mobilemeta">
          <span>{player.games.length} game{player.games.length === 1 ? "" : "s"}</span>
          <span className="dot" />
          <span>{played} played</span>
        </span>
      </span>

      {/* The week's slate, which is what a weekly lineup is picked against: a
        * player with three games is worth more than an equal one with one. */}
      <span className="lineup-when">
        <span className="op">
          {player.games.length} game{player.games.length === 1 ? "" : "s"}
          {played > 0 ? ` · ${played} in` : ""}
        </span>
        <span className="st">
          {player.games.map((g) => g.opponent ?? "TBD").join(", ") || "—"}
        </span>
      </span>

      <span className="lineup-when">
        <span className="num" style={{ fontSize: "var(--t-sm)" }}>
          {next === null ? "—" : dayOf(next.playedOn)}
        </span>
        <span className="st">
          {next === null ? "week done" : next.tipoff === null ? "TBD" : `${time(next.tipoff)} ET`}
        </span>
      </span>

      <span className="lineup-proj">
        <Score
          value={player.scored}
          size="xs"
          tone={played === 0 ? "quiet" : live ? "live" : "default"}
        />
        <span className="cap" style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
          {player.projected > player.scored + 0.05 ? `proj ${player.projected.toFixed(0)}` : "pts"}
        </span>
      </span>

      <span className="lineup-act">
        {player.locked ? (
          <span className={`pill${onBench ? " crit" : ""}`}>
            {onBench ? `Missed ${player.scored.toFixed(1)}` : "Locked"}
          </span>
        ) : (
          <form action={submit}>
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <input type="hidden" name="playerId" value={player.playerId} />
            <SlotSelect
              key={`${player.slot}-${revision}`}
              name="slot"
              aria-label={`Move ${player.name}`}
              defaultValue={player.slot}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="BENCH">Bench</option>
              {eligible.map((s) => <option key={s} value={s}>Start at {s}</option>)}
            </SlotSelect>
          </form>
        )}
      </span>
    </div>
  );
}

/**
 * A bench row for a player with no game this week.
 *
 * Deliberately the same row as everyone else's — same rail, same columns — so
 * the bench reads as one list. What differs is what the columns can honestly
 * say: no games, no next tip-off, and a score of 0.0, which is what he will
 * contribute. There is no move control because there is no move: a player
 * cannot be started into games his team is not playing.
 */
function OffNightRow({ player }: { player: OffNightPlayer }) {
  return (
    <div
      className="lineup-row" data-state="offnight"
      data-rail={player.primaryColor ? true : undefined}
      style={player.primaryColor ? { ["--rail" as string]: player.primaryColor } : undefined}
    >
      <span className="slot" data-slot="BENCH">BN</span>

      <span className="plr-id">
        <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
          <Link href={`/players/${player.playerId}`} className="plr-name">{player.name}</Link>
          <RoleTag role={player.role} />
          <AvailabilityTag status={player.availability?.status} injury={player.availability?.injury} compact />
        </span>
        <span className="lineup-mobilemeta">
          <span>{player.teamName ?? "—"}</span>
          <span className="dot" />
          <span>No games</span>
        </span>
      </span>

      <span className="lineup-when">
        <span className="op">No games</span>
        <span className="st">{player.teamName ?? "not scheduled"}</span>
      </span>

      <span className="lineup-when">
        <span className="num" style={{ fontSize: "var(--t-sm)" }}>—</span>
        <span className="st">idle week</span>
      </span>

      <span className="lineup-proj">
        <Score value={0} size="xs" tone="quiet" />
        <span className="cap" style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
          pts
        </span>
      </span>

      <span className="lineup-act">
        <span className="pill ghost">No games this week</span>
      </span>
    </div>
  );
}

function EmptyRow({
  slot, from, to, bench, submit,
}: {
  slot: Slot; from: string; to: string; bench: LineupPlayer[];
  submit: (formData: FormData) => void;
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
            ? "Nobody on the bench can take this slot this week."
            : `${bench.length} eligible on the bench`}
        </span>
      </span>
      <span className="lineup-act">
        {bench.length === 0 ? <span className="pill">—</span> : (
          <form action={submit}>
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <input type="hidden" name="slot" value={slot} />
            <SlotSelect
              name="playerId"
              aria-label={`Fill the ${slot} slot`}
              defaultValue=""
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="" disabled>Choose…</option>
              {bench.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name} · {p.games.length}g · {p.projected.toFixed(1)}
                </option>
              ))}
            </SlotSelect>
          </form>
        )}
      </span>
    </div>
  );
}
