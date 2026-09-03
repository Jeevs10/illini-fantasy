import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { playerCard, type GameLogEntry, type PlayerCard } from "@illini/league";
import type { BlockName } from "@illini/scoring";
import { db } from "../../../lib/db.ts";
import { requireViewer } from "../../../lib/session.ts";

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

  const best = card.log.length === 0 ? 0 : Math.max(...card.log.map((g) => g.score));

  return (
    <>
      <div className="pagehead">
        <h1>{card.name}</h1>
        <p>
          <span>{card.teamName ?? "Unaffiliated"}</span>
          {card.conference ? <span>{card.conference}</span> : null}
          {card.role ? <span>{card.role}</span> : null}
          {card.classYear ? <span>{card.classYear}</span> : null}
          {card.ownedBy
            ? <span className="tag">{card.ownedBy}</span>
            : <span className="tag free">Free agent</span>}
        </p>
      </div>

      <div className="panel">
        <div className="stats">
          <Stat label="Games" value={String(card.games)} />
          <Stat label="Total" value={card.totalScore.toFixed(1)} />
          <Stat label="Average" value={card.averageScore.toFixed(1)} />
          <Stat label="Best" value={card.games === 0 ? "—" : best.toFixed(1)} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Game log</h2>
            <p className="prose">
              Each night&rsquo;s six blocks, the opponent multiplier applied to
              them, and the minutes ramp — so a score can be read rather than
              taken on faith.
            </p>
          </div>
        </div>
        {card.log.length === 0 ? (
          <EmptyLog card={card} />
        ) : (
          card.log.map((game) => <Game key={game.playedOn} game={game} />)
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function EmptyLog({ card }: { card: PlayerCard }) {
  return (
    <div className="empty">
      <h3>No scored games</h3>
      <p>
        {card.name} has no games under this league&rsquo;s scoring config yet.
        Freshmen and transfers appear here once they have played a night that
        has been ingested.
      </p>
    </div>
  );
}

/**
 * One night, decomposed.
 *
 * The blocks are 0..1 before weighting, so the bars show which parts of the
 * model the player filled — not the points they contributed, which depend on
 * the archetype's weights.
 */
function Game({ game }: { game: GameLogEntry }) {
  return (
    <article className="game">
      <div>
        <div className="game-head">
          <span className="game-date">{game.playedOn}</span>
          <span className="tag">{game.archetype}</span>
          <span className="game-score num">{game.score.toFixed(1)}</span>
        </div>
        <p className="game-meta">
          vs {game.opponent ?? "unknown"}
          {game.opponentStrength !== null
            ? ` · strength ${game.opponentStrength.toFixed(2)}`
            : ""}
          {" · "}{game.minutes.toFixed(0)} min · {game.points} pts, {game.rebounds} reb,{" "}
          {game.assists} ast
        </p>
        <p className="game-math num">
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
              <span className="label" id={`${game.playedOn}-${name}`}>{name}</span>
              <span
                className="bar"
                role="meter"
                aria-labelledby={`${game.playedOn}-${name}`}
                aria-valuenow={Number(value.toFixed(2))}
                aria-valuemin={0}
                aria-valuemax={1}
              >
                <span style={{ width: `${value * 100}%` }} />
              </span>
              <span className="val">{value.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
