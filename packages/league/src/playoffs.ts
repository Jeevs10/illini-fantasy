import type { Db } from "@illini/db";
import { requireCommissioner, type Queryable } from "./membership.ts";
import { DEFAULT_SETTINGS, type LeagueSettings } from "./slots.ts";
import { scorePeriod, standings } from "./settle.ts";

/**
 * Playoffs. A playoff matchup is a matchup.
 *
 * `scorePeriod` is already date-ranged and knows nothing about the regular
 * season, so the bracket is rows in the same `matchup` table rather than a
 * table of its own — the scorebug, `/league`, `/home` and settlement all work
 * on it unchanged. What is new is the shape: a matchup can now be materialised
 * before both of its teams are known, wired to the matches that will decide
 * them.
 */

export type BracketKind = "winners" | "consolation" | "third";
export type FromResult = "winner" | "loser";

export interface SlotOrigin {
  round: string;
  seq: number;
  result: FromResult;
}

export interface BracketMatchShape {
  round: string;
  seq: number;
  /** A seed known at creation — a real team from round one, or a bye. */
  homeSeed: number | null;
  awaySeed: number | null;
  /** Where a side comes from when it is not a fixed seed. */
  homeFrom: SlotOrigin | null;
  awayFrom: SlotOrigin | null;
}

export interface BracketShape {
  teams: number;
  /** Round names in playing order, e.g. `["QF", "SF", "F"]`. Excludes "3rd". */
  rounds: string[];
  matches: BracketMatchShape[];
}

/** The smallest power of two at least as large as `n`. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Classic tournament seeding: 1 and 2 can only meet in the final, 3 and 4 only
 * in the semi-finals, and so on recursively. `seedOrder(8)` is
 * `[1,8,4,5,2,7,3,6]` — read in pairs, that is 1v8, 4v5, 2v7, 3v6.
 */
function seedOrder(size: number): number[] {
  if (size === 1) return [1];
  const half = seedOrder(size / 2);
  return half.flatMap((x) => [x, size + 1 - x]);
}

const ROUND_NAMES = ["F", "SF", "QF", "R16", "R32"];

/** The round name at `distance` rounds before the final. */
function roundName(distance: number): string {
  return ROUND_NAMES[distance] ?? `R${2 ** (distance + 1)}`;
}

interface Slot { seed: number | null; from: SlotOrigin | null }

/**
 * The shape of a single-elimination bracket for `teamCount` seeds.
 *
 * Pure, and tested alone — seeding is the one rule in a playoff bracket that
 * is arithmetic, the same reason `snakeBoard` is exported bare from
 * `draft.ts`. A bye is not a match: seed 1, and seed 2 where the field allows
 * it, are seeded straight into the round a full bracket would have carried
 * them to, which is why a 6-team bracket has two "quarter-finals" rather than
 * four and no play-in round at all.
 */
export function bracketShape(
  teamCount: number, { thirdPlace = false }: { thirdPlace?: boolean } = {},
): BracketShape {
  if (teamCount < 2) throw new Error("a bracket needs at least two teams");
  const size = nextPow2(teamCount);
  const numRounds = Math.log2(size);

  let slots: Slot[] = seedOrder(size).map((seed) => ({
    seed: seed <= teamCount ? seed : null, from: null,
  }));

  const matches: BracketMatchShape[] = [];
  const rounds: string[] = [];
  for (let round = 0; slots.length > 1; round += 1) {
    const name = roundName(numRounds - 1 - round);
    rounds.push(name);
    const next: Slot[] = [];
    let seq = 1;
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i]!;
      const b = slots[i + 1]!;
      const aBye = a.seed === null && a.from === null;
      const bBye = b.seed === null && b.from === null;
      // A bye plays nobody: the other side advances without a row for this
      // slot at all, the same choice `006_draft.sql` makes for "who picks
      // 47th" — a fact to read, not a match that would need refereeing.
      if (aBye && !bBye) { next.push(b); continue; }
      if (bBye && !aBye) { next.push(a); continue; }
      matches.push({ round: name, seq, homeSeed: a.seed, awaySeed: b.seed, homeFrom: a.from, awayFrom: b.from });
      next.push({ seed: null, from: { round: name, seq, result: "winner" } });
      seq += 1;
    }
    slots = next;
  }

  if (thirdPlace && rounds.length >= 2) {
    const semiRound = rounds[rounds.length - 2]!;
    const semis = matches.filter((m) => m.round === semiRound);
    // Only when both semi-finals were real matches — a bye straight into the
    // final has no semi-final loser to send anywhere.
    if (semis.length === 2) {
      matches.push({
        round: "3rd", seq: 1, homeSeed: null, awaySeed: null,
        homeFrom: { round: semiRound, seq: semis[0]!.seq, result: "loser" },
        awayFrom: { round: semiRound, seq: semis[1]!.seq, result: "loser" },
      });
    }
  }

  return { teams: teamCount, rounds, matches };
}

