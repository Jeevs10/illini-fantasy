import { connect } from "@illini/db";
import { loadEnv } from "./env.ts";
loadEnv();
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
console.table((await db.query(`SELECT id, username, display_name, email,
  (password_hash IS NOT NULL) AS has_password FROM app_user ORDER BY id`)).rows);
await db.end();
