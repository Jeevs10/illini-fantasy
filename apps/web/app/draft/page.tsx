import Link from "next/link";
import {
  draftQueue, draftReadiness, draftRoom, playerPool, type PositionRole,
} from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate } from "../../lib/session.ts";
import { Clock } from "./clock.tsx";
import { Pool } from "./pool.tsx";
import { Queue } from "./queue.tsx";
import { Board } from "./board.tsx";
import { SetUp, Controls } from "./controls.tsx";
import { Empty } from "../ui/bits.tsx";

export const dynamic = "force-dynamic";

/** How much of the board to offer at once. Deeper than any single round needs. */
const POOL = 60;
const ROLES: PositionRole[] = ["G", "F", "B"];

export default async function DraftPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const { q, role: roleParam } = await searchParams;
  const roleFilter = ROLES.includes(roleParam as PositionRole) ? (roleParam as PositionRole) : null;
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
          <p className="meta"><span>{leagueName}</span><span>{season - 1}&ndash;{String(season).slice(2)}</span></p>
        </div>
        {readiness ? <SetUp readiness={readiness} /> : (
          <div className="panel">
            <Empty title="The draft has not been set up" glyph="draft"
                   action={<Link className="button" href="/players">Browse the pool</Link>}>
              Whoever runs {leagueName} draws the order and starts the clock.
              Build a queue in the meantime and the clock will draft from it if
              you are not here.
            </Empty>
          </div>
        )}
      </>
    );
  }

  const { draft } = room;
  const done = draft.status === "complete";

  const [available, queue] = await Promise.all([
    done ? Promise.resolve([]) : playerPool(db, {
      leagueId, season, configId, limit: POOL, availableOnly: true, search: q,
      roles: roleFilter ? [roleFilter] : undefined, asOf: viewDate(),
    }),
    fantasyTeamId === null ? Promise.resolve([]) : draftQueue(db, { leagueId, fantasyTeamId }),
  ]);
  const queued = new Set(queue.map((p) => p.playerId));

  const query = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, role: roleParam, ...over })) {
      if (value) params.set(key, value);
    }
    const s = params.toString();
    return s ? `/draft?${s}` : "/draft";
  };

  return (
    <>
      <div className="pagehead">
        <h1>Draft</h1>
        <p className="meta">
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
            role={roleFilter}
            roleLinks={{
              all: query({ role: undefined }), G: query({ role: "G" }),
              F: query({ role: "F" }), B: query({ role: "B" }),
            }}
            clearSearchHref={query({ q: undefined })}
          />
          <Queue players={queue} clocked={draft.pickSeconds > 0} />
        </div>
      )}

      <Board room={room} yourTeamId={fantasyTeamId} />
    </>
  );
}
