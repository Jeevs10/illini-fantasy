/**
 * Draft-pool availability. CBBD's roster and recruiting endpoints are the
 * intended source for the 2026-27 pool, but they are populated per season and
 * a season that has not started may be empty. This reports what actually
 * exists today so the draft board is built on real coverage.
 */
import { readFileSync } from "node:fs";
import { CbbdClient, parseCsvRow } from "@illini/sources";
import { loadEnv } from "./env.ts";

loadEnv();


const client = new CbbdClient();
const median = (xs: number[]): number => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

console.log("CBBD coverage by season\n");
console.log(`${"season".padEnd(8)}${"teams".padStart(7)}${"w/ players".padStart(12)}${"players".padStart(9)}${"median".padStart(8)}${"portal".padStart(8)}${"recruits".padStart(10)}`);

for (const season of [2027, 2026, 2025]) {
  const rosters = await client.rosters(season);
  const withPlayers = rosters.filter((r) => r.players.length > 0);
  const players = rosters.flatMap((r) => r.players);
  const [portal, recruits] = await Promise.all([
    client.portal(season), client.recruits(season),
  ]);
  console.log(
    String(season).padEnd(8) +
    String(rosters.length).padStart(7) +
    String(withPlayers.length).padStart(12) +
    String(players.length).padStart(9) +
    String(players.length ? median(withPlayers.map((r) => r.players.length)) : 0).padStart(8) +
    String(portal.length).padStart(8) +
    String(recruits.length).padStart(10),
  );
}

// What we have for 2026-27 without CBBD.
const DATA = "/Users/sanjiv/Data/Data/NCAA/2026-2027";
const teamRows = readFileSync(`${DATA}/teams.csv`, "utf8").split(/\r?\n/).filter(Boolean).map(parseCsvRow);
const th = teamRows[0]!;
const d1 = new Set(teamRows.slice(1)
  .filter((r) => r[th.indexOf("conference_division")]?.trim().toLowerCase() === "division i")
  .map((r) => r[th.indexOf("teamid")]));
const rosterRows = readFileSync(`${DATA}/rosters.csv`, "utf8").split(/\r?\n/).filter(Boolean).map(parseCsvRow);
const rh = rosterRows[0]!;
const csvD1 = rosterRows.slice(1).filter((r) => d1.has(r[rh.indexOf("teamid")]));

console.log(`\nNCAA CSV for 2026-27: ${d1.size} D-I teams, ` +
  `${new Set(csvD1.map((r) => r[rh.indexOf("team_name")])).size} with players, ${csvD1.length} players`);
console.log(`\ncalls spent ${client.usage.spent}, cached ${client.usage.cached}, remaining ${client.usage.remaining ?? "n/a"}`);
