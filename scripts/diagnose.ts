/** Compare raw model inputs for one player: our pslice pull vs the repo CSV. */
import { readFile } from "node:fs/promises";
import { TorvikClient, COL, parseCsvRow } from "@illini/sources";

const DATA = "/Users/sanjiv/Data";
const target = process.argv[2] ?? "Devin McGlockton";

const torvik = new TorvikClient();
const rows = await torvik.slice(2026, "20251101", "20260501", "all");
const mine = rows.find((r) => String(r[COL.name]) === target);

const csv = await readFile(`${DATA}/Scripts/Live-Rankings/Rankings/player_stats_with_scores_26.csv`, "utf8");
const lines = csv.split(/\r?\n/).filter(Boolean);
const header = parseCsvRow(lines[0]!);
const theirs = lines.slice(1).map(parseCsvRow).find((v) => v[header.indexOf("player_name")] === target);

if (!mine || !theirs) { console.log("not found in one of the sources"); process.exit(0); }

const pairs: [string, number, string][] = [
  ["GP", COL.games, "GP"], ["minutes", COL.minutes, "mp"], ["points", COL.points, "pts"],
  ["rebounds", COL.rebounds, "treb"], ["assists", COL.assists, "ast"],
  ["usage", COL.usage, "usg"], ["eFG", COL.effectiveFieldGoalPct, "eFG"],
  ["TS%", COL.trueShootingPct, "TS_per"], ["3P%", COL.threePct, "TP_per"],
  ["FT%", COL.freeThrowPct, "FT_per"], ["AST%", COL.assistPct, "AST_per"],
  ["TO%", COL.turnoverPct, "TO_per"], ["STL%", COL.stealPct, "stl_per"],
  ["BLK%", COL.blockPct, "blk_per"], ["DRtg", COL.defensiveRating, "drtg"],
  ["BPM", COL.bpm, "bpm"], ["PORPAG", COL.porpag, "porpag"],
];

console.log(`${target}\n`);
console.log("field".padEnd(10), "pslice".padStart(10), "repoCSV".padStart(10), "  drift");
for (const [label, idx, col] of pairs) {
  const a = Number(mine[idx]); const b = Number(theirs[header.indexOf(col)]);
  const flag = Math.abs(a - b) > Math.max(0.01, Math.abs(b) * 0.02) ? "  <-- differs" : "";
  console.log(label.padEnd(10), a.toFixed(2).padStart(10), b.toFixed(2).padStart(10), flag);
}
