import { connect, type Db } from "@illini/db";

/**
 * One pool for the process.
 *
 * Cached on globalThis because dev-mode hot reload re-evaluates modules on
 * every edit, and a fresh pool per reload exhausts Neon's connection limit
 * within a few saves.
 */
const globalForDb = globalThis as unknown as { illiniDb?: Db };

export const db: Db =
  globalForDb.illiniDb ??
  connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") globalForDb.illiniDb = db;
