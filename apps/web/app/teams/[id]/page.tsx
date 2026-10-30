import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { availabilityFor, draftFor, rankedStandings, rosterOn, teamsInLeague } from "@illini/league";
import { db } from "../../../lib/db.ts";
import { requireViewer, viewDate } from "../../../lib/session.ts";
import { Pennant } from "../../ui/rafters.tsx";
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

  const today = viewDate();
  // Drafted tenures begin on the draft's opening date; before then, show the
  // roster that will be held on it rather than an empty one.
  const draft = await draftFor(db, leagueId);
  const day = draft && draft.opensOn > today ? draft.opensOn : today;
  const [roster, standings] = await Promise.all([
    rosterOn(db, teamId, day),
    rankedStandings(db, leagueId),
  ]);
  const availability = await availabilityFor(db, roster.map((p) => p.playerId));
  const seat = standings.find((r) => r.fantasyTeamId === teamId) ?? null;
  const mine = teamId === fantasyTeamId;
  // Rank means nothing until a week settles; before then the banner hangs
  // unranked, the same as in the rafters.
  const settled = standings.some((r) => r.wins + r.losses + r.ties > 0);
  const scoring = roster.filter((p) => !p.reserve);
  const reserve = roster.filter((p) => p.reserve);
  const row = (player: (typeof roster)[number]) => (
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
  );

  return (
    <>
      <div className="pagehead teamhead">
        <div className="row" style={{ gap: "var(--s-5)", flexWrap: "nowrap", minWidth: 0, alignItems: "flex-start" }}>
          <Pennant settled={settled} team={{
            fantasyTeamId: team.id, name: team.name, rank: seat?.rank ?? 0, mine,
            wins: seat?.wins ?? 0, losses: seat?.losses ?? 0, ties: seat?.ties ?? 0,
            pointsFor: seat?.pointsFor ?? 0,
          }} />
          <div style={{ minWidth: 0, paddingTop: "var(--s-2)" }}>
            <h1>{team.name}{mine ? <span className="pill mine" style={{ marginLeft: "var(--s-3)" }}>You</span> : null}</h1>
            <p className="meta">
              <span>{team.ownerName ?? "No manager yet"}</span>
              {seat ? (
                <span className="tnum">
                  {seat.wins}&ndash;{seat.losses}{seat.ties ? `–${seat.ties}` : ""}
                  {settled ? `, ${ordinal(seat.rank)}` : ""}
                </span>
              ) : null}
              {settled && seat ? <span className="tnum">{seat.pointsFor.toFixed(1)} points for</span> : null}
              <span>{scoring.length} rostered{reserve.length ? `, ${reserve.length} on IR` : ""}</span>
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
        </div>
        {roster.length === 0 ? (
          <Empty title="Nobody rostered" glyph="team"
                 action={mine ? <Link className="button primary" href="/players?free=1">Browse free agents</Link> : undefined}>
            {mine ? "Your roster is empty until the draft, or until you add a free agent."
              : `${team.name} has no players yet. Rosters fill at the draft.`}
          </Empty>
        ) : (
          <>
            {scoring.map(row)}
            {reserve.length > 0 ? (
              <>
                <div className="subhead"><h3>Injured reserve</h3></div>
                {reserve.map(row)}
              </>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? "th"}`;
