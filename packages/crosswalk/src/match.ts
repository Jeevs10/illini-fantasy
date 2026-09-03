import { canonicaliseName, normaliseTeam } from "./normalise.ts";

/** A player as one source describes them. */
export interface SourceRecord {
  source: string;
  sourceId: string;
  name: string;
  team: string;
  position?: string | null;
  classYear?: string | null;
}

export type Confidence = "exact" | "strong" | "weak" | "none";

export interface Match {
  record: SourceRecord;
  candidate: SourceRecord | null;
  confidence: Confidence;
  /** Why it matched, or why it didn't — shown in the review queue. */
  reason: string;
}

/** Damerau-free Levenshtein, bounded: we only care about small edits. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** First initial plus last name — catches "Mike" vs "Michael". */
function initialLast(name: string): string {
  const parts = canonicaliseName(name).split(" ").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]![0]} ${parts.at(-1)}`;
}

export interface Index {
  byNameTeam: Map<string, SourceRecord[]>;
  byName: Map<string, SourceRecord[]>;
  byInitialLastTeam: Map<string, SourceRecord[]>;
}

const push = <T>(m: Map<string, T[]>, k: string, v: T): void => {
  const list = m.get(k);
  if (list) list.push(v); else m.set(k, [v]);
};

export function buildIndex(records: SourceRecord[]): Index {
  const index: Index = {
    byNameTeam: new Map(), byName: new Map(), byInitialLastTeam: new Map(),
  };
  for (const r of records) {
    const name = canonicaliseName(r.name);
    const team = normaliseTeam(r.team);
    push(index.byNameTeam, `${name}|${team}`, r);
    push(index.byName, name, r);
    push(index.byInitialLastTeam, `${initialLast(r.name)}|${team}`, r);
  }
  return index;
}

/**
 * Resolve one record against an index, in descending order of certainty.
 *
 * Scoped matching is far more reliable than global matching: within one team
 * the candidate pool is ~15 names rather than ~5,000, so a fuzzy match that
 * would be reckless nationally is safe here. That is also why the shot feed
 * helps — its GameSourceId is an ESPN event id, so players can be matched
 * inside a single game.
 */
export function resolve(record: SourceRecord, index: Index): Match {
  const name = canonicaliseName(record.name);
  const team = normaliseTeam(record.team);

  const exact = index.byNameTeam.get(`${name}|${team}`);
  if (exact?.length === 1) {
    return { record, candidate: exact[0]!, confidence: "exact", reason: "name and team" };
  }
  if (exact && exact.length > 1) {
    return { record, candidate: null, confidence: "none", reason: `${exact.length} players share this name on this team` };
  }

  // Same name, exactly one player nationally — safe even when the team differs,
  // which is usually a transfer rather than a mismatch.
  const byName = index.byName.get(name);
  if (byName?.length === 1) {
    const sameTeam = normaliseTeam(byName[0]!.team) === team;
    return {
      record, candidate: byName[0]!, confidence: "strong",
      reason: sameTeam
        ? "unique name nationally; same team, name spelled differently"
        : `unique name nationally; likely transfer (${record.team} -> ${byName[0]!.team})`,
    };
  }

  // Nickname or initial variation, scoped to the team.
  const scoped = index.byInitialLastTeam.get(`${initialLast(record.name)}|${team}`);
  if (scoped?.length === 1) {
    return { record, candidate: scoped[0]!, confidence: "strong", reason: "first initial and surname, same team" };
  }

  // Spelling drift, scoped to the team.
  const sameTeam = [...index.byNameTeam.entries()]
    .filter(([k]) => k.endsWith(`|${team}`))
    .flatMap(([, v]) => v);
  const near = sameTeam
    .map((c) => ({ c, d: editDistance(name, canonicaliseName(c.name)) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d);
  if (near.length === 1 || (near.length > 1 && near[0]!.d < near[1]!.d)) {
    return { record, candidate: near[0]!.c, confidence: "weak", reason: `edit distance ${near[0]!.d}, same team` };
  }

  if (byName && byName.length > 1) {
    return { record, candidate: null, confidence: "none", reason: `${byName.length} national name collisions, no team match` };
  }
  return {
    record, candidate: null, confidence: "none",
    reason: sameTeam.length === 0 ? `team not in index (${record.team})` : "no candidate",
  };
}

export function resolveAll(records: SourceRecord[], index: Index): Match[] {
  return records.map((r) => resolve(r, index));
}

export const summarise = (matches: Match[]): Record<Confidence, number> => {
  const out: Record<Confidence, number> = { exact: 0, strong: 0, weak: 0, none: 0 };
  for (const m of matches) out[m.confidence] += 1;
  return out;
};
