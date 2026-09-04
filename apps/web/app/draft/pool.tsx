"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { PoolPlayer, PositionRole } from "@illini/league";
import { pick, queuePlayer, type DraftState } from "./actions.ts";
import { Empty, RoleTag } from "../ui/bits.tsx";

const ROLES: PositionRole[] = ["G", "F", "B"];

/**
 * Best available, with the two things you can do about it.
 *
 * Drafting is one list and two verbs: take him now, or write him down for
 * later. Both are on every row because which one a manager wants depends on
 * whether it is their turn, and that changes every ninety seconds.
 */
export function Pool({
  players, queued, yourTurn, canPick, search, role, roleHref,
}: {
  players: PoolPlayer[];
  queued: Set<number>;
  yourTurn: boolean;
  canPick: boolean;
  search: string;
  /** The active role filter, or null for every role. */
  role: PositionRole | null;
  roleHref: (role: PositionRole | null) => string;
}) {
  const [picked, submitPick, picking] = useActionState<DraftState, FormData>(pick, {});
  const [enqueued, submitQueue] = useActionState<DraftState, FormData>(queuePlayer, {});

  // Whichever happened last. Two banners saying different things about the same
  // player is worse than one saying the latest.
  const latest = (enqueued.at ?? 0) > (picked.at ?? 0) ? enqueued : picked;
  const message = latest.error ?? latest.ok;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Best available</h2>
        {yourTurn
          ? <span className="pill live">Your pick</span>
          : <span className="pill">{players.length} shown</span>}
      </div>

      <div className="panel-body">
        <form className="controls" action="/draft">
          <input type="search" name="q" defaultValue={search} placeholder="Search a name" />
          {role ? <input type="hidden" name="role" value={role} /> : null}
          <button type="submit">Search</button>
          {search ? <Link className="button" href={roleHref(role)}>Clear</Link> : null}
        </form>

        <nav className="segmented" aria-label="Role" style={{ marginTop: "var(--s-2)" }}>
          <Link href={roleHref(null)} data-active={!role}>All</Link>
          {ROLES.map((r) => (
            <Link key={r} href={roleHref(r)} data-active={role === r}>{r}</Link>
          ))}
        </nav>

        <div role="status" aria-live="polite">
          {message ? (
            <p className={`notice ${latest.error ? "bad" : "good"}`} style={{ marginTop: "var(--s-4)" }}>
              {message}
            </p>
          ) : null}
        </div>
      </div>

      {players.length === 0 ? (
        <Empty title="Nobody left to show" glyph="search">
          {search
            ? `No undrafted player matches “${search}”.`
            : "Every scored player in the pool has been drafted."}
        </Empty>
      ) : (
        <div className="scroll draftpool">
          <table>
            <caption className="sr-only">Undrafted players, best season Player-Score first</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col" className="draft-school">School</th>
                <th scope="col" className="r">Avg</th>
                <th scope="col">Take</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.playerId}>
                  <td>
                    <Link href={`/players/${player.playerId}`} className="player-link">
                      {player.name}
                    </Link>
                    <span style={{ marginLeft: "var(--s-2)" }}><RoleTag role={player.role} /></span>
                    <span className="sub draft-school-inline">
                      {player.teamName ?? "—"}
                      {player.conference ? ` · ${player.conference}` : ""}
                    </span>
                  </td>
                  <td className="draft-school">
                    {player.teamName ?? "—"}
                    {player.conference ? <span className="sub">{player.conference}</span> : null}
                  </td>
                  <td className="r num">{player.averageScore.toFixed(1)}</td>
                  <td>
                    <div className="rowactions">
                      <form action={submitPick}>
                        <input type="hidden" name="playerId" value={player.playerId} />
                        <button
                          type="submit"
                          className={yourTurn ? "primary" : undefined}
                          disabled={!canPick || !yourTurn || picking}
                          // Disabled controls say nothing to a screen reader
                          // about why, and "why" is the whole state of the page.
                          title={yourTurn ? `Draft ${player.name}` : "Not your pick yet"}
                        >
                          Draft
                        </button>
                      </form>
                      <form action={submitQueue}>
                        <input type="hidden" name="playerId" value={player.playerId} />
                        <input type="hidden" name="name" value={player.name} />
                        <button type="submit" disabled={!canPick || queued.has(player.playerId)}>
                          {queued.has(player.playerId) ? "Queued" : "Queue"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
