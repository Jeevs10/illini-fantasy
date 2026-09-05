import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { ScoringConfig } from "@illini/scoring";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export type Db = pg.Pool;

export function connect(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");

  // Local Docker has no TLS; anything remote must verify.
  const local = /@(localhost|127\.0\.0\.1)/.test(url);
  const pool = local
    ? new pg.Pool({ connectionString: url })
    : // Neon's URL carries `sslmode=require`, which pg currently treats as
      // verify-full but will downgrade to libpq semantics in pg v9 — weaker, and
      // silently so. Pin verify-full explicitly so the behaviour cannot change
      // underneath us on a dependency bump.
      new pg.Pool({
        connectionString: (() => {
          const parsed = new URL(url);
          parsed.searchParams.set("sslmode", "verify-full");
          return parsed.toString();
        })(),
      });

  // node-postgres emits 'error' on the pool when an *idle* client's connection
  // drops (e.g. the local Docker Postgres recycling a connection under load).
  // With no listener, that's an unhandled EventEmitter error — it doesn't
  // just fail one request, it takes the whole process's ability to serve any
  // query down with it until restarted. Logging and letting the pool drop the
  // dead client is what node-postgres's own docs prescribe.
  pool.on("error", (error) => {
    console.error("Idle Postgres client errored", error);
  });

  return pool;
}

/** Applies any migration not yet recorded, in filename order, each in a transaction. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migration");
  const done = new Set(rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

/** Stable digest: key order must not change the identity of a config. */
export function digestConfig(config: ScoringConfig): string {
  const canonical = JSON.stringify(config, (_, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : value);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Registers a config, returning the existing row if an identical one is stored.
 * Configs are immutable: editing weights creates a new version, because settled
 * matchups reference the version that scored them.
 */
export async function upsertScoringConfig(
  db: Db, label: string, config: ScoringConfig, createdBy?: string,
): Promise<{ id: number; digest: string; created: boolean }> {
  const digest = digestConfig(config);
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM scoring_config WHERE digest = $1", [digest],
  );
  if (existing.rows[0]) return { id: Number(existing.rows[0].id), digest, created: false };

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO scoring_config (label, config, digest, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [label, JSON.stringify(config), digest, createdBy ?? null],
  );
  return { id: Number(inserted.rows[0]!.id), digest, created: true };
}
