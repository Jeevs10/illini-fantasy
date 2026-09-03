/**
 * Phase 1 validation. Pulls single-day Torvik slices, scores them with the
 * per-game config, and reports the four checks from section 04 of the plan
 * plus a refit of the bounds that saturate.
 *
 * Usage: npm run backtest -- [numDates]
 */
import { GAME_CONFIG, SEASON_CONFIG, scoreLine, type ScoredLine } from "@illini/scoring";
import {
  TorvikClient, COL, num, toPlayerLine, seasonRatesFrom,
  type PsliceRow, type SeasonRates,
} from "@illini/sources";

const SEASON = 2026;

/** Dates spread across the 2025-26 season so the sample is not all November. */
const DATES = [
  "20251107", "20251118", "20251126", "20251206", "20251220", "20251230",
  "20260106", "20260117", "20260124", "20260204", "20260214", "20260228",
];

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const pct = (xs: number[], p: number): number =>
  xs.length ? xs[Math.min(Math.floor((p / 100) * xs.length), xs.length - 1)]! : 0;
const median = (xs: number[]): number => pct(sorted(xs), 50);

const fmtRow = (label: string, xs: number[]): string => {
  const s = sorted(xs);
  return `${label.padEnd(12)}${String(s.length).padStart(7)}` +
    [10, 25, 50, 75, 90, 99].map((p) => pct(s, p).toFixed(1).padStart(8)).join("") +
    (s.at(-1) ?? 0).toFixed(1).padStart(9);
};

