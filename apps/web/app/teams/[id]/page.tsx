import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { availabilityFor, rankedStandings, rosterOn, teamsInLeague } from "@illini/league";
import { db } from "../../../lib/db.ts";
import { requireViewer, viewDate } from "../../../lib/session.ts";
import { Avatar } from "../../ui/identity.tsx";
import { AvailabilityTag, Empty } from "../../ui/bits.tsx";
import { Dot, PlayerRow } from "../../ui/playerrow.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireViewer();
  const team = (await teamsInLeague(db, viewer.membership.leagueId))
    .find((t) => t.id === Number(id));
  return { title: team ? `${team.name} · Illini Fantasy` : "Team · Illini Fantasy" };
}

/**
 * A team's roster, read-only, for anyone else in the league.
 *
 * Standings and the matchup screen name the other nine teams but never let a
 * manager see who is actually on one — in a league that exists to know your
 * opponent, that was a real gap. This is the same `rosterOn` the owner's own
 * `/team` page reads, minus the lineup controls only an owner can act on.
 */
export default async function TeamProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  const viewer = await requireViewer();
  const { leagueId, fantasyTeamId } = viewer.membership;

  const teams = await teamsInLeague(db, leagueId);
  const team = teams.find((t) => t.id === teamId);
  if (!team) notFound();

  const day = viewDate();
  const [roster, standings] = await Promise.all([
    rosterOn(db, teamId, day),
    rankedStandings(db, leagueId),
  ]);
  const availability = await availabilityFor(db, roster.map((p) => p.playerId));
  const seat = standings.find((r) => r.fantasyTeamId === teamId) ?? null;
  const mine = teamId === fantasyTeamId;

  return (
    <>
      <div className="pagehead">
        <div className="row" style={{ gap: "var(--s-4)", flexWrap: "nowrap", minWidth: 0 }}>
          <Avatar name={team.name} seed={team.id} size="xl" mine={mine} />
          <div style={{ minWidth: 0 }}>
            <h1>{team.name}{mine ? <span className="pill mine" style={{ marginLeft: "var(--s-3)" }}>You</span> : null}</h1>
            <p className="meta">
              <span>{team.ownerName ?? "No manager yet"}</span>
              {seat ? (
                <span>{seat.wins}&ndash;{seat.losses}{seat.ties ? `–${seat.ties}` : ""} · {ordinal(seat.rank)}</span>
              ) : null}
              <span>{roster.length} rostered</span>
            </p>
          </div>
        </div>
        <div className="controls">
          <Link className="button" href="/standings">Standings</Link>
          <Link className="button" href="/league">Matchups</Link>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Roster</h2>
          <span className="pill">{roster.length}</span>
        </div>
        {roster.length === 0 ? (
          <Empty title="Nobody rostered" glyph="team">
            This team has no players yet.
          </Empty>
        ) : (
          roster.map((player) => (
            <PlayerRow
              key={player.playerId}
              playerId={player.playerId}
              name={player.name}
              rail={player.primaryColor}
              meta={
                <>
                  <span>{player.teamName ?? "—"}</span>
                  {player.role ? <><Dot /><span>{player.role}</span></> : null}
                </>
              }
              right={
                <AvailabilityTag
                  status={availability.get(player.playerId)?.status}
                  injury={availability.get(player.playerId)?.injury}
                />
              }
            />
          ))
        )}
      </div>
    </>
  );
}

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? "th"}`;