// ---------------------------------------------------------------------------
// Deciding a match
// ---------------------------------------------------------------------------

export interface PlayoffSide {
  points: number;
  seed: number | null;
  pointsFor: number;
}

/**
 * Which side advances. A bracket cannot carry a tie forward, so this always
 * returns a side — shared between settlement and anywhere the bracket is
 * displayed, so a tie is broken exactly once, by one rule, everywhere.
 */
export function decidePlayoffMatch(
  home: PlayoffSide, away: PlayoffSide, tiebreak: LeagueSettings["playoffTiebreak"],
): "home" | "away" {
  if (home.points !== away.points) return home.points > away.points ? "home" : "away";
  if (tiebreak === "pointsFor" && home.pointsFor !== away.pointsFor) {
    return home.pointsFor > away.pointsFor ? "home" : "away";
  }
  // Seed, or a points tie the pointsFor rule could not break either — the
  // better (lower) seed wins, which is what "seed" is for.
  return (home.seed ?? Infinity) <= (away.seed ?? Infinity) ? "home" : "away";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BracketExistsError extends Error {
  constructor(readonly leagueId: number) {
    super(`league ${leagueId} already has a bracket`);
    this.name = "BracketExistsError";
  }
}

export class BracketRefusedError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
    this.name = "BracketRefusedError";
  }
}

// ---------------------------------------------------------------------------
// Creating the bracket
// ---------------------------------------------------------------------------

interface WeekWindow { week: number; startsOn: string; endsOn: string }

/**
 * The calendar week each round plays in, and what has to give way for it.
 *
 * A playoff round reuses the regular-season week's dates rather than deriving
 * its own — `generateSchedule` already decided what a week is for this
 * league — so every reason a week cannot be claimed is collected before
 * anything is written, the same "every refusal at once" rule `updateSettings`
 * follows.
 */
async function claimWeeks(
  q: Queryable, leagueId: number, weekNumbers: number[],
): Promise<{ windows: Map<number, WeekWindow>; problems: string[] }> {
  const windows = new Map<number, WeekWindow>();
  const problems: string[] = [];

  for (const week of weekNumbers) {
    const { rows } = await q.query<{
      settled: string; starts_on: string | null; ends_on: string | null;
    }>(
      `SELECT count(*) FILTER (WHERE settled_at IS NOT NULL) AS settled,
              to_char(min(starts_on), 'YYYY-MM-DD') AS starts_on,
              to_char(max(ends_on), 'YYYY-MM-DD') AS ends_on
         FROM matchup WHERE league_id = $1 AND week = $2 AND round IS NULL`,
      [leagueId, week],
    );
    const row = rows[0]!;
    if (row.starts_on === null) {
      problems.push(`the schedule does not reach week ${week} — draw more weeks first.`);
      continue;
    }
    if (Number(row.settled) > 0) {
      problems.push(`week ${week} already has a settled matchup — the bracket cannot start there.`);
      continue;
    }
    windows.set(week, { week, startsOn: row.starts_on, endsOn: row.ends_on! });
  }
  return { windows, problems };
}

interface CreatedBracket {
  rounds: string[];
  matchupIds: number[];
}

/**
 * Materialises one bracket — winners, or the consolation pool — as rows in
 * `matchup`, round by round.
 *
 * Round by round rather than all at once because a later round's rows point
 * at an earlier round's ids via `home_from`/`away_from`, the self-referencing
 * foreign key `011_playoffs.sql` adds for exactly this.
 */
