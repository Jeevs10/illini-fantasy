import type { Db } from "./client.ts";

/** Postgres caps a statement at 65535 bound parameters. */
const MAX_PARAMS = 60000;

/**
 * Multi-row INSERT, chunked to stay under the parameter limit.
 *
 * Written because per-row round trips are fine against local Docker and
 * ruinous against a remote database: a setup pass doing ~13,000 sequential
 * queries against Neon took minutes, where three batched statements take
 * seconds.
 */
export async function insertMany(
  db: Db,
  { table, columns, rows: input, conflict, dedupeOn }: {
    table: string;
    columns: string[];
    rows: unknown[][];
    /** e.g. `(normalised) DO UPDATE SET name = EXCLUDED.name` or `DO NOTHING`. */
    conflict?: string;
    /**
     * Column indices forming the conflict key. Rows sharing a key are collapsed
     * to the last one, because Postgres rejects a statement whose ON CONFLICT
     * DO UPDATE would touch the same row twice — and sources do repeat: a
     * player can appear on two rosters, two CBBD teams can normalise to one.
     */
    dedupeOn?: number[];
  },
): Promise<number> {
  let rows = input;
  if (rows.length === 0) return 0;

  if (dedupeOn?.length) {
    const byKey = new Map<string, unknown[]>();
    for (const row of rows) byKey.set(dedupeOn.map((i) => String(row[i])).join("\u0000"), row);
    rows = [...byKey.values()];
  }

  const perRow = columns.length;
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / perRow));
  let written = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((row, i) => {
      values.push(...row);
      const base = i * perRow;
      return `(${columns.map((_, c) => `$${base + c + 1}`).join(",")})`;
    });
    const { rowCount } = await db.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}` +
      (conflict ? ` ON CONFLICT ${conflict}` : ""),
      values,
    );
    written += rowCount ?? 0;
  }
  return written;
}

/** Loads a whole lookup table into memory — cheaper than N point queries. */
export async function loadMap<V>(
  db: Db, sql: string, params: unknown[], key: (row: never) => string, value: (row: never) => V,
): Promise<Map<string, V>> {
  const { rows } = await db.query(sql, params);
  return new Map(rows.map((r) => [key(r as never), value(r as never)]));
}
