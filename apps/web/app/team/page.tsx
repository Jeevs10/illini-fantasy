import Link from "next/link";
import { eligibleSlots, rosterOn, startableOn, type Slot } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../lib/session.ts";
import { Lineup } from "./lineup.tsx";
import { DayStrip, label } from "./daystrip.tsx";
import { NextLock } from "./nextlock.tsx";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const viewer = await requireViewer();
  const { fantasyTeamId, fantasyTeamName, settings, configId, leagueName } = viewer.membership;
  const day = viewDate(date);
  const now = viewNow();
  const isToday = day === viewDate();

  if (fantasyTeamId === null) {
    return (
      <div className="panel">
        <h2>No team</h2>
        <p className="muted">You are a member of {leagueName} but do not run a team in it.</p>
      </div>
    );
  }

  const [startable, roster] = await Promise.all([
    startableOn(db, { fantasyTeamId, day, configId, now }),
    rosterOn(db, fantasyTeamId, day),
  ]);

  // Eligibility is resolved here rather than in the browser: it comes from the
  // archetype the scoring model assigned, so the two cannot disagree.
  const eligible: Record<number, Slot[]> = {};
  for (const player of startable) eligible[player.playerId] = eligibleSlots(player.archetype);

  const idle = roster.filter((p) => !startable.some((s) => s.playerId === p.playerId));

  // The earliest game not yet under way — the deadline the page is really about.
  const next = startable
    .filter((p) => !p.locked && p.tipoff !== null)
    .sort((a, b) => a.tipoff!.localeCompare(b.tipoff!))[0];

  return (
    <>
      <div className="pagehead">
        <h1>{fantasyTeamName}</h1>
        <p>
          <span>{leagueName}</span>
          <span>{roster.length} rostered</span>
          <span>{settings.starters.map((s) => `${s.count} ${s.slot}`).join(" · ")}</span>
        </p>
      </div>

      <DayStrip day={day} today={viewDate()} />

      <div className="panel">
        <div className="panel-head">
          <h2>{isToday ? "Tonight" : label(day)}</h2>
          {next ? (
            <NextLock
              iso={next.tipoff!}
              nowIso={now.toISOString()}
              label={new Intl.DateTimeFormat("en-US", {
                hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
              }).format(new Date(next.tipoff!))}
            />
          ) : startable.length > 0 ? (
            <span className="tag lock" data-missed="true">Every game has tipped off</span>
          ) : null}
        </div>
        {startable.length === 0 ? (
          <div className="empty">
            <h3>Nobody plays {isToday ? "tonight" : "that night"}</h3>
            <p>
              College schedules are uneven — most of a week&rsquo;s slate lands on
              Saturday, and a Thursday can be nearly empty for a roster of
              major-conference players. Try another night above.
            </p>
          </div>
        ) : (
          <div className="panel-body">
            <Lineup day={day} startable={startable} settings={settings} eligible={eligible} />
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Rest of the roster</h2>
          <span className="tag">{idle.length}</span>
        </div>
        {idle.length === 0 ? (
          <div className="empty"><p>Everyone on the roster has a game.</p></div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>School</th>
                  <th>Role</th>
                  <th>Acquired</th>
                </tr>
              </thead>
              <tbody>
                {idle.map((player) => (
                  <tr key={player.playerId}>
                    <td>
                      <Link href={`/players/${player.playerId}`} className="player-link">
                        {player.name}
                      </Link>
                    </td>
                    <td>{player.teamName ?? "—"}</td>
                    <td className="muted">{player.role ?? "—"}</td>
                    <td className="faint">
                      <span className="tag">{player.acquiredVia}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
