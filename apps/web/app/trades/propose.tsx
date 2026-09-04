"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { TradeableTeam } from "@illini/league";
import { offer, type TradeActionState } from "./actions.ts";
import { Empty } from "../ui/bits.tsx";

/**
 * The offer form.
 *
 * Both rosters are on screen at once, side by side and checkable. A trade is
 * the one transaction where the interesting question is somebody else's roster,
 * and a form that makes you leave to go and look at it is a form that gets
 * abandoned.
 */
export function Propose({ mine, others }: { mine: TradeableTeam; others: TradeableTeam[] }) {
  const [state, submit, pending] = useActionState<TradeActionState, FormData>(offer, {});
  const [withId, setWith] = useState(others[0]?.fantasyTeamId ?? 0);
  const them = others.find((t) => t.fantasyTeamId === withId) ?? others[0];

  if (!them) {
    return (
      <div className="panel">
        <div className="panel-head"><h2>Propose a trade</h2></div>
        <Empty title="Nobody to trade with" glyph="trades"
               action={<Link className="button" href="/commissioner">Invite a manager</Link>}>
          This league has one team in it. Invite somebody first.
        </Empty>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Propose a trade</h2>
        <span className="pill">{mine.players.length} to offer</span>
      </div>

      <div role="status" aria-live="polite">
        {state.error ?? state.ok ? (
          <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
            <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
          </div>
        ) : null}
      </div>

      <form action={submit} className="panel-body tradeform">
        <label className="field">
          <span>Trade with</span>
          <select
            name="toTeamId"
            value={withId}
            onChange={(event) => setWith(Number(event.target.value))}
          >
            {others.map((team) => (
              <option key={team.fantasyTeamId} value={team.fantasyTeamId}>
                {team.teamName}{team.ownerName ? ` — ${team.ownerName}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="pickers">
          <fieldset className="picker">
            <legend>You give</legend>
            {mine.players.length === 0 ? (
              <p className="deal-nothing">Nobody on your roster yet.</p>
            ) : mine.players.map((player) => (
              <label key={player.playerId}>
                <input type="checkbox" name="give" value={player.playerId} />
                <span>
                  {player.name}
                  <span className="sub">{player.teamName ?? "—"}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="picker">
            <legend>You get</legend>
            {them.players.length === 0 ? (
              <p className="deal-nothing">{them.teamName} has nobody rostered.</p>
            ) : them.players.map((player) => (
              // Keyed by team as well, so switching the other side resets the
              // boxes rather than carrying a tick across to a different player.
              <label key={`${them.fantasyTeamId}-${player.playerId}`}>
                <input type="checkbox" name="get" value={player.playerId} />
                <span>
                  {player.name}
                  <span className="sub">{player.teamName ?? "—"}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <label className="field">
          <span>Why it is fair</span>
          <input
            type="text"
            name="message"
            maxLength={280}
            placeholder="You are two guards deep and I need one"
          />
        </label>

        <div className="controls">
          <button type="submit" className="primary" disabled={pending}>Send offer</button>
          <span className="deal-note">
            Nothing moves until they accept, and then not until the window closes.
          </span>
        </div>
      </form>
    </div>
  );
}
