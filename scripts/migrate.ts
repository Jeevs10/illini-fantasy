/**
 * Applies pending migrations. Uses DATABASE_URL_UNPOOLED when present: Neon's
 * pooler multiplexes sessions, and DDL wants a dedicated connection.
 */
import { connect, migrate } from "@illini/db";
import { loadEnv } from "./env.ts";

loadEnv();


const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("set DATABASE_URL (or DATABASE_URL_UNPOOLED)");

const db = connect(url);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `applied:\n  ${applied.join("\n  ")}` : "already up to date");
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*) n FROM pg_tables WHERE schemaname = 'public'");
  console.log(`public tables: ${rows[0]!.n}`);
} finally {
  await db.end();
}
