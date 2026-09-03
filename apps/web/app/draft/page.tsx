import Link from "next/link";
import { draftQueue, draftReadiness, draftRoom, playerPool } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer } from "../../lib/session.ts";
import { Clock } from "./clock.tsx";
import { Pool } from "./pool.tsx";
import { Queue } from "./queue.tsx";
import { Board } from "./board.tsx";
import { SetUp, Controls } from "./controls.tsx";

export const dynamic = "force-dynamic";

/** How much of the board to offer at once. Deeper than any single round needs. */
const POOL = 60;

export default async function DraftPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const viewer = await requireViewer();
  const { leagueId, leagueName, season, configId, fantasyTeamId, fantasyTeamName, role } =
    viewer.membership;
  const commissioner = role === "commissioner";

  // The wall clock, deliberately — not `viewNow`. A pinned demo clock would
  // mean no deadline ever passes and no autopick is ever made, which is exactly
  // the inert-looking app the date pin was invented to avoid.
  const now = new Date();

  // Reading the room is what settles the clock: any open tab makes the picks
  // that were due. There is no daemon, and this is why one is not needed.
  const room = await draftRoom(db, { leagueId, fantasyTeamId, now });

  if (!room) {
    const readiness = commissioner ? await draftReadiness(db, leagueId) : null;
    return (
      <>
        <div className="pagehead">
          <h1>Draft</h1>
          <p><span>{leagueName}</span><span>{season - 1}&ndash;{String(season).slice(2)}</span></p>
        </div>
        {readiness ? <SetUp readiness={readiness} /> : (
          <div className="panel"><div className="empty">
            <h3>The draft has not been set up</h3>
            <p>
              Whoever runs {leagueName} draws the order and starts the clock. Build
              a queue in the meantime and the clock will draft from it if you are
              not here.
            </p>
            <div className="controls"><Link className="button" href="/players">Browse the pool</Link></div>
          </div></div>
        )}
      </>
    );
  }

  const { draft } = room;
  const done = draft.status === "complete";

  const [available, queue] = await Promise.all([
    done ? Promise.resolve([]) : playerPool(db, {
      leagueId, season, configId, limit: POOL, availableOnly: true, search: q,
    }),
    fantasyTeamId === null ? Promise.resolve([]) : draftQueue(db, { leagueId, fantasyTeamId }),
  ]);
  const queued = new Set(queue.map((p) => p.playerId));

  return (
    <>
      <div className="pagehead">
        <h1>Draft</h1>
        <p>
          <span>{leagueName}</span>
          <span>{draft.rounds} rounds &middot; {draft.teams} teams</span>
          <span>{room.picksMade} of {draft.totalPicks} picks</span>
          {fantasyTeamName ? <span>You run {fantasyTeamName}</span> : null}
        </p>
      </div>

      <Clock
        status={draft.status}
        onTheClock={room.onTheClock}
        secondsLeft={room.secondsLeft}
        deadline={draft.deadline}
        nowIso={now.toISOString()}
        yourTurn={room.yourTurn}
        yourNextPick={room.yourNextPick}
        picksMade={room.picksMade}
        totalPicks={draft.totalPicks}
      />

      {commissioner ? <Controls status={draft.status} pickSeconds={draft.pickSeconds} /> : null}

      {done ? null : (
        <div className="draftgrid">
          <Pool
            players={available}
            queued={queued}
            yourTurn={room.yourTurn}
            canPick={fantasyTeamId !== null}
            search={q ?? ""}
          />
          <Queue players={queue} clocked={draft.pickSeconds > 0} />
        </div>
      )}

      <Board room={room} yourTeamId={fantasyTeamId} />
    </>
  );
}
