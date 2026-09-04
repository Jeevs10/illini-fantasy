"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { QueuedPlayer } from "@illini/league";
import { moveQueued, unqueuePlayer, type DraftState } from "./actions.ts";
import { RoleTag } from "../ui/bits.tsx";

/**
 * The list the clock reads when you are not here.
 *
 * A queue is only worth building if a manager believes it will be used, so the
 * panel says outright what happens on a missed pick rather than leaving it to
 * be discovered the morning after.
 */
export function Queue({ players, clocked }: { players: QueuedPlayer[]; clocked: boolean }) {
  const [, submitMove] = useActionState<DraftState, FormData>(moveQueued, {});
  const [, submitRemove] = useActionState<DraftState, FormData>(unqueuePlayer, {});

  const live = players.filter((p) => p.available);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Your queue</h2>
        <span className="pill">{live.length}</span>
      </div>

      {players.length === 0 ? (
        <div className="empty">
          <h3>Nothing queued</h3>
          <p>
            {clocked
              ? "If your clock runs out, the draft takes the best available player who fills a slot you still need. Queue somebody to overrule that."
              : "There is no clock on this draft, so a queue is a shortlist rather than an instruction."}
          </p>
        </div>
      ) : (
        <>
          <ol className="queue">
            {players.map((player, i) => (
              <li key={player.playerId} data-taken={!player.available}>
                <span className="queue-rank num">{i + 1}</span>
                <span className="queue-who">
                  <span className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap" }}>
                    <Link href={`/players/${player.playerId}`} className="player-link">
                      {player.name}
                    </Link>
                    <RoleTag role={player.role} />
                  </span>
                  <span className="sub">
                    {player.teamName ?? "—"}
                    {` · ${player.averageScore.toFixed(1)} avg`}
                  </span>
                </span>
                {player.available ? (
                  <span className="queue-actions">
                    <form action={submitMove}>
                      <input type="hidden" name="playerId" value={player.playerId} />
                      <input type="hidden" name="direction" value="up" />
                      <button type="submit" aria-label={`Move ${player.name} up`} disabled={i === 0}>↑</button>
                    </form>
                    <form action={submitMove}>
                      <input type="hidden" name="playerId" value={player.playerId} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        aria-label={`Move ${player.name} down`}
                        disabled={i === players.length - 1}
                      >↓</button>
                    </form>
                    <form action={submitRemove}>
                      <input type="hidden" name="playerId" value={player.playerId} />
                      <button type="submit" aria-label={`Remove ${player.name} from your queue`}>×</button>
                    </form>
                  </span>
                ) : (
                  // Kept, not silently dropped: a manager should see that the
                  // player they wanted is gone, not just find him missing.
                  <span className="pill" data-missed="true">Taken</span>
                )}
              </li>
            ))}
          </ol>
          {clocked ? (
            <p className="seatless">
              Miss a pick and the clock takes the first of these still available.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
