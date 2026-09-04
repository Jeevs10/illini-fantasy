import type { Db } from "@illini/db";
import { insertMany } from "@illini/db";

export interface Week { week: number; startsOn: string; endsOn: string }

/** Monday-to-Sunday scoring periods from a season start date. */
export function weeksFrom(firstMonday: string, count: number, periodDays = 7): Week[] {
  const weeks: Week[] = [];
  const cursor = new Date(`${firstMonday}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + periodDays - 1);
    weeks.push({
      week: i + 1,
      startsOn: start.toISOString().slice(0, 10),
      endsOn: end.toISOString().slice(0, 10),
    });
    cursor.setUTCDate(cursor.getUTCDate() + periodDays);
  }
  return weeks;
}

/**
 * Circle-method round robin: fix one team, rotate the rest. With an odd number
 * of teams a bye is inserted, so nobody is silently dropped from a week.
 */
export function roundRobin(teamIds: number[]): { home: number; away: number }[][] {
  const teams = [...teamIds];
  const bye = teams.length % 2 === 1;
  if (bye) teams.push(-1);

  const rounds: { home: number; away: number }[][] = [];
  const half = teams.length / 2;
  const rotating = teams.slice(1);

  for (let r = 0; r < teams.length - 1; r += 1) {
    const order = [teams[0]!, ...rotating];
    const pairs: { home: number; away: number }[] = [];
    for (let i = 0; i < half; i += 1) {
      const a = order[i]!;
      const b = order[order.length - 1 - i]!;
      if (a === -1 || b === -1) continue;
      // Alternate home and away each round so the split stays even.
      pairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(pairs);
    rotating.unshift(rotating.pop()!);
  }
  return rounds;
}

/** Generates the league schedule, repeating the round robin to fill the weeks. */
export async function generateSchedule(
  db: Db, leagueId: number, firstMonday: string, weekCount: number,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM fantasy_team WHERE league_id = $1 ORDER BY id", [leagueId],
  );
  const teamIds = rows.map((r) => Number(r.id));
  if (teamIds.length < 2) throw new Error("a league needs at least two teams");

  const rounds = roundRobin(teamIds);
  const weeks = weeksFrom(firstMonday, weekCount);

  const matchupRows = weeks.flatMap((w) =>
    rounds[(w.week - 1) % rounds.length]!.map((p) =>
      [leagueId, w.week, w.startsOn, w.endsOn, p.home, p.away]));

  return insertMany(db, {
    table: "matchup",
    columns: ["league_id", "week", "starts_on", "ends_on", "home_team_id", "away_team_id"],
    rows: matchupRows,
    dedupeOn: [0, 1, 4],
    // The regular-season slot is a partial unique index — round IS NULL — since
    // a playoff round names its own slot by (round, bracket, seq) instead. The
    // WHERE has to be repeated here for Postgres to infer which index this is.
    conflict: `(league_id, week, home_team_id) WHERE round IS NULL DO UPDATE SET
      starts_on = EXCLUDED.starts_on,
      ends_on = EXCLUDED.ends_on,
      away_team_id = EXCLUDED.away_team_id`,
  });
}
