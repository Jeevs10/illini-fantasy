import type { Db } from "@illini/db";
import { upsertScoringConfig, writeScores, type StoredScore } from "@illini/db";
import { GAME_CONFIG, scoreLine, type PlayerLine, type ScoringConfig } from "@illini/scoring";
import {
  COL, num, seasonRatesFrom, toPlayerLine,
  type CbbdClient, type CbbdGame, type TorvikClient, type SeasonRates,
} from "@illini/sources";
import { normaliseTeam } from "@illini/crosswalk";
import { insertMany } from "@illini/db";
import { ensureTeams, resolveTorvikPlayers, type TorvikIdentity } from "./players.ts";
import { strengthMap, teamMap } from "./teams.ts";

const iso = (yyyymmdd: string): string =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/**
 * The day a game belongs to, as everyone but UTC would name it.
 *
 * CBBD timestamps a tip-off in UTC, so a 9pm ET game on the 10th is already the
 * 11th in UTC — and Torvik, which labels a box score with the local game date,
 * calls it the 10th. Storing the UTC date filed 158 of 280 games a day late,
 * which nothing noticed while lineups were derived from the box scores; join
 * the schedule instead and half the slate vanishes.
 *
 * The boundary is 09:00 UTC — 4am Eastern, 1am Pacific. Nothing tips between
 * 05:00 and 16:00 UTC, so the empty band is hours wide on both sides.
 */
export function basketballDate(startDate: string): string {
  const shifted = new Date(startDate);
  shifted.setUTCHours(shifted.getUTCHours() - 9);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Writes a batch of CBBD games, returning cbbd id -> our game id.
 *
 * Tip-off is stored, not just the date: the league locks per game at tip-off,
 * so without a timestamp there is no boundary to lock against.
 */
async function writeGames(
  db: Db, season: number, games: CbbdGame[],
): Promise<{ ids: Map<number, number>; pairs: { home: number; away: number; cbbdId: number }[] }> {
  const teams = await ensureTeams(db, games.flatMap((g) => [g.homeTeam, g.awayTeam]));

  const rows: unknown[][] = [];
  const pairs: { home: number; away: number; cbbdId: number }[] = [];
  for (const g of games) {
    const home = teams.get(normaliseTeam(g.homeTeam));
    const away = teams.get(normaliseTeam(g.awayTeam));
    if (!home || !away) continue;
    // The game's own date, not the requested one, so a game pulled in by the
    // overnight tail is not relabelled.
    rows.push([basketballDate(g.startDate), season, home, away,
               g.neutralSite ?? false, g.id, g.sourceId ?? null, g.startDate]);
    pairs.push({ home, away, cbbdId: g.id });
  }

  await insertMany(db, {
    table: "game",
    columns: ["played_on", "season", "home_team_id", "away_team_id",
              "neutral_site", "cbbd_id", "espn_id", "tipoff"],
    rows,
    dedupeOn: [5],
    conflict: `(cbbd_id) DO UPDATE SET
      played_on = EXCLUDED.played_on,
      home_team_id = EXCLUDED.home_team_id,
      away_team_id = EXCLUDED.away_team_id,
      tipoff = EXCLUDED.tipoff`,
  });

  if (pairs.length === 0) return { ids: new Map(), pairs };
  const ids = new Map(
    (await db.query<{ id: string; cbbd_id: number }>(
      "SELECT id, cbbd_id FROM game WHERE cbbd_id = ANY($1::int[])",
      [pairs.map((p) => p.cbbdId)])).rows.map((r) => [r.cbbd_id, Number(r.id)]),
  );
  return { ids, pairs };
}

/**
 * The window a day's games fall in.
 *
 * `endDateRange` is inclusive of a *timestamp*, not a date, so passing a bare
 * `YYYY-MM-DD` for both ends matches only games tipping at exactly midnight
 * UTC — 9 games instead of 124. The window therefore runs to end-of-day, and
 * extends into the next UTC morning because a US evening tip-off (9pm ET) is
 * already the following day in UTC.
 */
function dayWindow(day: string): { startDateRange: string; endDateRange: string } {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    startDateRange: `${day}T00:00:00Z`,
    endDateRange: `${next.toISOString().slice(0, 10)}T11:59:59Z`,
  };
}

/** Who each team played on a date, so the multiplier can use the opponent. */
export async function syncGames(
  db: Db, cbbd: CbbdClient, season: number, date: string,
): Promise<Map<number, { opponentId: number; gameId: number }>> {
  const day = iso(date);
  const games = await cbbd.games(season, dayWindow(day));
  const { ids, pairs } = await writeGames(db, season, games);

  const out = new Map<number, { opponentId: number; gameId: number }>();
  for (const p of pairs) {
    const gameId = ids.get(p.cbbdId);
    if (gameId === undefined) continue;
    out.set(p.home, { opponentId: p.away, gameId });
    out.set(p.away, { opponentId: p.home, gameId });
  }
  return out;
}

