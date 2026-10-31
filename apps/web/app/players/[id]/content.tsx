import Link from "next/link";
import {
  STAT_GROUPS, type GameLogEntry, type PlayerAvailability, type PlayerCard, type PlayerOutlook, type RankPoint,
  type StatAverages, type StatKey, type StatPercentile, type WeekProjection,
} from "@illini/league";
import { GAME_CONFIG, type BlockName } from "@illini/scoring";
import { Avatar } from "../../ui/identity.tsx";
import { AvailabilityTag, Bar, Empty, ET, Score, StatTile } from "../../ui/bits.tsx";
import { Arrow, Glyph } from "../../ui/glyphs.tsx";
import { dataPlayerUrl, schoolPath } from "../../../lib/links.ts";

/** "83rd", "1st" — English ordinals, for a percentile read as a rank rather
    than a fraction. */
function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"][(n % 100 - (n % 10)) !== 10 ? n % 10 : 0] ?? "th";
  return `${n}${suffix}`;
}
import { ProjectionTrendChart, RangeStrip, RankTrendChart } from "../../ui/charts.tsx";
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

/** The identity strip — avatar, name, school, ownership, and the way out to the model's own page. */
export function Hero({ card, outlook, linkAway }: { card: PlayerCard; outlook?: PlayerOutlook; linkAway?: string }) {
  const school = outlook?.school ?? null;
  return (
    <section className="hero">
      <Avatar name={card.name} seed={card.playerId} size="xl" ring={card.primaryColor} />
      <div className="hero-id">
        <h1>{card.name}</h1>
        <p className="meta">
          <span>
            {school ? <Link href={schoolPath(school.slug)}>{school.name}</Link> : card.teamName ?? "Unaffiliated"}
          </span>
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
        {outlook?.forwardKey ? (
          <a className="button sm" href={dataPlayerUrl(outlook.forwardKey)} target="_blank" rel="noopener">
            Prospect Analyzer <Glyph name="external" size={13} />
          </a>
        ) : null}
        {linkAway ? <Link className="button sm" href={linkAway}><Arrow dir="left" /> All players</Link> : null}
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
export function Overview({ card, rankTrend, projection, projected = false }: {
  card: PlayerCard; rankTrend: RankPoint[]; projection: WeekProjection;
  /** The projection panel is showing, and carries the week ahead itself. */
  projected?: boolean;
}) {
  const scores = card.log.map((g) => g.score);
  const best = scores.length === 0 ? 0 : Math.max(...scores);
  const worst = scores.length === 0 ? 0 : Math.min(...scores);
  const trend = [...card.log].reverse();
  const latestRank = rankTrend[rankTrend.length - 1] ?? null;

  // Before his first game a row of zeros and dashes says nothing the empty
  // game log below does not; the week ahead is the only number worth a tile.
  const played = card.games > 0;
  const week = !projected && projection.gamesScheduled > 0;
  if (!played && !latestRank && !week) return null;

  return (
    <div className="panel">
      {played ? (
        <div className="tiles">
          <StatTile label="Games" value={String(card.games)} />
          <StatTile label="Total" value={card.totalScore.toFixed(1)} />
          <StatTile label="Average" value={card.averageScore.toFixed(1)} tone="accent" />
          <StatTile label="Best" value={best.toFixed(1)} />
          <StatTile label="Floor" value={worst.toFixed(1)} />
        </div>
      ) : null}
      {latestRank || week ? (
        <div className="tiles" style={played ? { borderTop: "1px solid var(--line-soft)" } : undefined}>
          {latestRank ? (
            <>
              <StatTile label="Rank" value={`#${latestRank.rankOverall}`} note="overall" />
              {card.role ? (
                <StatTile label="Role rank" value={`#${latestRank.rankRole}`} note={card.role} />
              ) : null}
            </>
          ) : null}
          {week ? (
            <StatTile
              label="Next 7 days"
              value={projection.projectedTotal.toFixed(1)}
              note={`${projection.gamesScheduled} games × ${projection.average.toFixed(1)} avg`}
            />
          ) : null}
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

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

/**
 * The forward model's read on him: the Player Score the draft is ordered by,
 * how wide its range is, where it ranks, what the rest of his season is worth
 * in fantasy points, and game by game what each night ahead is projected for.
 * Nothing on the card says more about whether to roster him.
 */
export function ProjectionSection({ outlook, week }: { outlook: PlayerOutlook; week: WeekProjection }) {
  const { latest, history, upcoming } = outlook;
  if (!latest && upcoming.length === 0) return null;
  // Each game against his own typical night: the opponent and the pace move a
  // projection a point or two, and that difference is the read, not the size.
  const playing = upcoming.filter((g) => !g.listedOut);
  const typical = playing.length === 0 ? 0 : playing.reduce((x, g) => x + g.projected, 0) / playing.length;
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Projection</h2>
          <p>{latest ? <>Forward model, morning of {day(latest.asOf)}.</> : "Forward model."}</p>
        </div>
        {latest ? <span className="pill">#{latest.rank} of {latest.of.toLocaleString("en-US")}</span> : null}
      </div>

      {latest ? (
        <>
          <div className="tiles">
            <StatTile label="Player Score" value={latest.score.toFixed(1)} tone="accent"
                      note={latest.lo !== null && latest.hi !== null
                        ? `range ${latest.lo.toFixed(1)}–${latest.hi.toFixed(1)}` : undefined} />
            {week.gamesScheduled > 0 ? (
              <StatTile label="Next 7 days" value={week.projectedTotal.toFixed(1)}
                        note={`pts over ${week.gamesScheduled} game${week.gamesScheduled === 1 ? "" : "s"}`} />
            ) : null}
            {latest.restPoints !== null ? (
              <StatTile label="Rest of season" value={latest.restPoints.toFixed(0)}
                        note={latest.restGames ? `pts over ${latest.restGames} games` : "pts"} />
            ) : null}
            {latest.mpg !== null ? (
              <StatTile label="Minutes" value={latest.mpg.toFixed(1)} note="projected per game" />
            ) : null}
          </div>
          <div className="panel-body" style={{ borderTop: "1px solid var(--line-soft)", display: "grid", gap: "var(--s-2)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="eyebrow">Against the best projection in the pool</span>
              <span className="faint tnum" style={{ fontSize: "var(--t-xs)" }}>0 – {latest.top.toFixed(1)}</span>
            </div>
            <RangeStrip
              value={latest.score} lo={latest.lo} hi={latest.hi} top={latest.top}
              label={`Projected ${latest.score.toFixed(1)}${latest.lo !== null && latest.hi !== null
                ? `, range ${latest.lo.toFixed(1)} to ${latest.hi.toFixed(1)}` : ""}; the best in the pool is ${latest.top.toFixed(1)}`}
            />
          </div>
        </>
      ) : null}

      {history.length >= 2 ? (
        <div className="panel-body" style={{ borderTop: "1px solid var(--line-soft)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--s-2)" }}>
            <span className="eyebrow">Player Score, morning by morning</span>
            <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
              {day(history[0]!.asOf)} → {day(history[history.length - 1]!.asOf)}
            </span>
          </div>
          <ProjectionTrendChart points={history} />
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="panel-body" style={{ borderTop: "1px solid var(--line-soft)" }}>
          <span className="eyebrow">Next {upcoming.length === 1 ? "game" : `${upcoming.length} games`}</span>
          <ol className="slate">
            {upcoming.map((g) => (
              <li key={`${g.playedOn}-${g.opponent}`} data-out={g.listedOut || undefined}>
                <span className="slate-when">
                  <span>{day(g.playedOn)}</span>
                  {g.tipoff ? <span className="faint"><ET iso={g.tipoff} /> ET</span> : null}
                </span>
                <span className="slate-opp">
                  <span className="faint">{g.site === "home" ? "vs" : g.site === "away" ? "at" : "vs"}</span>{" "}
                  {g.opponentSlug && g.opponent
                    ? <Link href={schoolPath(g.opponentSlug)}>{g.opponent}</Link>
                    : g.opponent ?? "TBD"}
                  {g.site === "neutral" ? <span className="faint"> · neutral</span> : null}
                </span>
                <span className="slate-vs tnum" data-dir={g.listedOut ? "flat"
                  : g.projected - typical >= 0.05 ? "up" : g.projected - typical <= -0.05 ? "down" : "flat"}>
                  {g.listedOut ? "" : `${g.projected - typical >= 0 ? "+" : "−"}${Math.abs(g.projected - typical).toFixed(1)} vs typical`}
                </span>
                <span className="slate-val tnum">{g.listedOut ? "Out" : g.projected.toFixed(1)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** The percentile as a compact read, e.g. "83rd pct" — a rank against role
    peers, without a bar's geometry to render it. */
function PercentileNote({ pct }: { pct?: StatPercentile }) {
  if (!pct) return null;
  const rank = Math.round(pct.percentile * 100);
  return <>{ordinal(rank)} pct</>;
}

/**
 * BOX / SHOOTING / ADVANCED, against everyone who played the same role this
 * season.
 *
 * Box is the handful of headline counting stats a reader actually leads
 * with, so it gets a KPI row — one cube per stat, the percentile as its
 * caption. Shooting and advanced are a dozen-odd rate and model stats nobody
 * scans as a group of five-word headlines; a table reads all of them at once
 * without competing for cube-sized space. Neither uses a bar: a percentile
 * is a rank, not a share of a whole, and a number reads faster than
 * eyeballing a fill against a track.
 */
export function SeasonAveragesSection({
  averages, percentileOf,
}: {
  averages: StatAverages; percentileOf: Map<StatKey, StatPercentile>;
}) {
  const [boxGroup, ...allRateGroups] = STAT_GROUPS;
  const absent = new Set<string>(averages.unreported);
  const rateGroups = allRateGroups
    .map((g) => ({ ...g, stats: g.stats.filter((s) => !absent.has(s)) }))
    .filter((g) => g.stats.length > 0);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Season averages</h2>
        </div>
      </div>

      {boxGroup ? (
        <>
          <div className="panel-body" style={{ paddingBottom: 0 }}>
            <span className="eyebrow">{boxGroup.label}</span>
          </div>
          <div className="tiles">
            {boxGroup.stats.map((stat) => (
              <StatTile
                key={stat}
                label={STAT_LABEL[stat]}
                value={formatStat(stat, averages[stat])}
                note={<PercentileNote pct={percentileOf.get(stat)} />}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="panel-body" style={{ display: "grid", gap: "var(--s-5)" }}>
        {rateGroups.map((group) => (
          <div key={group.label}>
            <span className="eyebrow">{group.label}</span>
            <div className="scroll">
              <table>
                <tbody>
                  {group.stats.map((stat) => (
                    <tr key={stat}>
                      <td style={{ whiteSpace: "nowrap" }}>{STAT_LABEL[stat]}</td>
                      <td className="r" style={{ fontFamily: "var(--f-mono)" }}>
                        {formatStat(stat, averages[stat])}
                      </td>
                      <td className="r faint" style={{ fontSize: "var(--t-xs)", whiteSpace: "nowrap" }}>
                        <PercentileNote pct={percentileOf.get(stat)} />
                      </td>
                    </tr>
                  ))}
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
      {card.name} hasn&rsquo;t played yet.
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
            {card.log.some((g) => (g.archetype as string) !== "forward")
              ? <>Each night&rsquo;s six blocks, the opponent multiplier applied to
                  them, and the minutes ramp — so a score can be read rather than
                  taken on faith.</>
              : <>Each game&rsquo;s box line through the Player Score&rsquo;s weights, plus credit for the
                  defense he faced.</>}
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
  // Stored as the archetype by the forward feed, which has no archetype to give.
  if ((game.archetype as string) === "forward") return <ForwardGame game={game} best={best} />;
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

/**
 * One night on the forward model: the box line through the Player Score's box
 * weights, plus the credit for the defense it came against — the two parts of
 * `valAdj`, the number the Daily Update ranks performances by.
 */
function ForwardGame({ game, best }: { game: GameLogEntry; best: number }) {
  const parts = game.blocks as unknown as { box?: number; opponent?: number; program?: number };
  const program = parts.program ?? 0;
  return (
    <article className="game">
      <div>
        <div className="game-head">
          <span className="game-date">{game.playedOn}</span>
          {game.score === best ? <span className="pill mine">Season best</span> : null}
          <span className="game-score">
            <Score value={game.score} size="sm" tone={game.score === best ? "accent" : "default"} />
          </span>
        </div>
        <p className="game-meta">
          vs {game.opponent ?? "unknown"}
          {" · "}{game.minutes.toFixed(0)} min · {game.points} pts, {game.rebounds} reb,{" "}
          {game.assists} ast
        </p>
        <p className="game-math">
          {(parts.box ?? game.raw).toFixed(1)} box value
          {" + "}{(parts.opponent ?? 0).toFixed(1)} for the defense faced
          {program !== 0 ? <>{program > 0 ? " + " : " − "}{Math.abs(program).toFixed(1)} for his program and team</> : null}
          {" = "}{game.score.toFixed(1)}
        </p>
      </div>
    </article>
  );
}

/** Everything, stacked — the full-page arrangement. */
export function PlayerCardContent({ data, linkAway }: { data: PlayerCardData; linkAway?: string }) {
  const { card, rankTrend, averages, projection, availability, percentileOf, outlook } = data;
  return (
    <>
      <Hero card={card} outlook={outlook} linkAway={linkAway} />
      {availability && availability.status !== "available" ? (
        <Availability availability={availability} />
      ) : null}
      <ProjectionSection outlook={outlook} week={projection} />
      <Overview card={card} rankTrend={rankTrend} projection={projection} projected={outlook.latest !== null} />
      {averages ? (
        <SeasonAveragesSection averages={averages} percentileOf={percentileOf} />
      ) : null}
      <GameLogSection card={card} />
    </>
  );
}
