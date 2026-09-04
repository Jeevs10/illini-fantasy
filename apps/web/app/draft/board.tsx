import Link from "next/link";
import type { DraftRoom } from "@illini/league";
import { RoleTag } from "../ui/bits.tsx";

/**
 * The board: rounds down, teams across, snake order left to right.
 *
 * A list of picks in order would be easier to build and would answer the wrong
 * question. What a manager wants from a draft board is positional — who has
 * taken what, and how long until the turn comes back — and that is a shape, not
 * a sequence.
 */
export function Board({ room, yourTeamId }: { room: DraftRoom; yourTeamId: number | null }) {
  const { draft, board, order, onTheClock } = room;
  const byOverall = new Map(board.map((p) => [p.overall, p]));
  const rounds = Array.from({ length: draft.rounds }, (_, i) => i + 1);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>The board</h2>
        <p>
          Order drawn at random, then reversed every round. {order.length} teams,
          {" "}{draft.rounds} rounds.
        </p>
      </div>
      <div className="scroll">
        <table className="board">
          <caption className="sr-only">Every pick in the draft, by round and team</caption>
          <thead>
            <tr>
              <th scope="col" className="board-round">Rd</th>
              {order.map((team) => (
                <th key={team.fantasyTeamId} scope="col" data-mine={team.fantasyTeamId === yourTeamId}>
                  {team.teamName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => (
              <tr key={round}>
                <th scope="row" className="board-round num">{round}</th>
                {order.map((team) => {
                  // The snake means a team's column position is not its pick
                  // position in even rounds — read the board by team, not by
                  // arithmetic.
                  const overall = round % 2 === 1
                    ? (round - 1) * order.length + team.position
                    : round * order.length - team.position + 1;
                  const cell = byOverall.get(overall);
                  const current = onTheClock?.overall === overall;
                  return (
                    <td
                      key={team.fantasyTeamId}
                      data-mine={team.fantasyTeamId === yourTeamId}
                      data-current={current}
                      data-made={cell?.playerId !== null && cell !== undefined}
                    >
                      <span className="board-num num">{overall}</span>
                      {cell?.playerId !== null && cell !== undefined ? (
                        <>
                          <span className="row" style={{ gap: "var(--s-1)", flexWrap: "nowrap" }}>
                            <Link href={`/players/${cell.playerId}`} className="player-link">
                              {cell.playerName}
                            </Link>
                            <RoleTag role={cell.role} />
                          </span>
                          <span className="sub">
                            {cell.school ?? "—"}
                            {cell.auto ? " · auto" : ""}
                          </span>
                        </>
                      ) : current ? (
                        <span className="board-clock">On the clock</span>
                      ) : (
                        <span className="faint">&mdash;</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
