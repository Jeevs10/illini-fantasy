"use client";

import { useActionState } from "react";
import Link from "next/link";
import { drop, type WaiverActionState } from "./actions.ts";
import { Avatar } from "../ui/identity.tsx";
import { Empty } from "../ui/bits.tsx";
import { Dot } from "../ui/playerrow.tsx";

export interface RosterRow {
  playerId: number;
  name: string;
  teamName: string | null;
  acquiredVia: string;
}

/**
 * The roster, with the one verb that starts a waiver period.
 *
 * The drop lives here rather than only on the team page because a drop is half
 * of every transaction on this screen — a manager clearing room for a claim
 * should not have to leave the page where the claim is.
 */
export function Roster({ team, players }: { team: string; players: RosterRow[] }) {
  const [state, submit, pending] = useActionState<WaiverActionState, FormData>(drop, {});

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{team}</h2>
        <span className="pill">{players.length} rostered</span>
      </div>

      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          </div>
        ) : null}
      </div>

      {players.length === 0 ? (
        <Empty title="Nobody rostered" glyph="team">
          Nothing to drop yet. Free agents can be added outright.
        </Empty>
      ) : (
        players.map((player) => (
          <div className="plr" key={player.playerId}>
            <span className="plr-lead">
              <Avatar name={player.name} seed={player.playerId} size="sm" />
            </span>
            <span className="plr-id">
              <Link href={`/players/${player.playerId}`} className="plr-name">{player.name}</Link>
              <span className="plr-sub">
                <span>{player.teamName ?? "—"}</span>
                <Dot />
                <span>{player.acquiredVia.replace("_", " ")}</span>
              </span>
            </span>
            <span className="plr-right">
              <form action={submit}>
                <input type="hidden" name="playerId" value={player.playerId} />
                <input type="hidden" name="name" value={player.name} />
                <button
                  type="submit" className="sm danger" disabled={pending}
                  // The consequence, said before the click rather than after it:
                  // a drop is not reversible by re-adding him.
                  title={`Drop ${player.name} — he goes on waivers, and anyone can bid`}
                >
                  Drop
                </button>
              </form>
            </span>
          </div>
        ))
      )}
      <p className="seatless">
        A dropped player goes on the wire until the next run, not back into the
        pool. Nobody can simply take him, including you.
      </p>
    </div>
  );
}
