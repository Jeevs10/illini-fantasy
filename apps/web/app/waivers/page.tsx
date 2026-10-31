import Link from "next/link";
import { activeLimit, claimsFor, playingOn, rosterOn, settleWaivers, waiverState, weeklyAdds } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Wire, type WireRow } from "./wire.tsx";
import { Avatar } from "../ui/identity.tsx";
import { Bar, Empty } from "../ui/bits.tsx";
import { Claims, type ClaimRow } from "./claims.tsx";
import { Roster } from "./roster.tsx";

export const dynamic = "force-dynamic";

/** Eastern, because the league is. The hour is the thing that matters. */
const WHEN = new Intl.DateTimeFormat("en-US", {
  weekday: "short", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York", timeZoneName: "short",
});

export default async function WaiversPage() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, fantasyTeamId, fantasyTeamName, settings } = viewer.membership;
  const now = viewNow();

  if (settings.weeklyAdds !== null) {
    return <AddDrop leagueId={leagueId} leagueName={leagueName} fantasyTeamId={fantasyTeamId}
                    fantasyTeamName={fantasyTeamName} now={now} />;
  }

  // Reading the page is what opens the bids. There is no worker: any manager
  // who loads this after a run resolves the batch that was due, at the time it
  // was due, and every later reader finds it already done.
  await settleWaivers(db, { leagueId, now });

  const [state, claims, roster] = await Promise.all([
    waiverState(db, { leagueId, now }),
    fantasyTeamId === null ? [] : claimsFor(db, { leagueId, fantasyTeamId }),
    fantasyTeamId === null ? [] : rosterOn(db, fantasyTeamId, viewDate()),
  ]);

  const mine = state.teams.find((t) => t.fantasyTeamId === fantasyTeamId);
  const wire: WireRow[] = state.wire.map((w) => ({
    ...w, clearsLabel: WHEN.format(new Date(w.clearsAt)),
  }));
  const rows: ClaimRow[] = claims.map((c) => ({
    ...c, runsLabel: WHEN.format(new Date(c.runsAt)),
  }));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Waivers</h1>
          <p className="meta">
            <span>{leagueName}</span>
            {mine ? <span className="tnum">${mine.remaining} of ${state.budget} left to bid</span> : null}
            <span>Bids open {WHEN.format(new Date(state.nextRunAt))}</span>
            {viewer.membership.settings.lineupMode === "everyone"
              ? <span>Once a week, at the lock — a player won plays that week</span> : null}
          </p>
        </div>
        <div className="controls">
          <Link className="button" href="/players?free=1">Free agents</Link>
          <Link className="button" href="/team">
            {viewer.membership.settings.lineupMode === "everyone" ? "Your team" : "Your lineup"}
          </Link>
        </div>
      </div>

      {fantasyTeamId === null ? (
        <div className="panel">
          <Empty title="No team here" glyph="team">
            You are a member of {leagueName} but do not run a team in it, so
            there is nothing to claim with.
          </Empty>
        </div>
      ) : null}

      <div className="tradegrid">
        <div className="tradegrid-main">
          <Wire
            players={wire}
            roster={roster.map((p) => ({ playerId: p.playerId, name: p.name }))}
            remaining={mine?.remaining ?? 0}
            full={roster.filter((p) => !p.reserve).length >= activeLimit(viewer.membership.settings)}
            canAct={fantasyTeamId !== null}
          />
          {fantasyTeamId === null ? null : (
            <Claims
              pending={rows.filter((c) => c.status === "pending")}
              settled={rows.filter((c) => c.status !== "pending" && c.status !== "cancelled")}
            />
          )}
        </div>

        <aside className="tradegrid-rail" aria-label="Budgets and your roster">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Budgets</h2>
              </div>
            </div>
            <table className="budgets">
              <caption className="sr-only">Each team&rsquo;s waiver budget, in priority order</caption>
              <thead>
                <tr>
                  <th scope="col" className="r">#</th>
                  <th scope="col">Team</th>
                  <th scope="col" className="r">Left</th>
                </tr>
              </thead>
              <tbody>
                {state.teams.map((team) => {
                  const yours = team.fantasyTeamId === fantasyTeamId;
                  return (
                    <tr key={team.fantasyTeamId} data-mine={yours || undefined}>
                      <td className="r tnum faint">{team.priority}</td>
                      <th scope="row">
                        <span className="budgets-team">
                          <Avatar name={team.teamName} seed={team.fantasyTeamId} size="xs" mine={yours} />
                          <span>{team.teamName}</span>
                        </span>
                        <Bar percent={(team.remaining / state.budget) * 100} thin
                             label={`$${team.remaining} of $${state.budget} left`} />
                      </th>
                      <td className="r tnum budgets-left">${team.remaining}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {fantasyTeamId === null ? null : (
            <Roster
              team={fantasyTeamName ?? "Your team"}
              players={roster.map((p) => ({
                playerId: p.playerId, name: p.name, teamName: p.teamName,
                acquiredVia: p.acquiredVia,
              }))}
            />
          )}
        </aside>
      </div>
    </>
  );
}

/**
 * The page in a league with weekly adds instead of waivers: how many adds are
 * left, and the roster to drop from. There is nothing to bid on — every
 * unowned player is on the free-agent list — so the adds happen there.
 */
async function AddDrop({
  leagueId, leagueName, fantasyTeamId, fantasyTeamName, now,
}: {
  leagueId: number; leagueName: string; fantasyTeamId: number | null; fantasyTeamName: string | null;
  now: Date;
}) {
  if (fantasyTeamId === null) {
    return (
      <div className="panel">
        <Empty title="No team here" glyph="team">
          You are a member of {leagueName} but do not run a team in it, so
          there is nothing to add or drop.
        </Empty>
      </div>
    );
  }
  const [adds, roster] = await Promise.all([
    weeklyAdds(db, { leagueId, fantasyTeamId, now }),
    rosterOn(db, fantasyTeamId, viewDate()),
  ]);
  const tonight = await playingOn(db, roster.map((p) => p.playerId), viewDate());
  const left = adds === null ? 0 : Math.max(0, adds.limit - adds.used);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Add / drop</h1>
          <p className="meta">
            <span>{leagueName}</span>
            {adds ? <span className="tnum">{left} of {adds.limit} adds left</span> : null}
          </p>
        </div>
        <div className="controls">
          <Link className={`button${left > 0 ? " primary" : ""}`} href="/players?free=1">Free agents</Link>
          <Link className="button" href="/team">Your team</Link>
        </div>
      </div>

      <div className="tradegrid">
        <div className="tradegrid-main">
          {adds ? (
            <div className="panel">
              <div className="panel-head">
                <h2>Adds this week</h2>
                <span className={`pill${left === 0 ? " warn" : ""}`}>{left} left</span>
              </div>
              <div className="panel-body">
                <Bar percent={(adds.used / adds.limit) * 100}
                     label={`${adds.used} of ${adds.limit} adds used this week`} />
                <p className="faint" style={{ marginTop: "var(--s-3)" }}>
                  {adds.used} of {adds.limit} used · resets {WHEN.format(new Date(adds.resetsAt))}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="tradegrid-rail" aria-label="Your roster">
          <Roster
            team={fantasyTeamName ?? "Your team"}
            addDrop
            players={roster.map((p) => ({
              playerId: p.playerId, name: p.name, teamName: p.teamName,
              acquiredVia: p.acquiredVia, playsTonight: tonight.has(p.playerId),
            }))}
          />
        </aside>
      </div>
    </>
  );
}
