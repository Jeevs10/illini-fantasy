import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { schoolView } from "@illini/league";
import { db } from "../../../lib/db.ts";
import { requireViewer, viewDate } from "../../../lib/session.ts";
import { dataTeamUrl, playerPath, schoolPath } from "../../../lib/links.ts";
import { Avatar } from "../../ui/identity.tsx";
import { Glyph } from "../../ui/glyphs.tsx";
import { Empty, ET, RoleTag } from "../../ui/bits.tsx";
import { RangeStrip } from "../../ui/charts.tsx";

export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const viewer = await requireViewer();
  const { leagueId, season, configId } = viewer.membership;
  const view = await schoolView(db, { slug, leagueId, season, configId, from: viewDate(), games: 0 });
  return { title: view ? `${view.school.name} · Illini Fantasy` : "School · Illini Fantasy" };
}

/**
 * One school, as a fantasy manager reads it: who it has worth rostering, who
 * in this league already has them, and how its schedule stacks up — a school
 * with four games this week is worth more than the same roster with two.
 */
export default async function SchoolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireViewer();
  const { leagueId, season, configId, fantasyTeamId } = viewer.membership;
  const view = await schoolView(db, { slug, leagueId, season, configId, from: viewDate() });
  if (!view) notFound();

  const { school, players, upcoming, top } = view;
  const rostered = players.filter((p) => p.ownedBy !== null).length;
  const banked = players.some((p) => p.games > 0);

  return (
    <>
      <div className="pagehead">
        <div className="row" style={{ gap: "var(--s-4)", flexWrap: "nowrap", minWidth: 0 }}>
          {/* The school's own banner: its colour as the felt, its initials in
              the varsity block. */}
          <span className="schoolmark" aria-hidden="true"
                style={school.primaryColor ? { ["--school" as string]: school.primaryColor } : undefined}>
            {initials(school.name)}
          </span>
          <div style={{ minWidth: 0 }}>
            <h1>{school.name}</h1>
            <p className="meta">
              {school.conference ? <span>{school.conference}</span> : null}
              <span>{players.length} projected</span>
              <span>{rostered} rostered in this league</span>
            </p>
          </div>
        </div>
        <div className="controls">
          {school.forwardSlug ? (
            <a className="button" href={dataTeamUrl(school.forwardSlug)} target="_blank" rel="noopener">
              Prospect Analyzer <Glyph name="external" size={14} />
            </a>
          ) : null}
          <Link className="button" href="/players">All players</Link>
        </div>
      </div>

      {upcoming.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Next games</h2>
              <p>What the school&rsquo;s projected players add up to in each.</p>
            </div>
          </div>
          <div className="schoolgames">
            {upcoming.map((g) => (
              <div className="schoolgame" key={`${g.playedOn}-${g.opponent}`}>
                <span className="when">
                  {day(g.playedOn)}{g.tipoff ? <> · <ET iso={g.tipoff} /></> : null}
                </span>
                <span className="opp">
                  <span className="faint">{g.site === "away" ? "at " : "vs "}</span>
                  {g.opponentSlug && g.opponent
                    ? <Link href={schoolPath(g.opponentSlug)}>{g.opponent}</Link>
                    : g.opponent ?? "TBD"}
                </span>
                <span className="proj tnum">
                  {g.projected.toFixed(1)} proj{g.owned > 0 ? ` · ${g.owned} rostered` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Roster</h2>
            <p>Ordered by projected Player Score. The bar runs from zero to the best projection in the pool.</p>
          </div>
        </div>
        {players.length === 0 ? (
          <Empty title="Nobody projected" glyph="players">
            The forward model has no one at {school.name} on a 2026&ndash;27 roster.
          </Empty>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th style={{ minWidth: "9rem" }}>Projection</th>
                  <th className="r">Score</th>
                  <th className="r">Season</th>
                  {banked ? <th className="r">Scored</th> : null}
                  <th className="r">Status</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.playerId} data-mine={p.ownedBy?.fantasyTeamId === fantasyTeamId || undefined}>
                    <td>
                      <span className="row" style={{ gap: "var(--s-3)", flexWrap: "nowrap" }}>
                        <Avatar name={p.name} seed={p.playerId} size="sm" ring={school.primaryColor} />
                        <span style={{ minWidth: 0 }}>
                          <Link href={playerPath(p.playerId, p.name)} className="player-link">{p.name}</Link>
                          <span className="sub">
                            {[p.classYear, p.height, p.mpg !== null ? `${p.mpg.toFixed(0)} mpg` : null]
                              .filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td><RoleTag role={p.position} /></td>
                    <td>
                      {p.score !== null ? (
                        <RangeStrip value={p.score} lo={p.lo} hi={p.hi} top={top}
                                    label={`Projected ${p.score.toFixed(1)}`} />
                      ) : <span className="faint">—</span>}
                    </td>
                    <td className="r tnum" style={{ fontWeight: 700 }}>{p.score?.toFixed(1) ?? "—"}</td>
                    <td className="r tnum">{p.seasonPoints === null ? "—" : p.seasonPoints.toFixed(0)}</td>
                    {banked ? (
                      <td className="r tnum faint">{p.scored.toFixed(1)}<span className="sub">{p.games} GP</span></td>
                    ) : null}
                    <td className="r">
                      {p.ownedBy ? (
                        <Link className="pill" href={`/teams/${p.ownedBy.fantasyTeamId}`}
                              style={{ textDecoration: "none" }}>{p.ownedBy.name}</Link>
                      ) : <span className="pill free">Free</span>}
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

/** "Ohio State" is OS, "Illinois" is I: initials, never more than three. */
const initials = (name: string) =>
  name.split(/[\s-]+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("").slice(0, 3) || name[0]!;