async function materialiseBracket(
  q: Queryable,
  { leagueId, bracket, shape, seedTeam, weekFor, thirdWeek }: {
    leagueId: number; bracket: BracketKind; shape: BracketShape;
    /** The team holding a given seed number in this bracket. */
    seedTeam: (seed: number) => number;
    weekFor: (round: string) => WeekWindow;
    thirdWeek: WeekWindow | null;
  },
): Promise<CreatedBracket> {
  const idOf = new Map<string, number>(); // `${round}:${seq}` -> matchup.id
  const matchupIds: number[] = [];

  const orderedRounds = [...shape.rounds, ...(shape.matches.some((m) => m.round === "3rd") ? ["3rd"] : [])];
  for (const round of orderedRounds) {
    const window = round === "3rd" ? thirdWeek! : weekFor(round);
    for (const m of shape.matches.filter((x) => x.round === round)) {
      const homeTeamId = m.homeSeed !== null ? seedTeam(m.homeSeed) : null;
      const awayTeamId = m.awaySeed !== null ? seedTeam(m.awaySeed) : null;
      const homeFromId = m.homeFrom !== null ? idOf.get(`${m.homeFrom.round}:${m.homeFrom.seq}`)! : null;
      const awayFromId = m.awayFrom !== null ? idOf.get(`${m.awayFrom.round}:${m.awayFrom.seq}`)! : null;

      // The third-place game is its own bracket value even though it comes
      // from the winners shape — it is neither a step toward the
      // championship nor a placement game for the teams that missed the cut,
      // and the screen groups it separately from both.
      const rowBracket: BracketKind = round === "3rd" ? "third" : bracket;

      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO matchup (
           league_id, week, starts_on, ends_on, round, bracket, seq,
           home_team_id, away_team_id, home_seed, away_seed,
           home_from, away_from, home_from_result, away_from_result
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          leagueId, window.week, window.startsOn, window.endsOn, round, rowBracket, m.seq,
          homeTeamId, awayTeamId, m.homeSeed, m.awaySeed,
          homeFromId, awayFromId, m.homeFrom?.result ?? null, m.awayFrom?.result ?? null,
        ],
      );
      const id = Number(rows[0]!.id);
      idOf.set(`${round}:${m.seq}`, id);
      matchupIds.push(id);
    }
  }
  return { rounds: shape.rounds, matchupIds };
}

export interface CreatedPlayoffs {
  winners: CreatedBracket;
  consolation: CreatedBracket | null;
}

/**
 * Draws the bracket: seeds it from the current standings, deletes the
 * not-yet-played regular-season fixtures the rounds will replace, and
 * materialises every match as a row with no player yet — the identical
 * choice `createDraft` makes for a draft pick.
 *
 * Refuses only what is already true rather than what merely exists: a week
 * that still holds unplayed round-robin fixtures is fine to claim, the same
 * way `createDraft` is fine with a league that has teams — it refuses only a
 * week that is already settled, or a league that already has a bracket.
 */