const main = async (): Promise<void> => {
  const count = Number(process.argv[2] ?? DATES.length);
  const dates = DATES.slice(0, count);
  const torvik = new TorvikClient();

  console.log(`pulling ${dates.length} game days from Torvik…`);
  const roles = await torvik.roles(SEASON);

  // Season rates power the shrinkage prior.
  const seasonRows = await torvik.slice(SEASON, "20251101", "20260501", "all");
  const seasonRates = new Map<string, SeasonRates>();
  for (const r of seasonRows) seasonRates.set(String(r[COL.pid]), seasonRatesFrom(r));

  const days: { date: string; rows: PsliceRow[] }[] = [];
  for (const date of dates) {
    days.push({ date, rows: await torvik.slice(SEASON, date, date, "all") });
  }
  const rows = days.flatMap((d) => d.rows);
  console.log(`${rows.length} player-games across ${dates.length} days\n`);

  const scoreWith = (cfg: typeof GAME_CONFIG): ScoredLine[] =>
    rows.map((r) => scoreLine(toPlayerLine(r, roles, seasonRates), cfg, 1));

  const seasonScored = scoreWith(SEASON_CONFIG);
  const gameScored = scoreWith(GAME_CONFIG);

  console.log("=".repeat(78));
  console.log("DISTRIBUTION  (multiplier held at 1)");
  console.log("=".repeat(78));
  console.log(`${"".padEnd(12)}${"n".padStart(7)}${["p10","p25","p50","p75","p90","p99"].map((s)=>s.padStart(8)).join("")}${"max".padStart(9)}`);
  console.log(fmtRow("season cfg", seasonScored.map((s) => s.score)));
  console.log(fmtRow("game cfg", gameScored.map((s) => s.score)));

  console.log("\n" + "=".repeat(78));
  console.log("CHECK 1  ceiling saturation — how often a bound clips");
  console.log("=".repeat(78));
  const stats = [
    ["points", (r: PsliceRow) => num(r[COL.points])],
    ["rebounds", (r: PsliceRow) => num(r[COL.rebounds])],
    ["assists", (r: PsliceRow) => num(r[COL.assists])],
  ] as const;
  console.log(`${"stat".padEnd(10)}${"season max".padStart(12)}${"clipped".padStart(10)}${"game max".padStart(10)}${"clipped".padStart(10)}${"p99".padStart(8)}${"p99.9".padStart(8)}${"obs max".padStart(9)}`);
  const refit: Record<string, number> = {};
  for (const [name, get] of stats) {
    const values = sorted(rows.map(get));
    const sMax = SEASON_CONFIG.bounds[name]!.max;
    const gMax = GAME_CONFIG.bounds[name]!.max;
    const clip = (m: number) => (100 * values.filter((v) => v >= m).length / values.length);
    const p999 = pct(values, 99.9);
    refit[name] = Math.ceil(p999);
    console.log(
      name.padEnd(10) + sMax.toFixed(0).padStart(12) + `${clip(sMax).toFixed(1)}%`.padStart(10) +
      gMax.toFixed(0).padStart(10) + `${clip(gMax).toFixed(1)}%`.padStart(10) +
      pct(values, 99).toFixed(0).padStart(8) + p999.toFixed(0).padStart(8) +
      (values.at(-1) ?? 0).toFixed(0).padStart(9),
    );
  }
  console.log(`\nsuggested bounds from p99.9: ${Object.entries(refit).map(([k, v]) => `${k} 0-${v}`).join(", ")}`);

  console.log("\n" + "=".repeat(78));
  console.log("CHECK 2  positional balance — median score by archetype");
  console.log("=".repeat(78));
  const byArch = new Map<string, number[]>();
  for (const s of gameScored) {
    if (!byArch.has(s.archetype)) byArch.set(s.archetype, []);
    byArch.get(s.archetype)!.push(s.score);
  }
  const meds = [...byArch.entries()]
    .map(([a, xs]) => [a, xs.length, median(xs)] as const)
    .sort((x, y) => y[2] - x[2]);
  for (const [a, n, m] of meds) {
    console.log(`  ${a.padEnd(8)} n=${String(n).padStart(6)}  median ${m.toFixed(1).padStart(6)}`);
  }
  const spread = meds[0]![2] / meds.at(-1)![2];
  console.log(`\n  spread high/low = ${spread.toFixed(2)}x  ${spread <= 1.15 ? "PASS (<=1.15)" : "FAIL — needs roster slots or reweighting"}`);

  console.log("\n" + "=".repeat(78));
  console.log("CHECK 3  tails — do ceiling games and cameos score correctly?");
  console.log("=".repeat(78));
  const withRow = gameScored.map((s, i) => ({ s, r: rows[i]! }));
  const best = [...withRow].sort((a, b) => b.s.score - a.s.score).slice(0, 5);
  console.log("  top games:");
  for (const { s, r } of best) {
    console.log(`    ${s.name.slice(0, 20).padEnd(21)}${s.team.slice(0, 14).padEnd(15)}${s.score.toFixed(1).padStart(6)}   ` +
      `${num(r[COL.points])}p ${num(r[COL.rebounds])}r ${num(r[COL.assists])}a ${num(r[COL.minutes]).toFixed(0)}min`);
  }
  const empty = withRow.filter(({ r }) =>
    num(r[COL.points]) === 0 && num(r[COL.rebounds]) === 0 && num(r[COL.assists]) === 0);
  const emptyScores = empty.map(({ s }) => s.score);
  console.log(`\n  empty stat lines (0p/0r/0a): n=${empty.length}` +
    (empty.length ? `  median ${median(emptyScores).toFixed(1)}  max ${Math.max(...emptyScores).toFixed(1)}` : ""));
  const cameos = withRow.filter(({ r }) => num(r[COL.minutes]) < 5);
  console.log(`  cameos under 5 min:        n=${cameos.length}` +
    (cameos.length ? `  median ${median(cameos.map(({ s }) => s.score)).toFixed(1)}` : ""));

  console.log("\n" + "=".repeat(78));
  console.log("CHECK 4  reliability — odd vs even game days, per player");
  console.log("=".repeat(78));
  const oddEven = new Map<string, { odd: number[]; even: number[] }>();
  let cursor = 0;
  days.forEach((day, di) => {
    for (let i = 0; i < day.rows.length; i += 1) {
      const s = gameScored[cursor + i]!;
      if (!oddEven.has(s.playerId)) oddEven.set(s.playerId, { odd: [], even: [] });
      (di % 2 ? oddEven.get(s.playerId)!.odd : oddEven.get(s.playerId)!.even).push(s.score);
    }
    cursor += day.rows.length;
  });
  const pairs = [...oddEven.values()]
    .filter((v) => v.odd.length >= 2 && v.even.length >= 2)
    .map((v) => [median(v.odd), median(v.even)] as const);
  if (pairs.length > 30) {
    const mx = median(pairs.map((p) => p[0])), my = median(pairs.map((p) => p[1]));
    const ax = pairs.map((p) => p[0] - mx), ay = pairs.map((p) => p[1] - my);
    const cov = ax.reduce((acc, v, i) => acc + v * ay[i]!, 0);
    const r = cov / Math.sqrt(ax.reduce((a, v) => a + v * v, 0) * ay.reduce((a, v) => a + v * v, 0));
    console.log(`  n=${pairs.length} players  r=${r.toFixed(3)}  ` +
      `${r >= 0.4 && r <= 0.75 ? "PASS (fantasy sports sit 0.4-0.6)" : r < 0.4 ? "LOW — league is a coin flip" : "HIGH — draft decides everything"}`);
  } else {
    console.log(`  only ${pairs.length} players with enough games — pull more dates`);
  }
};

await main();
