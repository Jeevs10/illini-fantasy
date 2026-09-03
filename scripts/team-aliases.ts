/**
 * Lists Torvik team names that do not resolve to a CBBD team, with the closest
 * candidates. Output is meant to be pasted into TEAM_ALIASES after review —
 * never applied automatically, since a wrong team silently misattributes every
 * player on it.
 */
import { TorvikClient, CbbdClient, COL } from "@illini/sources";
import { normaliseTeam, editDistance } from "@illini/crosswalk";
import { loadEnv } from "./env.ts";

loadEnv();

const season = Number(process.argv[2] ?? 2026);
const torvik = new TorvikClient();
const cbbd = new CbbdClient();

const rows = await torvik.slice(season, `${season - 1}1101`, `${season}0501`, "all");
const torvikTeams = [...new Set(rows.map((r) => String(r[COL.team])))].filter(Boolean);

const cbbdTeams = await cbbd.teams(season);
const byNormalised = new Map(cbbdTeams.map((t) => [normaliseTeam(t.school), t.school]));

const tokens = (s: string) => new Set(normaliseTeam(s).split(" ").filter(Boolean));
const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n / Math.max(a.size, b.size);
};

const unmatched = torvikTeams.filter((t) => !byNormalised.has(normaliseTeam(t)));
console.log(`torvik teams ${torvikTeams.length} | cbbd teams ${cbbdTeams.length} | unmatched ${unmatched.length}\n`);

for (const name of unmatched.sort()) {
  const target = tokens(name);
  const ranked = cbbdTeams
    .map((c) => ({
      school: c.school,
      score: overlap(target, tokens(c.school)) -
        editDistance(normaliseTeam(name), normaliseTeam(c.school), 40) / 100,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const best = ranked[0];
  const confident = best && best.score > 0.45;
  console.log(
    `${confident ? "  " : "? "}"${normaliseTeam(name)}": "${best?.school ?? "???"}",`.padEnd(58) +
    `// ${name}  ->  ${ranked.map((r) => `${r.school} (${r.score.toFixed(2)})`).join(" | ")}`,
  );
}