/**
 * Loads the schedule for a date range, tip-off times included.
 *
 * Lineups are set the day *before* a game, so the schedule has to exist before
 * any box score does. This is what the nightly stat pull cannot supply.
 */
export async function syncSchedule(
  db: Db, cbbd: CbbdClient, season: number, from: string, to: string,
): Promise<number> {
  const games = await cbbd.games(season, {
    startDateRange: `${iso(from)}T00:00:00Z`,
    endDateRange: dayWindow(iso(to)).endDateRange,
  });
  const { pairs } = await writeGames(db, season, games);
  return pairs.length;
}

export interface NightlyResult {
  date: string;
  statsWritten: number;
  scoresWritten: number;
  withoutOpponent: number;
  configId: number;
}

/**
 * Ingests and scores one game day.
 *
 * Re-runnable end to end: stats upsert on (player, date) and scores upsert on
 * (player, date, config). Torvik revises box scores after the fact, so a night
 * must be safe to replay without duplicating rows or double-counting a matchup.
 */
export async function ingestNight(
  db: Db,
  { torvik, cbbd, season, date, config = GAME_CONFIG, configLabel = "game" }: {
    torvik: TorvikClient; cbbd: CbbdClient; season: number; date: string;
    config?: ScoringConfig; configLabel?: string;
  },
): Promise<NightlyResult> {
  const day = iso(date);
  const { id: runId } = (await db.query<{ id: string }>(
    `INSERT INTO ingest_run (kind, target_date) VALUES ('nightly', $1) RETURNING id`, [day],
  )).rows[0]!;

  try {
    const [rows, roles, opponents] = await Promise.all([
      torvik.slice(season, date, date, "all"),
      torvik.roles(season),
      syncGames(db, cbbd, season, date),
    ]);

    // Season rates are the shrinkage prior for one-game shooting percentages.
    const seasonRows = await torvik.slice(season, `${season - 1}1101`, `${season}0501`, "all");
    const seasonRates = new Map<string, SeasonRates>(
      seasonRows.map((r) => [String(r[COL.pid]), seasonRatesFrom(r)]),
    );

    const { id: configId } = await upsertScoringConfig(db, configLabel, config);

    // Resolve identity and team lookups up front. Doing these per player is
    // fine locally and ruinous against a remote database.
    const identities: TorvikIdentity[] = [];
    const lines: PlayerLine[] = [];
    for (const row of rows) {
      const pid = String(row[COL.pid] ?? "");
      if (!pid) continue;
      const line = toPlayerLine(row, roles, seasonRates);
      lines.push(line);
      identities.push({ pid, name: line.name, team: line.team, role: line.role });
    }

    const playerIds = await resolveTorvikPlayers(db, identities);
    const teams = await ensureTeams(db, identities.map((i) => i.team));
    const strengths = await strengthMap(db, season, day);

    const scores: StoredScore[] = [];
    const statRows: unknown[][] = [];
    let withoutOpponent = 0;

    for (const [i, line] of lines.entries()) {
      const playerId = playerIds.get(identities[i]!.pid);
      if (playerId === undefined) continue;

      const teamId = teams.get(normaliseTeam(line.team));
      const opponent = teamId === undefined ? undefined : opponents.get(teamId);

      // No schedule entry means no opponent strength. Fall back to a neutral
      // multiplier rather than silently scoring as if the opponent were weak.
      let multiplier = 1;
      if (opponent) {
        const strength = strengths.get(opponent.opponentId);
        if (strength !== undefined) {
          multiplier = config.multiplier.floor + strength * config.multiplier.span;
        }
      } else {
        withoutOpponent += 1;
      }

      statRows.push([
        playerId, day, season, opponent?.gameId ?? null, opponent?.opponentId ?? null,
        line.role, line.minutes, JSON.stringify(line), "torvik",
      ]);
      scores.push({
        ...scoreLine({ ...line, playerId: String(playerId) }, config, multiplier),
        playedOn: day,
      });
    }

    const statsWritten = await insertMany(db, {
      table: "player_game_stat",
      columns: ["player_id", "played_on", "season", "game_id", "opponent_team_id",
                "role", "minutes", "stats", "source"],
dedupeOn: [0, 1],
      rows: statRows,
      conflict: `(player_id, played_on) DO UPDATE SET
        season = EXCLUDED.season,
        game_id = EXCLUDED.game_id,
        opponent_team_id = EXCLUDED.opponent_team_id,
        role = EXCLUDED.role,
        minutes = EXCLUDED.minutes,
        stats = EXCLUDED.stats,
        ingested_at = now()`,
    });

    const scoresWritten = await writeScores(db, configId, day, scores);
    await db.query(
      `UPDATE ingest_run SET finished_at = now(), status = 'ok', rows_written = $2 WHERE id = $1`,
      [runId, statsWritten],
    );
    return { date: day, statsWritten, scoresWritten, withoutOpponent, configId };
  } catch (error) {
    await db.query(
      `UPDATE ingest_run SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1`,
      [runId, (error as Error).message],
    );
    throw error;
  }
}