export async function createBracket(
  db: Db, { leagueId, by }: { leagueId: number; by: number },
): Promise<CreatedPlayoffs> {
  await requireCommissioner(db, leagueId, by);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM matchup WHERE league_id = $1 AND round IS NOT NULL",
      [leagueId]);
    if (Number(existing[0]!.n) > 0) throw new BracketExistsError(leagueId);

    const { rows: league } = await client.query<{ settings: LeagueSettings | null }>(
      "SELECT settings FROM league WHERE id = $1 FOR UPDATE", [leagueId]);
    if (!league[0]) throw new Error(`no league ${leagueId}`);
    const settings = { ...DEFAULT_SETTINGS, ...(league[0].settings ?? {}) };

    const table = await standings(client, leagueId);
    if (table.length < settings.playoffTeams) {
      throw new BracketRefusedError(
        [`the league has ${table.length} teams and the bracket wants ${settings.playoffTeams}.`]);
    }

    const winnersShape = bracketShape(settings.playoffTeams, { thirdPlace: settings.thirdPlace });
    const consolationCount = table.length - settings.playoffTeams;
    const consolationShape = settings.consolation && consolationCount >= 2
      ? bracketShape(consolationCount)
      : null;

    // A small consolation bracket finishes its rounds late rather than early,
    // so its final lands the same week as the championship rather than weeks
    // before anybody is watching it.
    const maxRounds = Math.max(
      winnersShape.rounds.length, consolationShape?.rounds.length ?? 0);
    const consolationOffset = maxRounds - (consolationShape?.rounds.length ?? maxRounds);

    const weekNumbers = Array.from(
      { length: maxRounds }, (_, i) => settings.playoffStartWeek + i * settings.playoffRoundWeeks);
    const { windows, problems } = await claimWeeks(client, leagueId, weekNumbers);
    if (problems.length > 0) throw new BracketRefusedError(problems);

    // The fixtures being replaced are unplayed round-robin rows — safe to
    // drop, the dates they carried are already captured in `windows`.
    await client.query(
      "DELETE FROM matchup WHERE league_id = $1 AND round IS NULL AND week = ANY($2)",
      [leagueId, weekNumbers]);

    const weekForWinners = (round: string): WeekWindow =>
      windows.get(settings.playoffStartWeek + winnersShape.rounds.indexOf(round) * settings.playoffRoundWeeks)!;
    const winnersFinalWeek = weekForWinners(winnersShape.rounds[winnersShape.rounds.length - 1]!);

    const winners = await materialiseBracket(client, {
      leagueId, bracket: "winners", shape: winnersShape,
      seedTeam: (seed) => table[seed - 1]!.fantasyTeamId,
      weekFor: weekForWinners,
      thirdWeek: settings.thirdPlace ? winnersFinalWeek : null,
    });

    let consolation: CreatedBracket | null = null;
    if (consolationShape !== null) {
      const weekForConsolation = (round: string): WeekWindow =>
        windows.get(settings.playoffStartWeek
          + (consolationOffset + consolationShape.rounds.indexOf(round)) * settings.playoffRoundWeeks)!;
      consolation = await materialiseBracket(client, {
        leagueId, bracket: "consolation", shape: consolationShape,
        seedTeam: (seed) => table[settings.playoffTeams + seed - 1]!.fantasyTeamId,
        weekFor: weekForConsolation,
        thirdWeek: null,
      });
    }

    await client.query(
      `INSERT INTO transaction (league_id, kind, payload, created_by)
       VALUES ($1, 'playoffs', $2, $3)`,
      [leagueId, JSON.stringify({
        playoffTeams: settings.playoffTeams, startWeek: settings.playoffStartWeek,
        consolation: consolationShape !== null,
      }), by]);

    await client.query("COMMIT");
    return { winners, consolation };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Settling rounds
// ---------------------------------------------------------------------------

interface BracketRow {
  id: number;
  week: number;
  round: string;
  bracket: BracketKind;
  seq: number;
  startsOn: string;
  endsOn: string;
  settledAt: Date | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeSeed: number | null;
  awaySeed: number | null;
  homePoints: number | null;
  awayPoints: number | null;
  homeFrom: number | null;
  awayFrom: number | null;
  homeFromResult: FromResult | null;
  awayFromResult: FromResult | null;
  winner: "home" | "away" | null;
}

async function bracketRows(q: Queryable, leagueId: number): Promise<BracketRow[]> {
  const { rows } = await q.query<{
    id: string; week: number; round: string; bracket: BracketKind; seq: number;
    starts_on: string; ends_on: string; settled_at: Date | null;
    home_team_id: string | null; away_team_id: string | null;
    home_seed: number | null; away_seed: number | null;
    home_points: number | null; away_points: number | null;
    home_from: string | null; away_from: string | null;
    home_from_result: FromResult | null; away_from_result: FromResult | null;
    winner: "home" | "away" | null;
  }>(
    `SELECT id, week, round, bracket, seq,
            to_char(starts_on,'YYYY-MM-DD') AS starts_on, to_char(ends_on,'YYYY-MM-DD') AS ends_on,
            settled_at, home_team_id, away_team_id, home_seed, away_seed,
            home_points, away_points, home_from, away_from,
            home_from_result, away_from_result, winner
       FROM matchup
      WHERE league_id = $1 AND round IS NOT NULL
      ORDER BY week, bracket, seq`,
    [leagueId],
  );
  return rows.map((r) => ({
    id: Number(r.id), week: r.week, round: r.round, bracket: r.bracket, seq: r.seq,
    startsOn: r.starts_on, endsOn: r.ends_on, settledAt: r.settled_at,
    homeTeamId: r.home_team_id === null ? null : Number(r.home_team_id),
    awayTeamId: r.away_team_id === null ? null : Number(r.away_team_id),
    homeSeed: r.home_seed, awaySeed: r.away_seed,
    homePoints: r.home_points === null ? null : Number(r.home_points),
    awayPoints: r.away_points === null ? null : Number(r.away_points),
    homeFrom: r.home_from === null ? null : Number(r.home_from),
    awayFrom: r.away_from === null ? null : Number(r.away_from),
    homeFromResult: r.home_from_result, awayFromResult: r.away_from_result,
    winner: r.winner,
  }));
}

