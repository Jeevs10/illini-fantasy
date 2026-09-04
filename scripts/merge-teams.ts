/**
 * Merges team rows the normaliser has outgrown.
 *
 * `team.normalised` is written once, at insert, and every join between sources
 * runs through it. So when `normaliseTeam` learns something — an alias for a
 * Torvik spelling, or that a *leading* "St." is Saint rather than State — the
 * rows already in the table keep the answer it used to give, and the school
 * quietly becomes two teams: one the box scores attach players to, and one the
 * schedule attaches games to.
 *
 * That split is silent. A player on the wrong half has no game on any night, so
 * `startableOn` never offers him and no error is raised; he is simply never
 * startable. It stayed invisible for as long as the database held five days.
 *
 * It then re-derives `player.team_id` from the box scores, because merging the
 * rows is only half of it: `resolveTorvikPlayers` sets a player's team when it
 * first inserts him and never again, so a player already in the table keeps
 * whichever row he was filed under. Torvik is the identity spine, so the team
 * named on his newest stat line is the answer.
 *
 *   npm run merge-teams            report what would move
 *   npm run merge-teams -- --apply do it
 */
import { connect } from "@illini/db";
import { normaliseTeam } from "@illini/crosswalk";
import { loadEnv } from "./env.ts";

loadEnv();
const apply = process.argv.includes("--apply");
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

interface Row { id: string; name: string; normalised: string; cbbd_id: number | null }

try {
  const { rows } = await db.query<Row>("SELECT id, name, normalised, cbbd_id FROM team ORDER BY id");
  const canonical = new Map(rows.map((r) => [r.normalised, r]));
  const stale = rows.filter((r) => normaliseTeam(r.name) !== r.normalised);

  if (stale.length === 0) {
    console.log(`${rows.length} teams, all normalised as the current rules would`);
  }

  let moved = 0;
  for (const from of stale) {
    const want = normaliseTeam(from.name);
    const into = canonical.get(want);

    // Nothing to merge into: the row is simply filed under a stale key. Renaming
    // it in place is the whole fix, and keeps whatever is already attached.
    if (!into || into.id === from.id) {
      console.log(`rename  ${from.id.padStart(5)}  "${from.name}"  ${from.normalised} -> ${want}`);
      if (apply) await db.query("UPDATE team SET normalised = $2 WHERE id = $1", [from.id, want]);
      continue;
    }

    const counts = await db.query<{ players: string; games: string; ratings: string; opponents: string }>(
      `SELECT (SELECT count(*) FROM player WHERE team_id = $1) AS players,
              (SELECT count(*) FROM game WHERE home_team_id = $1 OR away_team_id = $1) AS games,
              (SELECT count(*) FROM team_rating WHERE team_id = $1) AS ratings,
              (SELECT count(*) FROM player_game_stat WHERE opponent_team_id = $1) AS opponents`,
      [from.id],
    );
    const c = counts.rows[0]!;
    console.log(
      `merge   ${from.id.padStart(5)} -> ${into.id.padStart(5)}  "${from.name}"  ` +
      `${from.normalised} -> ${want}  players ${c.players} games ${c.games} ` +
      `ratings ${c.ratings} opponents ${c.opponents}`);
    if (!apply) { moved += 1; continue; }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE player SET team_id = $2 WHERE team_id = $1", [from.id, into.id]);
      await client.query("UPDATE game SET home_team_id = $2 WHERE home_team_id = $1", [from.id, into.id]);
      await client.query("UPDATE game SET away_team_id = $2 WHERE away_team_id = $1", [from.id, into.id]);
      await client.query(
        "UPDATE player_game_stat SET opponent_team_id = $2 WHERE opponent_team_id = $1",
        [from.id, into.id]);
      // A rating is keyed by (team, season, as_of), so the survivor may already
      // hold the snapshot being moved. Keep the one that is already canonical.
      await client.query(
        `UPDATE team_rating r SET team_id = $2
          WHERE r.team_id = $1
            AND NOT EXISTS (SELECT 1 FROM team_rating k
                             WHERE k.team_id = $2 AND k.season = r.season AND k.as_of = r.as_of)`,
        [from.id, into.id]);
      await client.query("DELETE FROM team_rating WHERE team_id = $1", [from.id]);
      // cbbd_id is unique, and the stale row is often the one holding it.
      if (from.cbbd_id !== null && into.cbbd_id === null) {
        await client.query("UPDATE team SET cbbd_id = NULL WHERE id = $1", [from.id]);
        await client.query("UPDATE team SET cbbd_id = $2 WHERE id = $1", [into.id, from.cbbd_id]);
        into.cbbd_id = from.cbbd_id;
      }
      await client.query("DELETE FROM team WHERE id = $1", [from.id]);
      await client.query("COMMIT");
      moved += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (stale.length > 0) {
    console.log(`\n${stale.length} stale of ${rows.length} teams — ` +
      (apply ? `${moved} merged or renamed` : "dry run, pass --apply"));
  }

  // ---- players, re-derived from the source of record ----------------------
  const teams = new Map(
    (await db.query<{ id: string; normalised: string }>("SELECT id, normalised FROM team"))
      .rows.map((r) => [r.normalised, Number(r.id)]));

  const { rows: filed } = await db.query<{ player_id: string; team_id: string | null; team: string }>(
    `SELECT DISTINCT ON (s.player_id)
            s.player_id, p.team_id, s.stats->>'team' AS team
       FROM player_game_stat s
       JOIN player p ON p.id = s.player_id
      WHERE s.stats ? 'team'
      ORDER BY s.player_id, s.played_on DESC`);

  const wrong: [number, number][] = [];
  const unknown = new Map<string, number>();
  for (const r of filed) {
    const want = teams.get(normaliseTeam(r.team));
    if (want === undefined) { unknown.set(r.team, (unknown.get(r.team) ?? 0) + 1); continue; }
    if (r.team_id !== null && Number(r.team_id) === want) continue;
    wrong.push([Number(r.player_id), want]);
  }

  console.log(`\n${filed.length} players have a box score; ${wrong.length} are filed ` +
    `under the wrong team${apply ? "" : " (dry run)"}`);
  for (const [name, n] of unknown) console.log(`  no team row for "${name}" (${n} players)`);

  if (apply && wrong.length > 0) {
    await db.query(
      `UPDATE player p SET team_id = m.team_id
         FROM unnest($1::bigint[], $2::bigint[]) AS m(player_id, team_id)
        WHERE p.id = m.player_id`,
      [wrong.map((w) => w[0]), wrong.map((w) => w[1])]);
    console.log(`  repointed ${wrong.length}`);
  }
} finally {
  await db.end();
}
