/**
 * Reports remaining CBBD quota and projects the plan's usage against it.
 * Spends one call (`/conferences`, the smallest payload) to read the header.
 */
import { readFileSync } from "node:fs";
import { CbbdClient } from "@illini/sources";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const [k, ...rest] = line.split("=");
  if (k && rest.length) process.env[k.trim()] ??= rest.join("=").trim();
}

const FREE_TIER_MONTHLY = 1000;

// Game days per month, counted from Data/NCAA/2025-2026/csv/schedules.csv.
const GAME_DAYS = { Nov: 27, Dec: 28, Jan: 30, Feb: 27 };
const inSeasonDays = Math.round(
  Object.values(GAME_DAYS).reduce((a, b) => a + b, 0) / Object.keys(GAME_DAYS).length,
);
const FULL_SEASON_GAME_DAYS = 150;

const client = new CbbdClient({ cacheDir: null });
await client.teams(2026);
const remaining = client.usage.remaining;

const row = (label: string, n: number) =>
  `  ${label.padEnd(34)}${String(n).padStart(6)}`;

console.log(`quota remaining right now: ${remaining ?? "unknown"} of ${FREE_TIER_MONTHLY}\n`);

console.log("steady state, one in-season month");
console.log(row("/plays/date  (nightly)", inSeasonDays));
console.log(row("/games/players  (nightly)", inSeasonDays));
console.log(row("/ratings/adjusted  (weekly)", 4));
console.log(row("/games schedule  (weekly)", 4));
console.log(row("/teams/roster  (weekly)", 4));
const steady = inSeasonDays * 2 + 12;
console.log(row("retries + margin", Math.ceil(steady * 0.12)));
const steadyTotal = steady + Math.ceil(steady * 0.12);
console.log(row("TOTAL", steadyTotal));
console.log(`  -> ${((100 * steadyTotal) / FREE_TIER_MONTHLY).toFixed(0)}% of the free tier\n`);

console.log("one-time backfill, per season of history");
console.log(row("/plays/date  (one per game day)", FULL_SEASON_GAME_DAYS));
console.log(row("supporting calls", 10));
for (const seasons of [1, 2, 3]) {
  const total = seasons * (FULL_SEASON_GAME_DAYS + 10);
  const worst = total + steadyTotal;
  const verdict = worst <= FREE_TIER_MONTHLY ? "fits" : "split across months";
  console.log(`  ${seasons} season${seasons > 1 ? "s" : ""}: ${String(total).padStart(4)} calls` +
    `  (+ a live month = ${String(worst).padStart(4)})  ${verdict}`);
}
console.log("\nnote: payload, not call count, is the binding constraint —");
console.log("one date of shooting plays is ~29 MB, all plays ~2.4x that.");
