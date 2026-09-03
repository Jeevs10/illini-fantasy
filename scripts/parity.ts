/**
 * Parity check: does the TypeScript port reproduce generate_player_scores.py?
 *
 * Scores the full-season Torvik slice with SEASON_CONFIG and the same
 * conference/team multiplier, then compares against the Player-Score column in
 * the repo's live rankings CSV. Any systematic gap means a block broke.
 */
import { readFile } from "node:fs/promises";
import { SEASON_CONFIG, scoreLine, scale } from "@illini/scoring";
import { TorvikClient, COL, parseCsvRow, toPlayerLine, num } from "@illini/sources";

const DATA = "/Users/sanjiv/Data";
const SEASON = 2026;

const pct = (xs: number[], p: number): number =>
  xs[Math.min(Math.floor((p / 100) * xs.length), xs.length - 1)]!;

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const main = async (): Promise<void> => {
  const torvik = new TorvikClient();
  const [rows, roles, confRatings, teamRatings] = await Promise.all([
    torvik.slice(SEASON, "20251101", "20260501", "all"),
    torvik.roles(SEASON),
    loadJson<Record<string, number>>(`${DATA}/Model-Outputs/conf_barthag.json`),
    loadJson<Record<string, number>>(`${DATA}/Model-Outputs/barthag_scores_26.json`),
  ]);

  const confValues = Object.values(confRatings);
  const teamValues = Object.values(teamRatings);
  const confMin = Math.min(...confValues), confMax = Math.max(...confValues);
  const teamMin = Math.min(...teamValues), teamMax = Math.max(...teamValues);
  const { floor, span } = SEASON_CONFIG.multiplier;

  // Reference: the Python pipeline's own output.
  const csv = await readFile(
    `${DATA}/Scripts/Live-Rankings/Rankings/player_stats_with_scores_26.csv`, "utf8",
  );
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvRow(lines[0]!);
  const iName = header.indexOf("player_name");
  const iTeam = header.indexOf("team");
  const iScore = header.indexOf("Player-Score");
  const reference = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const v = parseCsvRow(line);
    reference.set(`${v[iName]}|${v[iTeam]}`, Number(v[iScore]));
  }

  const deltas: number[] = [];
  const worst: { name: string; ours: number; theirs: number; d: number }[] = [];
  let matched = 0;

  for (const row of rows) {
    // The Python script filters on Min_per >= 3 before scoring.
    if (num(row[COL.minutesPct]) < 3) continue;

    const line = toPlayerLine(row, roles);
    const confScaled = floor + scale(confRatings[line.conference] ?? 0.5, confMin, confMax) * span;
    const teamScaled = floor + scale(teamRatings[line.team] ?? 0.5, teamMin, teamMax) * span;
    let scored = scoreLine(line, SEASON_CONFIG, (confScaled + teamScaled) / 2);

    // Python applies a linear haircut below 10 minutes per game.
    if (line.minutes < 10) scored = { ...scored, score: scored.score * (line.minutes / 10) };

    const theirs = reference.get(`${line.name}|${line.team}`);
    if (theirs === undefined || !Number.isFinite(theirs)) continue;
    matched += 1;
    const d = Math.abs(scored.score - theirs);
    deltas.push(d);
    worst.push({ name: `${line.name} (${line.team})`, ours: scored.score, theirs, d });
  }

  deltas.sort((a, b) => a - b);
  worst.sort((a, b) => b.d - a.d);

  console.log(`matched ${matched} players against the Python output\n`);
  console.log("absolute difference in Player-Score:");
  for (const p of [50, 90, 99]) console.log(`  p${p}  ${pct(deltas, p).toFixed(3)}`);
  console.log(`  max  ${deltas.at(-1)!.toFixed(3)}`);
  console.log(`  within 0.5: ${(100 * deltas.filter((d) => d <= 0.5).length / deltas.length).toFixed(1)}%`);
  console.log(`  within 2.0: ${(100 * deltas.filter((d) => d <= 2.0).length / deltas.length).toFixed(1)}%`);
  console.log("\nlargest gaps:");
  for (const w of worst.slice(0, 5)) {
    console.log(`  ${w.name.padEnd(34)} ours ${w.ours.toFixed(2).padStart(7)}  theirs ${w.theirs.toFixed(2).padStart(7)}  Δ ${w.d.toFixed(2)}`);
  }
};

await main();
