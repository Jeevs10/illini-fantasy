import Link from "next/link";
import type { RankedTeam, ReportAdd, ReportPerformer, ReportTeamVsProjection, WeeklyReport } from "@illini/league";
import { Empty, Score, StatTile } from "../ui/bits.tsx";
import { Dot, PlayerRow } from "../ui/playerrow.tsx";
import { Arrow } from "../ui/glyphs.tsx";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(`${iso}T12:00:00Z`));

/**
 * The week in review: the last settled week told back as a report — how the
 * games went, who scored the week's points, and who scored them on the wire
 * where anybody could have had them.
 */
export function WeekReport({
  report, standings, mineId,
}: { report: WeeklyReport; standings: RankedTeam[]; mineId: number | null }) {
  const margins = report.results.map((r) => {
    const [winner, loser] = r.home.points >= r.away.points ? [r.home, r.away] : [r.away, r.home];
    return { winner, loser, margin: winner.points - loser.points };
  });
  const blowout = margins.reduce((a, m) => (m.margin > a.margin ? m : a), margins[0]!);
  const closest = margins.reduce((a, m) => (m.margin < a.margin ? m : a), margins[0]!);
  const top = report.teams[0]!;
  const bottom = report.teams[report.teams.length - 1]!;
  const movement = new Map(standings.map((r) => [r.fantasyTeamId, r]));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Week {report.week} in review</h2>
          <p>{day(report.startsOn)} – {day(report.endsOn)}</p>
        </div>
        <Link href={`/leaders?metric=weekly&week=${report.week}`} className="card-link arrowlink">
          Week leaders <Arrow />
        </Link>
      </div>

      <div className="tiles">
        <StatTile label="Top score" value={top.points.toFixed(1)} tone="accent" note={top.name} />
        {report.teams.length > 1 ? (
          <StatTile label="Worst team" value={bottom.points.toFixed(1)} tone="warn" note={bottom.name} />
        ) : null}
        {margins.length > 1 ? (
          <>
            <StatTile label="Biggest win" value={`+${blowout.margin.toFixed(1)}`}
                      note={`${blowout.winner.name} over ${blowout.loser.name}`} />
            <StatTile label="Closest game" value={closest.margin.toFixed(1)}
                      note={`${closest.winner.name} over ${closest.loser.name}`} />
          </>
        ) : null}
        {report.mvp ? (
          <StatTile label="Your MVP" value={report.mvp.points.toFixed(1)} tone="live"
                    note={`${report.mvp.playerName} · ${games(report.mvp.games)}`} />
        ) : null}
      </div>

      <div className="grid cols-2" style={{ gap: 0 }}>
        <Performers title="Top rostered" players={report.rostered} mineId={mineId}
                    empty="No rostered points this week." />
        <Performers title="Best on the wire" players={report.unrostered} mineId={mineId}
                    empty="Nobody scored off a roster." />
      </div>

      {report.bestAdd ? (
        <>
          <div className="card-head" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <h3 className="eyebrow">Pickups of the week</h3>
          </div>
          <AddRow label="Best add" tone="good" add={report.bestAdd} mineId={mineId} />
          {report.worstAdd ? <AddRow label="Worst add" tone="bad" add={report.worstAdd} mineId={mineId} /> : null}
        </>
      ) : null}

      {report.overperformer && report.underperformer ? (
        <>
          <div className="card-head" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <h3 className="eyebrow">Against the projection</h3>
          </div>
          <VersusRow label="Overperformer" tone="good" team={report.overperformer} mineId={mineId} />
          <VersusRow label="Underperformer" tone="bad" team={report.underperformer} mineId={mineId} />
        </>
      ) : null}

      <div className="card-head" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <h3 className="eyebrow">Weekly power ranking</h3>
      </div>
      {report.teams.map((t) => {
        const seat = movement.get(t.fantasyTeamId);
        const best = top.points > 0 ? t.points / top.points : 0;
        return (
          <div className="plr" key={t.fantasyTeamId} data-mine={t.fantasyTeamId === mineId || undefined}>
            <span className="plr-lead"><span className="stand-rank"><span className="tnum">{t.rank}</span></span></span>
            <span className="plr-id">
              <Link href={`/teams/${t.fantasyTeamId}`} className="plr-name">{t.name}</Link>
              <span className="plr-sub">
                <span>{t.won === null ? "Tied" : t.won ? "Won" : "Lost"}</span>
                {seat ? (
                  <>
                    <Dot />
                    <span>
                      {ordinal(seat.rank)} overall
                      {seat.movement ? (
                        <span className="delta" data-dir={seat.movement > 0 ? "up" : "down"}
                              aria-label={`${seat.movement > 0 ? "up" : "down"} ${Math.abs(seat.movement)}`}>
                          {" "}<Arrow dir={seat.movement > 0 ? "up" : "down"} size={11} />{Math.abs(seat.movement)}
                        </span>
                      ) : null}
                    </span>
                  </>
                ) : null}
              </span>
            </span>
            <span className="plr-right">
              <span className="leadfig">
                <span className="leadfig-bar" aria-hidden="true">
                  <span style={{ width: `${(best * 100).toFixed(1)}%` }} />
                </span>
                <Score value={t.points} size="sm" tone={t.rank === 1 ? "accent" : "default"} />
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VersusRow({
  label, tone, team, mineId,
}: { label: string; tone: "good" | "bad"; team: ReportTeamVsProjection; mineId: number | null }) {
  return (
    <div className="plr" data-mine={team.fantasyTeamId === mineId || undefined}>
      <span className="plr-lead">
        <span className={`pill ${tone === "good" ? "live" : "crit"}`} style={{ minWidth: 112, justifyContent: "center" }}>{label}</span>
      </span>
      <span className="plr-id">
        <Link href={`/teams/${team.fantasyTeamId}`} className="plr-name">{team.name}</Link>
        <span className="plr-sub">
          <span>Projected {team.projected.toFixed(1)}</span>
          <Dot /><span>scored {team.actual.toFixed(1)}</span>
        </span>
      </span>
      <span className="plr-right">
        <span className="delta score score-xs" data-dir={team.diff >= 0 ? "up" : "down"}>
          {team.diff >= 0 ? "+" : "−"}{Math.abs(team.diff).toFixed(1)}
        </span>
      </span>
    </div>
  );
}

function AddRow({
  label, tone, add, mineId,
}: { label: string; tone: "good" | "bad"; add: ReportAdd; mineId: number | null }) {
  return (
    <PlayerRow
      playerId={add.playerId}
      name={add.playerName}
      mine={add.fantasyTeamId === mineId}
      lead={<span className={`pill ${tone === "good" ? "live" : "crit"}`} style={{ minWidth: 76, justifyContent: "center" }}>{label}</span>}
      meta={
        <>
          <span>{add.ownedBy}</span>
          <Dot /><span>added {day(add.addedOn)}</span>
          <Dot /><span>{games(add.games)}</span>
        </>
      }
      right={<Score value={add.points} size="xs" tone={tone === "good" ? "accent" : "quiet"} />}
    />
  );
}

function Performers({
  title, players, mineId, empty,
}: { title: string; players: ReportPerformer[]; mineId: number | null; empty: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--line-soft)", minWidth: 0 }}>
      <div className="card-head"><h3 className="eyebrow">{title}</h3></div>
      {players.length === 0 ? (
        <Empty title={empty} glyph="trophy" />
      ) : players.map((p, i) => (
        <PlayerRow
          key={`${p.playerId}-${p.fantasyTeamId ?? "fa"}`}
          playerId={p.playerId}
          name={p.playerName}
          lead={<span className="stand-rank"><span className="tnum">{i + 1}</span></span>}
          mine={p.fantasyTeamId !== null && p.fantasyTeamId === mineId}
          meta={
            <>
              <span>{p.ownedBy ?? p.schoolName ?? "Free agent"}</span>
              <Dot /><span>{games(p.games)}</span>
            </>
          }
          right={<Score value={p.points} size="xs" />}
        />
      ))}
    </div>
  );
}

const games = (n: number) => `${n} ${n === 1 ? "game" : "games"}`;
const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? "th"}`;