/**
 * Re-sorts a not-yet-settled round best seed against worst, when the league
 * plays with `reseed`.
 *
 * Every slot in the round is already filled — by a fixed seed, a bye, or the
 * previous round's propagation — before this runs, so re-sorting only changes
 * which named slot a team lands in, never the bracket's shape. Applying it
 * uniformly to every round, including the first, is safe: round one's own
 * seeding (`1v8, 4v5, 2v7, 3v6`) already *is* best-against-worst, so this is a
 * no-op there and only moves anything once an upset makes it matter.
 */
function reseedRound(rows: BracketRow[]): { id: number; homeTeamId: number; awayTeamId: number; homeSeed: number; awaySeed: number }[] {
  const slots = rows
    .flatMap((m) => [
      { team: m.homeTeamId, seed: m.homeSeed },
      { team: m.awayTeamId, seed: m.awaySeed },
    ])
    .sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity));

  return rows.map((m, i) => {
    const home = slots[i]!;
    const away = slots[slots.length - 1 - i]!;
    return { id: m.id, homeTeamId: home.team!, awayTeamId: away.team!, homeSeed: home.seed!, awaySeed: away.seed! };
  });
}

export interface PlayoffMatchResult {
  matchupId: number;
  round: string;
  bracket: BracketKind;
  homeTeamId: number;
  awayTeamId: number;
  homePoints: number;
  awayPoints: number;
  winner: "home" | "away";
}

/**
 * Settles every playoff round whose scoring period has finished, and advances
 * winners (and, for a third-place game, losers) into the matches waiting on
 * them.
 *
 * Settle-on-read, like `settleWaivers` and `settleTrades` rather than the
 * regular season's `settleWeek`: there is no worker, and a bracket that only
 * advanced when a commissioner remembered to run `settle` would strand a
 * champion mid-celebration. Idempotent — a match already settled is skipped,
 * and reseeding a round that has not changed reproduces the same pairing.
 */
