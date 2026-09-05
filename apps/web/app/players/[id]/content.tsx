import Link from "next/link";
import {
  STAT_GROUPS, type GameLogEntry, type PlayerAvailability, type PlayerCard, type RankPoint,
  type StatAverages, type StatKey, type StatPercentile, type WeekProjection,
} from "@illini/league";
import { GAME_CONFIG, type BlockName } from "@illini/scoring";
import { Avatar } from "../../ui/identity.tsx";
import { AvailabilityTag, Bar, Empty, Score, StatTile } from "../../ui/bits.tsx";
import { RankTrendChart } from "../../ui/charts.tsx";
import type { PlayerCardData } from "./data.ts";

/**
 * The player card's content, apart from its shell.
 *
 * Split into three sections rather than one long component so the full page
 * (which wants all of it, stacked) and the modal (which wants it behind tabs,
 * since a centred overlay has no room for one continuous scroll the way a
 * page does) can each arrange the same three blocks their own way, without
 * two copies of the markup or the numbers drifting apart.
 */

const BLOCKS: BlockName[] = [
  "scoring", "shooting", "playmaking", "defense", "rebounding", "efficiency",
];

const STAT_LABEL: Record<StatKey, string> = {
  points: "Points", rebounds: "Rebounds", assists: "Assists", steals: "Steals", blocks: "Blocks",
  offensiveRebounds: "Off. rebounds", defensiveRebounds: "Def. rebounds",
  fieldGoalsMade: "FG made", threesMade: "3PT made", freeThrowsMade: "FT made",
  effectiveFieldGoalPct: "eFG%", trueShootingPct: "TS%", threePointPct: "3PT%", freeThrowPct: "FT%",
  usage: "Usage", bpm: "BPM", obpm: "OBPM", dbpm: "DBPM", porpag: "PORPAG",
};

function formatStat(stat: StatKey, value: number): string {
  switch (stat) {
    case "effectiveFieldGoalPct": case "trueShootingPct": case "usage":
      return `${value.toFixed(1)}%`;
    case "threePointPct": case "freeThrowPct":
      return `${(value * 100).toFixed(1)}%`;
    default:
      return value.toFixed(1);
  }
}

