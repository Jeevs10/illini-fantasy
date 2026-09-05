import { insertMany, type Db } from "@illini/db";
import { CbbdClient, EspnClient } from "@illini/sources";
import { normaliseTeam } from "@illini/crosswalk";

/** name -> id for every team we know, loaded once per pass. */
export async function teamMap(db: Db): Promise<Map<string, number>> {
  const { rows } = await db.query<{ id: string; normalised: string }>(
    "SELECT id, normalised FROM team",
  );
  return new Map(rows.map((r) => [r.normalised, Number(r.id)]));
}

export async function syncTeams(db: Db, cbbd: CbbdClient, season: number): Promise<number> {
  const teams = await cbbd.teams(season);
  const seen = new Map<string, unknown[]>();
  for (const t of teams) {
    const normalised = normaliseTeam(t.school);
    // CBBD lists a school once per season row; keep the first, which carries
    // the conference we want.
    if (!normalised || seen.has(normalised)) continue;
    seen.set(normalised, [t.school, normalised, t.conference, t.id]);
  }
  return insertMany(db, {
    table: "team",
    columns: ["name", "normalised", "conference", "cbbd_id"],
dedupeOn: [1],
    rows: [...seen.values()],
    conflict: `(normalised) DO UPDATE SET
      name = EXCLUDED.name,
      conference = COALESCE(EXCLUDED.conference, team.conference),
      cbbd_id = COALESCE(EXCLUDED.cbbd_id, team.cbbd_id)`,
  });
}

/**
 * Stores adjusted efficiency as a dated snapshot plus a 0..1 strength.
 *
 * Strength is a percentile rank across the season's teams rather than the raw
 * rating, so the multiplier band stays meaningful however ratings drift.
 * Snapshots are dated because ratings move during a season and the scorer
 * should read the rating current at tip-off, not today's.
 */
export async function syncRatings(
  db: Db, cbbd: CbbdClient, season: number, asOf: string,
): Promise<number> {
  const ratings = (await cbbd.ratings(season))
    .filter((r) => r.netRating !== null && Number.isFinite(r.netRating));
  if (ratings.length === 0) return 0;

  const byName = await teamMap(db);
  const byCbbd = new Map(
    (await db.query<{ id: string; cbbd_id: number }>(
      "SELECT id, cbbd_id FROM team WHERE cbbd_id IS NOT NULL")).rows
      .map((r) => [r.cbbd_id, Number(r.id)]),
  );

  const sorted = [...ratings].sort((a, b) => a.netRating! - b.netRating!);
  const rank = new Map(sorted.map((r, i) => [r.teamId, i / Math.max(1, sorted.length - 1)]));

  const rows = ratings.flatMap((r) => {
    const teamId = byCbbd.get(r.teamId) ?? byName.get(normaliseTeam(r.team));
    if (!teamId) return [];
    return [[teamId, season, asOf, r.netRating, r.offensiveRating, r.defensiveRating,
             rank.get(r.teamId) ?? 0.5]];
  });

  return insertMany(db, {
    table: "team_rating",
    columns: ["team_id", "season", "as_of", "net_rating", "offensive_rating",
              "defensive_rating", "strength"],
dedupeOn: [0, 1, 2],
    rows,
    conflict: `(team_id, season, as_of) DO UPDATE SET
      net_rating = EXCLUDED.net_rating,
      offensive_rating = EXCLUDED.offensive_rating,
      defensive_rating = EXCLUDED.defensive_rating,
      strength = EXCLUDED.strength`,
  });
}

/**
 * Colour and abbreviation, matched onto known teams by school name.
 *
 * Team-level rather than player-level, so `linkSource`'s fuzzy matching and
 * `match_review` queue do not apply here — ~360 rows is small enough to match
 * exactly by `normaliseTeam` and skip anything that misses, the same way a
 * RotoWire player who never matches falls out rather than jamming in a wrong
 * team. Checked against a full team table: 358 of 362 ESPN schools match this
 * way; the four misses are pre-existing crosswalk gaps (a CBBD `school` value
 * that already dropped a suffix ESPN's `location` keeps, e.g. "Boston" for
 * Boston University) rather than anything this function should paper over.
 */
export async function syncTeamIdentity(db: Db, espn: Pick<EspnClient, "teams">): Promise<number> {
  const teams = await espn.teams();
  const seen = new Map<string, { primary: string | null; secondary: string | null; abbr: string | null }>();
  for (const t of teams) {
    const normalised = normaliseTeam(t.location);
    if (!normalised || seen.has(normalised)) continue;
    seen.set(normalised, {
      primary: t.color ? `#${t.color}` : null,
      secondary: t.alternateColor ? `#${t.alternateColor}` : null,
      abbr: t.abbreviation,
    });
  }
  if (seen.size === 0) return 0;

  const normalisedKeys = [...seen.keys()];
  const primary = normalisedKeys.map((k) => seen.get(k)!.primary);
  const secondary = normalisedKeys.map((k) => seen.get(k)!.secondary);
  const abbr = normalisedKeys.map((k) => seen.get(k)!.abbr);

  const { rowCount } = await db.query(
    `UPDATE team SET
       primary_color = COALESCE(data.primary_color, team.primary_color),
       secondary_color = COALESCE(data.secondary_color, team.secondary_color),
       abbreviation = COALESCE(data.abbreviation, team.abbreviation)
       FROM (
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
           AS t(normalised, primary_color, secondary_color, abbreviation)
       ) AS data
      WHERE team.normalised = data.normalised`,
    [normalisedKeys, primary, secondary, abbr],
  );
  return rowCount ?? 0;
}

/** Strength for every team as of a date, newest snapshot at or before it. */
export async function strengthMap(
  db: Db, season: number, onDate: string,
): Promise<Map<number, number>> {
  const { rows } = await db.query<{ team_id: string; strength: number }>(
    `SELECT DISTINCT ON (team_id) team_id, strength
       FROM team_rating
      WHERE season = $1 AND as_of <= $2
      ORDER BY team_id, as_of DESC`,
    [season, onDate],
  );
  return new Map(rows.map((r) => [Number(r.team_id), r.strength]));
}
