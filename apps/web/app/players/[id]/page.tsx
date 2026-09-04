import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { playerCard, type GameLogEntry, type PlayerCard } from "@illini/league";
import type { BlockName } from "@illini/scoring";
import { db } from "../../../lib/db.ts";
import { requireViewer } from "../../../lib/session.ts";
import { Avatar } from "../../ui/identity.tsx";
import { Bar, Empty, Score, StatTile } from "../../ui/bits.tsx";

export const dynamic = "force-dynamic";

const BLOCKS: BlockName[] = [
  "scoring", "shooting", "playmaking", "defense", "rebounding", "efficiency",
];

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireViewer();
  const card = await playerCard(db, {
    playerId: Number(id),
    configId: viewer.membership.configId,
    season: viewer.membership.season,
  });
  return { title: card ? `${card.name} · Illini Fantasy` : "Player · Illini Fantasy" };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const { leagueId, season, configId } = viewer.membership;

  const card = await playerCard(db, { playerId: Number(id), configId, season, leagueId });
  if (!card) notFound();

  const scores = card.log.map((g) => g.score);
  const best = scores.length === 0 ? 0 : Math.max(...scores);
  const worst = scores.length === 0 ? 0 : Math.min(...scores);
  // Oldest first, so the trend reads left to right the way a season does.
  const trend = [...card.log].reverse();

  return (
    <>
      <section className="hero">
        <Avatar name={card.name} seed={card.playerId} size="xl" />
        <div className="hero-id">
          <h1>{card.name}</h1>
          <p className="meta">
            <span>{card.teamName ?? "Unaffiliated"}</span>
            {card.conference ? <span>{card.conference}</span> : null}
            {card.role ? <span>{card.role}</span> : null}
            {card.classYear ? <span>{card.classYear}</span> : null}
          </p>
        </div>
        <div className="hero-own">
          {card.ownedBy
            ? <span className="pill">Rostered by {card.ownedBy}</span>
            : <span className="pill free">Free agent</span>}
          <Link className="button sm" href="/players">← All players</Link>
        </div>
      </section>

      <div className="panel">
        <div className="tiles">
          <StatTile label="Games" value={String(card.games)} />
          <StatTile label="Total" value={card.totalScore.toFixed(1)} />
          <StatTile label="Average" value={card.averageScore.toFixed(1)} tone="accent" />
          <StatTile label="Best" value={card.games === 0 ? "—" : best.toFixed(1)} />
          <StatTile label="Floor" value={card.games === 0 ? "—" : worst.toFixed(1)} />
        </div>
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
    </>
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

/**
 * One night, decomposed.
 *
 * The blocks are 0..1 before weighting, so the bars show which parts of the
 * model the player filled — not the points they contributed, which depend on
 * the archetype's weights.
 */
function Game({ game, best }: { game: GameLogEntry; best: number }) {
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
          {game.opponentStrength !== null ? ` · strength ${game.opponentStrength.toFixed(2)}` : ""}
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
              <span className="label">{name}</span>
              <Bar percent={value * 100} label={`${name}, ${value.toFixed(2)} of 1`} />
              <span className="val">{value.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
