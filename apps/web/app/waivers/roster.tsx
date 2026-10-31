"use client";

import { useActionState } from "react";
import Link from "next/link";
import { drop, type WaiverActionState } from "./actions.ts";
import { Avatar } from "../ui/identity.tsx";
import { Dot } from "../ui/playerrow.tsx";
import { playerPath } from "../../lib/links.ts";

export interface RosterRow {
  playerId: number;
  name: string;
  teamName: string | null;
  acquiredVia: string;
  /** His school plays tonight, so he cannot be dropped until tomorrow. Only in an add/drop league. */
  playsTonight?: boolean;
}

/**
 * The roster, with the one verb that starts a waiver period.
 *
 * The drop lives here rather than only on the team page because a drop is half
 * of every transaction on this screen — a manager clearing room for a claim
 * should not have to leave the page where the claim is.
 */
export function Roster({ team, players, addDrop = false }: {
  team: string; players: RosterRow[];
  /** The league has weekly adds instead of waivers: a drop frees the player at once. */
  addDrop?: boolean;
}) {
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
        <p className="panel-body panel-empty">
          Nobody rostered, so nothing to drop yet. Free agents can be added outright.
        </p>
      ) : (
        players.map((player) => (
          <div className="plr" key={player.playerId}>
            <span className="plr-lead">
              <Avatar name={player.name} seed={player.playerId} size="sm" />
            </span>
            <span className="plr-id">
              <Link href={playerPath(player.playerId, player.name)} className="plr-name">{player.name}</Link>
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
                  type="submit" className="sm danger" disabled={pending || player.playsTonight}
                  // The consequence, said before the click rather than after it:
                  // a drop is not reversible by re-adding him.
                  title={player.playsTonight
                    ? `${player.name} plays tonight — he can be dropped tomorrow`
                    : addDrop
                      ? `Drop ${player.name} — he is a free agent at once, and anyone can add him`
                      : `Drop ${player.name} — he goes on waivers, and anyone can bid`}
                >
                  {player.playsTonight ? "Plays tonight" : "Drop"}
                </button>
              </form>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
