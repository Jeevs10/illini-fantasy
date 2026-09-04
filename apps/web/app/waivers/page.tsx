import Link from "next/link";
import { claimsFor, rosterLimit, rosterOn, settleWaivers, waiverState } from "@illini/league";
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
  const { leagueId, leagueName, fantasyTeamId, fantasyTeamName } = viewer.membership;
  const now = viewNow();

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
            <span>Bids open {WHEN.format(new Date(state.nextRunAt))}</span>
          </p>
        </div>
        {mine ? (
          <div className="budget">
            <div>
              <div className="eyebrow">Budget left</div>
              <div className="score score-md" style={{ color: "var(--accent)" }}>
                ${mine.remaining}
              </div>
            </div>
            <div style={{ minWidth: "9rem" }}>
              <Bar percent={(mine.spent / state.budget) * 100}
                   label={`$${mine.spent} of $${state.budget} spent`} thick />
              <div className="faint" style={{ fontSize: "var(--t-xs)", marginTop: 4 }}>
                ${mine.spent} spent of ${state.budget}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {fantasyTeamId === null ? (
        <div className="panel">
          <Empty title="No team here" glyph="team">
            You are a member of {leagueName} but do not run a team in it, so
            there is nothing to claim with.
          </Empty>
        </div>
      ) : null}

      <Wire
        players={wire}
        roster={roster.map((p) => ({ playerId: p.playerId, name: p.name }))}
        remaining={mine?.remaining ?? 0}
        full={roster.length >= rosterLimit(viewer.membership.settings)}
        canAct={fantasyTeamId !== null}
      />

      {fantasyTeamId === null ? null : (
        <>
          <Claims
            pending={rows.filter((c) => c.status === "pending")}
            settled={rows.filter((c) => c.status !== "pending" && c.status !== "cancelled")}
          />
          <Roster
            team={fantasyTeamName ?? "Your team"}
            players={roster.map((p) => ({
              playerId: p.playerId, name: p.name, teamName: p.teamName,
              acquiredVia: p.acquiredVia,
            }))}
          />
        </>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Budgets</h2>
            <p>Priority is the tiebreak, not the rule.</p>
          </div>
          <span className="pill ghost">Priority order</span>
        </div>
        {state.teams.map((team) => (
          <div className="plr" key={team.fantasyTeamId} data-mine={team.fantasyTeamId === fantasyTeamId || undefined}>
            <span className="plr-lead">
              <span className="faint tnum" style={{ width: "1.5ch", textAlign: "right", fontSize: "var(--t-sm)" }}>
                {team.priority}
              </span>
              <Avatar name={team.teamName} seed={team.fantasyTeamId} size="sm"
                      mine={team.fantasyTeamId === fantasyTeamId} />
            </span>
            <span className="plr-id">
              <span className="plr-name">{team.teamName}</span>
              <span className="plr-sub" style={{ display: "grid", gap: 3, maxWidth: "14rem" }}>
                <Bar percent={(team.spent / state.budget) * 100} thin
                     label={`$${team.spent} of $${state.budget} spent`} />
                <span>${team.spent} spent</span>
              </span>
            </span>
            <span className="plr-right">
              <span className="score score-xs">${team.remaining}</span>
            </span>
          </div>
        ))}
        <p className="seatless">
          The higher bid wins, and priority only decides equal ones. A team that
          wins a tie goes to the back of the line, so the same coin never lands
          the same way all season.
        </p>
      </div>

      <div className="controls">
        <Link className="button" href="/players?free=1">Free agents</Link>
        <Link className="button" href="/team">Your lineup</Link>
      </div>
    </>
  );
}