/** The identity strip — avatar, name, school, ownership. */
export function Hero({ card, linkAway }: { card: PlayerCard; linkAway?: string }) {
  return (
    <section className="hero">
      <Avatar name={card.name} seed={card.playerId} size="xl" ring={card.primaryColor} />
      <div className="hero-id">
        <h1>{card.name}</h1>
        <p className="meta">
          <span>{card.teamName ?? "Unaffiliated"}</span>
          {card.conference ? <span>{card.conference}</span> : null}
          {card.role ? <span>{card.role}</span> : null}
          {card.classYear ? <span>{card.classYear}</span> : null}
          {card.height ? <span>{card.height}</span> : null}
          {card.jersey ? <span>#{card.jersey}</span> : null}
        </p>
      </div>
      <div className="hero-own">
        {card.ownedBy
          ? <span className="pill">Rostered by {card.ownedBy}</span>
          : <span className="pill free">Free agent</span>}
        {linkAway ? <Link className="button sm" href={linkAway}>← All players</Link> : null}
      </div>
    </section>
  );
}

/**
 * RotoWire reports a status and a body part, not prose — this panel shows
 * exactly that, and nothing it does not have. The caller only renders this
 * when the status is not `available`, so a healthy player never sees an empty box.
 */
export function Availability({ availability }: { availability: PlayerAvailability }) {
  return (
    <div className="panel">
      <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: "var(--s-3)" }}>
        <AvailabilityTag status={availability.status} injury={availability.injury} />
        <p style={{ margin: 0 }}>
          {availability.injury ?? "No further detail from RotoWire."}
          <span className="faint" style={{ marginLeft: "var(--s-2)", fontSize: "var(--t-xs)" }}>
            as of {availability.asOf.slice(0, 10)}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Totals, the rank trend and the per-night spark — the "how's he doing" block. */
export function Overview({ card, rankTrend, projection }: {
  card: PlayerCard; rankTrend: RankPoint[]; projection: WeekProjection;
}) {
  const scores = card.log.map((g) => g.score);
  const best = scores.length === 0 ? 0 : Math.max(...scores);
  const worst = scores.length === 0 ? 0 : Math.min(...scores);
  const trend = [...card.log].reverse();
  const latestRank = rankTrend[rankTrend.length - 1] ?? null;

  return (
    <div className="panel">
      <div className="tiles">
        <StatTile label="Games" value={String(card.games)} />
        <StatTile label="Total" value={card.totalScore.toFixed(1)} />
        <StatTile label="Average" value={card.averageScore.toFixed(1)} tone="accent" />
        <StatTile label="Best" value={card.games === 0 ? "—" : best.toFixed(1)} />
        <StatTile label="Floor" value={card.games === 0 ? "—" : worst.toFixed(1)} />
      </div>
      {latestRank || projection.gamesScheduled > 0 ? (
        <div className="tiles" style={{ borderTop: "1px solid var(--line-soft)" }}>
          {latestRank ? (
            <>
              <StatTile label="Rank" value={`#${latestRank.rankOverall}`} note="overall" />
              {card.role ? (
                <StatTile label="Role rank" value={`#${latestRank.rankRole}`} note={card.role} />
              ) : null}
            </>
          ) : null}
          <StatTile
            label="Next 7 days"
            value={projection.projectedTotal.toFixed(1)}
            note={`${projection.gamesScheduled} games × ${projection.average.toFixed(1)} avg`}
          />
        </div>
      ) : null}
      {rankTrend.length >= 3 ? (
        <div className="panel-body" style={{ borderTop: "1px solid var(--line-soft)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--s-2)" }}>
            <span className="eyebrow">Overall rank, season to date</span>
            <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
              {rankTrend[0]!.playedOn} → {rankTrend[rankTrend.length - 1]!.playedOn}
            </span>
          </div>
          <RankTrendChart points={rankTrend.map((r) => ({ playedOn: r.playedOn, rank: r.rankOverall }))} />
        </div>
      ) : null}
      {trend.length >= 4 ? (
        <div className="panel-body" style={{ borderTop: "1px solid var(--line-soft)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--s-2)" }}>
            <span className="eyebrow">Every scored night, oldest first</span>
            <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
              {trend[0]!.playedOn} → {trend[trend.length - 1]!.playedOn}
            </span>
          </div>
          <div className="spark" role="img"
               aria-label={`Scores from ${worst.toFixed(1)} to ${best.toFixed(1)} over ${trend.length} games`}>
            {trend.map((g) => (
              <span
                key={g.playedOn}
                data-best={g.score === best || undefined}
                style={{ height: `${best === 0 ? 0 : Math.max(6, (g.score / best) * 100)}%` }}
                title={`${g.playedOn} — ${g.score.toFixed(1)}`}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** BOX / SHOOTING / ADVANCED, each a table of season averages with a
    percentile bar against everyone who played the same role this season. */
export function SeasonAveragesSection({
  averages, percentileOf,
}: {
  averages: StatAverages; percentileOf: Map<StatKey, StatPercentile>;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Season averages</h2>
          <p>Per-game, against everyone who played the same role this season.</p>
        </div>
      </div>
      <div className="panel-body" style={{ display: "grid", gap: "var(--s-5)" }}>
        {STAT_GROUPS.map((group) => (
          <div key={group.label}>
            <span className="eyebrow">{group.label}</span>
            <div className="scroll">
              <table>
                <tbody>
                  {group.stats.map((stat) => {
                    const pct = percentileOf.get(stat);
                    return (
                      <tr key={stat}>
                        <td style={{ whiteSpace: "nowrap" }}>{STAT_LABEL[stat]}</td>
                        <td className="r" style={{ fontFamily: "var(--f-mono)" }}>
                          {formatStat(stat, averages[stat])}
                        </td>
                        <td style={{ width: "40%" }}>
                          {pct ? (
                            <Bar
                              percent={pct.percentile * 100}
                              label={`${STAT_LABEL[stat]}, ${Math.round(pct.percentile * 100)}th percentile at this role`}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLog({ card }: { card: PlayerCard }) {
  return (
    <Empty title="No scored games" glyph="clock">
      {card.name} has no games under this league&rsquo;s scoring config yet.
      Freshmen and transfers appear here once they have played a night that has
      been ingested.
    </Empty>
  );
}

export function GameLogSection({ card }: { card: PlayerCard }) {
  const scores = card.log.map((g) => g.score);
  const best = scores.length === 0 ? 0 : Math.max(...scores);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Game log</h2>
          <p>
            Each night&rsquo;s six blocks, the opponent multiplier applied to
            them, and the minutes ramp — so a score can be read rather than
            taken on faith.
          </p>
        </div>
        <span className="pill">{card.games} scored</span>
      </div>
      {card.log.length === 0 ? (
        <EmptyLog card={card} />
      ) : (
        card.log.map((game) => <Game key={game.playedOn} game={game} best={best} />)
      )}
    </div>
  );
}

/**
 * One night, decomposed.
 *
 * The blocks are 0..1 before weighting, so the bars show which parts of the
 * model the player filled — not the points they contributed, which depend on
 * the archetype's weights, shown alongside each bar.
 */
function Game({ game, best }: { game: GameLogEntry; best: number }) {
  const weights = GAME_CONFIG.weights[game.archetype];
  return (
    <article className="game">
      <div>
        <div className="game-head">
          <span className="game-date">{game.playedOn}</span>
          <span className="pill ghost">{game.archetype}</span>
          {game.score === best ? <span className="pill mine">Season best</span> : null}
          <span className="game-score">
            <Score value={game.score} size="sm" tone={game.score === best ? "accent" : "default"} />
          </span>
        </div>
        <p className="game-meta">
          vs {game.opponent ?? "unknown"}
          {game.opponentStrength !== null
            ? ` · strength ${game.opponentStrength.toFixed(2)} (${
                game.opponentStrength >= 0.5 ? "tougher" : "easier"
              } than average)`
            : ""}
          {" · "}{game.minutes.toFixed(0)} min · {game.points} pts, {game.rebounds} reb,{" "}
          {game.assists} ast
        </p>
        <p className="game-math">
          {game.raw.toFixed(1)} raw × {game.multiplier.toFixed(2)} opponent
          {game.minutesGate < 1 ? ` × ${game.minutesGate.toFixed(2)} minutes` : ""}
          {" = "}{game.score.toFixed(1)}
        </p>
      </div>

      <div className="blocks">
        {BLOCKS.map((name) => {
          const value = Math.max(0, Math.min(1, game.blocks[name] ?? 0));
          return (
            <div className="block" key={name}>
              <span className="label">
                {name}
                <span className="faint" style={{ marginLeft: "var(--s-1)" }}>
                  {weights[name]}
                </span>
              </span>
              <Bar percent={value * 100} label={`${name}, ${value.toFixed(2)} of 1`} />
              <span className="val">{value.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/** Everything, stacked — the full-page arrangement. */
export function PlayerCardContent({ data, linkAway }: { data: PlayerCardData; linkAway?: string }) {
  const { card, rankTrend, averages, projection, availability, percentileOf } = data;
  return (
    <>
      <Hero card={card} linkAway={linkAway} />
      {availability && availability.status !== "available" ? (
        <Availability availability={availability} />
      ) : null}
      <Overview card={card} rankTrend={rankTrend} projection={projection} />
      {averages ? (
        <SeasonAveragesSection averages={averages} percentileOf={percentileOf} />
      ) : null}
      <GameLogSection card={card} />
    </>
  );
}
