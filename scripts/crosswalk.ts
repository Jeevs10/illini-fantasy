/**
 * Measures the crosswalk against the baseline from the plan: matching
 * RotoWire's injury list to a roster on normalised name alone got 59%
 * overall, 69% on teams with a full roster.
 *
 * The index is built from CBBD's 2025-26 rosters, which is the largest source
 * with real players (5,643 across 365 teams) — 2026-27 is still empty.
 */
import { readFileSync } from "node:fs";
import { CbbdClient } from "@illini/sources";
import { buildIndex, resolveAll, summarise, normaliseTeam, canonicaliseName, type SourceRecord } from "@illini/crosswalk";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const [k, ...rest] = line.split("=");
  if (k && rest.length) process.env[k.trim()] ??= rest.join("=").trim();
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface RotoInjury {
  ID: string; player: string; team: string; position: string;
  injury: string; status: string;
}

const injuries = (await (await fetch(
  "https://www.rotowire.com/cbasketball/tables/injury-report.php?team=ALL&pos=ALL&conf=ALL&site=other&slateID=null",
  { headers: { "User-Agent": UA, Referer: "https://www.rotowire.com/cbasketball/injury-report.php" } },
)).json()) as RotoInjury[];

const client = new CbbdClient();
const rosters = await client.rosters(2026);
const index = buildIndex(rosters.flatMap((r) =>
  r.players.map((p): SourceRecord => ({
    source: "cbbd", sourceId: String(p.id), name: p.name, team: r.team, position: p.position,
  })),
));

const records = injuries.map((i): SourceRecord => ({
  source: "rotowire", sourceId: i.ID, name: i.player, team: i.team, position: i.position,
}));

const matches = resolveAll(records, index);
const counts = summarise(matches);
const n = matches.length;
const usable = counts.exact + counts.strong + counts.weak;

console.log(`RotoWire injuries: ${n}  |  CBBD 2025-26 index: ${index.byNameTeam.size} name-team keys\n`);
console.log("confidence      n     share");
for (const k of ["exact", "strong", "weak", "none"] as const) {
  console.log(`  ${k.padEnd(8)}${String(counts[k]).padStart(6)}${`${((100 * counts[k]) / n).toFixed(1)}%`.padStart(10)}`);
}
console.log(`\n  matched (any)  ${String(usable).padStart(4)}${`${((100 * usable) / n).toFixed(1)}%`.padStart(10)}`);
console.log(`  auto-accept    ${String(counts.exact + counts.strong).padStart(4)}${`${((100 * (counts.exact + counts.strong)) / n).toFixed(1)}%`.padStart(10)}  (exact + strong)`);
console.log(`  review queue   ${String(counts.weak + counts.none).padStart(4)}${`${((100 * (counts.weak + counts.none)) / n).toFixed(1)}%`.padStart(10)}`);

// Split the failures: our problem (bad matching) vs theirs (player not in index).
const teamsInIndex = new Set([...index.byNameTeam.keys()].map((k) => k.split("|")[1]!));
const failures = matches.filter((m): m is typeof m => m.confidence === "none");
const unknownTeam = failures.filter((m) => !teamsInIndex.has(normaliseTeam(m.record.team)));
console.log(`\nof ${failures.length} unmatched: ${unknownTeam.length} are on a team absent from the index, ` +
  `${failures.length - unknownTeam.length} are a genuine name miss`);

if (unknownTeam.length) {
  const names = [...new Set(unknownTeam.map((m) => m.record.team))].sort();
  console.log(`\nteams needing an alias (${names.length}):`);
  console.log("  " + names.slice(0, 18).join(", ") + (names.length > 18 ? ", …" : ""));
}
const nameMisses = failures.filter((m) => teamsInIndex.has(normaliseTeam(m.record.team)));
if (nameMisses.length) {
  console.log(`\nsample name misses:`);
  for (const m of nameMisses.slice(0, 6)) {
    console.log(`  ${m.record.name.padEnd(24)} ${m.record.team.padEnd(22)} ${m.reason}`);
  }
}
console.log(`\ncbbd calls spent ${client.usage.spent}, cached ${client.usage.cached}`);

// "strong" means a unique national name with a team mismatch. That should be
// transfers, not false positives — worth eyeballing before trusting the number.
const strong = matches.filter((m) => m.confidence === "strong");
console.log(`\nsample "strong" matches (name unique nationally, team differs):`);
for (const m of strong.slice(0, 8)) {
  console.log(`  ${m.record.name.padEnd(22)} rotowire:${m.record.team.padEnd(20)} cbbd:${m.candidate!.team}`);
}
const sameTeamStrong = strong.filter((m) =>
  normaliseTeam(m.record.team) === normaliseTeam(m.candidate!.team)).length;
console.log(`\n  of ${strong.length} strong: ${strong.length - sameTeamStrong} are team changes (transfers), ` +
  `${sameTeamStrong} are same-team name variants (Mikey/Michael, Matt/Matthew)`);

// The index is 2025-26 rosters; RotoWire is reporting 2026-27. Anyone new to
// college basketball cannot be in the index, so check the misses against the
// incoming recruiting class before calling them matcher failures.
const recruits = await client.recruits(2026);
const portal = await client.portal(2026);
const incoming = buildIndex([
  ...recruits.map((r): SourceRecord => ({
    source: "recruit", sourceId: String(r.id), name: r.name, team: r.committedTo ?? r.school ?? "",
  })),
  ...portal.map((t): SourceRecord => ({
    source: "portal", sourceId: String(t.id),
    name: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim(),
    team: t.destination ?? "",
  })),
]);
const explained = failures.filter((m) => (incoming.byName.get(canonicaliseName(m.record.name))?.length ?? 0) > 0);
console.log(`\nof the ${failures.length} unmatched, ${explained.length} appear in the 2026 recruiting class or ` +
  `transfer portal — new to the index, not a matcher failure`);
console.log(`  genuinely unexplained: ${failures.length - explained.length} (${((100 * (failures.length - explained.length)) / n).toFixed(1)}% of all injuries)`);