export async function settlePlayoffs(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<PlayoffMatchResult[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT id FROM matchup WHERE league_id = $1 AND round IS NOT NULL FOR UPDATE`,
      [leagueId]);

    const { rows: league } = await client.query<{ config_id: string; settings: LeagueSettings | null }>(
      "SELECT config_id, settings FROM league WHERE id = $1", [leagueId]);
    if (!league[0]) { await client.query("ROLLBACK"); return []; }
    const settings = { ...DEFAULT_SETTINGS, ...(league[0].settings ?? {}) };
    const configId = Number(league[0].config_id);

    // Regular-season points for, for the `pointsFor` tiebreak — the table a
    // playoff loss must never itself appear in, which is why `standings`
    // reads `round IS NULL` only.
    const regularSeason = new Map((await standings(client, leagueId)).map((t) => [t.fantasyTeamId, t.pointsFor]));

    const results: PlayoffMatchResult[] = [];
    let rows = await bracketRows(client, leagueId);

    for (const m of rows) {
      if (m.settledAt !== null) continue;
      if (m.homeTeamId === null || m.awayTeamId === null) continue;
      // The period has to be over, not just under way — a round settles once,
      // the way a real bracket does, rather than flipping the winner back and
      // forth while both sides are still adding games.
      if (new Date(`${m.endsOn}T00:00:00Z`).getTime() >= now.getTime()) continue;

      const [home, away] = await Promise.all([
        scorePeriod(client, { fantasyTeamId: m.homeTeamId, configId, from: m.startsOn, to: m.endsOn, settings }),
        scorePeriod(client, { fantasyTeamId: m.awayTeamId, configId, from: m.startsOn, to: m.endsOn, settings }),
      ]);
      const winner = decidePlayoffMatch(
        { points: home.total, seed: m.homeSeed, pointsFor: regularSeason.get(m.homeTeamId) ?? 0 },
        { points: away.total, seed: m.awaySeed, pointsFor: regularSeason.get(m.awayTeamId) ?? 0 },
        settings.playoffTiebreak,
      );

      await client.query(
        `UPDATE matchup SET home_points = $2, away_points = $3, winner = $4, settled_at = $5,
                config_id = $6, settings = $7
           WHERE id = $1`,
        [m.id, home.total, away.total, winner, now, configId, JSON.stringify(settings)]);
      m.settledAt = now;
      m.homePoints = home.total; m.awayPoints = away.total; m.winner = winner;
      results.push({
        matchupId: m.id, round: m.round, bracket: m.bracket,
        homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId,
        homePoints: home.total, awayPoints: away.total, winner,
      });

      const advancing = winner === "home"
        ? { teamId: m.homeTeamId, seed: m.homeSeed } : { teamId: m.awayTeamId, seed: m.awaySeed };
      const eliminated = winner === "home"
        ? { teamId: m.awayTeamId, seed: m.awaySeed } : { teamId: m.homeTeamId, seed: m.homeSeed };

      for (const child of rows) {
        if (child.homeFrom === m.id && child.homeTeamId === null) {
          const feed = child.homeFromResult === "winner" ? advancing : eliminated;
          await client.query("UPDATE matchup SET home_team_id = $2, home_seed = $3 WHERE id = $1",
            [child.id, feed.teamId, feed.seed]);
          child.homeTeamId = feed.teamId; child.homeSeed = feed.seed;
        }
        if (child.awayFrom === m.id && child.awayTeamId === null) {
          const feed = child.awayFromResult === "winner" ? advancing : eliminated;
          await client.query("UPDATE matchup SET away_team_id = $2, away_seed = $3 WHERE id = $1",
            [child.id, feed.teamId, feed.seed]);
          child.awayTeamId = feed.teamId; child.awaySeed = feed.seed;
        }
      }
    }

    if (settings.reseed) {
      rows = await bracketRows(client, leagueId);
      const groups = new Map<string, BracketRow[]>();
      for (const m of rows) {
        if (m.settledAt !== null || m.homeTeamId === null || m.awayTeamId === null) continue;
        const key = `${m.bracket}:${m.round}`;
        groups.set(key, [...(groups.get(key) ?? []), m]);
      }
      for (const group of groups.values()) {
        for (const next of reseedRound(group)) {
          await client.query(
            "UPDATE matchup SET home_team_id = $2, away_team_id = $3, home_seed = $4, away_seed = $5 WHERE id = $1",
            [next.id, next.homeTeamId, next.awayTeamId, next.homeSeed, next.awaySeed]);
        }
      }
    }

    await client.query("COMMIT");
    return results;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Reading the bracket
// ---------------------------------------------------------------------------

export interface BracketSide {
  fantasyTeamId: number | null;
  name: string | null;
  seed: number | null;
  points: number | null;
}

export interface BracketMatchView {
  matchupId: number;
  round: string;
  bracket: BracketKind;
  seq: number;
  week: number;
  startsOn: string;
  endsOn: string;
  settled: boolean;
  home: BracketSide;
  away: BracketSide;
  winner: "home" | "away" | null;
}

export interface BracketView {
  /** Winners-bracket round names in playing order. */
  rounds: string[];
  /** Consolation-bracket round names in playing order, empty if there is none. */
  consolationRounds: string[];
  matches: BracketMatchView[];
  hasThird: boolean;
}

/**
 * Everything `/playoffs` renders — settles first, the same way `draftRoom`
 * settles the clock before it reads the board, so opening the page is what
 * makes it current.
 */
export async function bracketView(
  db: Db, { leagueId, now = new Date() }: { leagueId: number; now?: Date },
): Promise<BracketView | null> {
  await settlePlayoffs(db, { leagueId, now });

  const { rows } = await db.query<{
    id: string; week: number; round: string; bracket: BracketKind; seq: number;
    starts_on: string; ends_on: string; settled_at: Date | null; winner: "home" | "away" | null;
    home_team_id: string | null; home_name: string | null; home_seed: number | null; home_points: number | null;
    away_team_id: string | null; away_name: string | null; away_seed: number | null; away_points: number | null;
  }>(
    `SELECT m.id, m.week, m.round, m.bracket, m.seq,
            to_char(m.starts_on,'YYYY-MM-DD') AS starts_on, to_char(m.ends_on,'YYYY-MM-DD') AS ends_on,
            m.settled_at, m.winner,
            m.home_team_id, h.name AS home_name, m.home_seed, m.home_points,
            m.away_team_id, a.name AS away_name, m.away_seed, m.away_points
       FROM matchup m
       LEFT JOIN fantasy_team h ON h.id = m.home_team_id
       LEFT JOIN fantasy_team a ON a.id = m.away_team_id
      WHERE m.league_id = $1 AND m.round IS NOT NULL
      ORDER BY m.week, m.bracket, m.seq`,
    [leagueId],
  );
  if (rows.length === 0) return null;

  const roundsOf = (bracket: BracketKind) => [...new Set(
    rows.filter((r) => r.bracket === bracket).map((r) => r.round),
  )].filter((r) => r !== "3rd");
  const orderByWeek = (bracket: BracketKind) => (round: string) =>
    Math.min(...rows.filter((r) => r.bracket === bracket && r.round === round).map((r) => r.week));

  const winnersRounds = roundsOf("winners").sort((a, b) => orderByWeek("winners")(a) - orderByWeek("winners")(b));
  const consolationRounds = roundsOf("consolation")
    .sort((a, b) => orderByWeek("consolation")(a) - orderByWeek("consolation")(b));

  return {
    rounds: winnersRounds,
    consolationRounds,
    hasThird: rows.some((r) => r.round === "3rd"),
    matches: rows.map((r) => ({
      matchupId: Number(r.id),
      round: r.round,
      bracket: r.bracket,
      seq: r.seq,
      week: r.week,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      settled: r.settled_at !== null,
      winner: r.winner,
      home: {
        fantasyTeamId: r.home_team_id === null ? null : Number(r.home_team_id),
        name: r.home_name, seed: r.home_seed,
        points: r.home_points === null ? null : Number(r.home_points),
      },
      away: {
        fantasyTeamId: r.away_team_id === null ? null : Number(r.away_team_id),
        name: r.away_name, seed: r.away_seed,
        points: r.away_points === null ? null : Number(r.away_points),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// The playoff picture
// ---------------------------------------------------------------------------

export type PlayoffStatus = "clinched" | "alive" | "eliminated";

export interface PlayoffPictureRow {
  fantasyTeamId: number;
  name: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Wins if this team lost every remaining regular-season game. */
  minWins: number;
  /** Wins if this team won every remaining regular-season game. */
  maxWins: number;
  status: PlayoffStatus;
}

export interface PlayoffPicture {
  cutLine: number;
  /** Regular-season weeks still unsettled. Zero once the table is final. */
  remainingWeeks: number;
  teams: PlayoffPictureRow[];
}

/**
 * The cut line, and who is safely above it, mathematically out, or still
 * playing for it.
 *
 * Clinched and eliminated are the two clauses a `maxWins`/`minWins` comparison
 * can prove outright — a team with no path back in, or none of the field
 * below it with a path to catch up. A closer race than that (two teams who
 * could still swap places, but neither is provably safe) reads as `alive` for
 * both sides rather than guessing at strength of schedule, which is the same
 * honesty `eligibleSlots` chooses over a wrong guess.
 */
export async function playoffPicture(
  db: Db, leagueId: number,
): Promise<PlayoffPicture> {
  const { rows: league } = await db.query<{ settings: LeagueSettings | null }>(
    "SELECT settings FROM league WHERE id = $1", [leagueId]);
  const settings = { ...DEFAULT_SETTINGS, ...(league[0]?.settings ?? {}) };

  const table = await standings(db, leagueId);
  const { rows: weeks } = await db.query<{ remaining: string }>(
    `SELECT count(DISTINCT week) AS remaining FROM matchup
      WHERE league_id = $1 AND round IS NULL AND settled_at IS NULL`,
    [leagueId]);
  const remaining = Number(weeks[0]!.remaining);

  const withPotential = table.map((t) => ({
    ...t, minWins: t.wins, maxWins: t.wins + remaining,
  }));
  const cutLine = settings.playoffTeams;
  const inside = withPotential.slice(0, cutLine);
  const outside = withPotential.slice(cutLine);
  const bestOutsideMax = outside.length === 0 ? -1 : Math.max(...outside.map((t) => t.maxWins));
  const worstInsideMin = inside.length === 0 ? Infinity : Math.min(...inside.map((t) => t.minWins));

  return {
    cutLine,
    remainingWeeks: remaining,
    teams: withPotential.map((t, i) => ({
      fantasyTeamId: t.fantasyTeamId, name: t.name, rank: i + 1,
      wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor,
      minWins: t.minWins, maxWins: t.maxWins,
      status: i < cutLine
        ? (t.minWins > bestOutsideMax ? "clinched" : "alive")
        : (t.maxWins < worstInsideMin ? "eliminated" : "alive"),
    })),
  };
}
