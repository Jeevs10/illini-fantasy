import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "@auth/core/adapters";
import type { Db } from "@illini/db";

/**
 * Auth.js over this project's own tables.
 *
 * The stock Postgres adapter brings its own `users` table with quoted camelCase
 * columns. That would mean two identities per person — the thing the player
 * crosswalk exists to avoid — so the adapter maps onto `app_user` instead, and
 * `league_member.user_id` points at the same row a session does.
 */

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  email_verified: Date | null;
  image: string | null;
}

const toUser = (row: UserRow): AdapterUser => ({
  id: String(row.id),
  email: row.email,
  name: row.display_name,
  emailVerified: row.email_verified,
  image: row.image,
});

const USER_COLUMNS = "id, email, display_name, email_verified, image";

export function PostgresAdapter(db: Db): Adapter {
  const one = async (sql: string, params: unknown[]): Promise<AdapterUser | null> => {
    const { rows } = await db.query<UserRow>(sql, params);
    return rows[0] ? toUser(rows[0]) : null;
  };

  return {
    async createUser(user) {
      // display_name is NOT NULL — a magic link carries an address and nothing
      // else, so the local part stands in until the invite supplies a name.
      const { rows } = await db.query<UserRow>(
        `INSERT INTO app_user (email, display_name, email_verified, image)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           email_verified = COALESCE(app_user.email_verified, EXCLUDED.email_verified)
         RETURNING ${USER_COLUMNS}`,
        [user.email, user.name ?? user.email.split("@")[0], user.emailVerified ?? null,
         user.image ?? null],
      );
      return toUser(rows[0]!);
    },

    getUser: (id) => one(`SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1`, [id]),

    getUserByEmail: (email) =>
      one(`SELECT ${USER_COLUMNS} FROM app_user WHERE email = $1`, [email.toLowerCase()]),

    getUserByAccount: ({ provider, providerAccountId }) =>
      one(
        `SELECT ${USER_COLUMNS.split(", ").map((c) => `u.${c}`).join(", ")}
           FROM auth_account a JOIN app_user u ON u.id = a.user_id
          WHERE a.provider = $1 AND a.provider_account_id = $2`,
        [provider, providerAccountId],
      ),

    async updateUser(user) {
      const { rows } = await db.query<UserRow>(
        `UPDATE app_user SET
           email = COALESCE($2, email),
           display_name = COALESCE($3, display_name),
           email_verified = COALESCE($4, email_verified),
           image = COALESCE($5, image)
         WHERE id = $1 RETURNING ${USER_COLUMNS}`,
        [user.id, user.email ?? null, user.name ?? null, user.emailVerified ?? null,
         user.image ?? null],
      );
      return toUser(rows[0]!);
    },

    async deleteUser(id) {
      await db.query("DELETE FROM app_user WHERE id = $1", [id]);
    },

    async linkAccount(account: AdapterAccount) {
      await db.query(
        `INSERT INTO auth_account (user_id, provider, provider_account_id, type,
           refresh_token, access_token, expires_at, token_type, scope, id_token, session_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (provider, provider_account_id) DO UPDATE SET
           access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at`,
        [account.userId, account.provider, account.providerAccountId, account.type,
         account.refresh_token ?? null, account.access_token ?? null,
         account.expires_at ?? null, account.token_type ?? null, account.scope ?? null,
         account.id_token ?? null, account.session_state ?? null],
      );
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db.query(
        "DELETE FROM auth_account WHERE provider = $1 AND provider_account_id = $2",
        [provider, providerAccountId]);
    },

    async createSession(session) {
      await db.query(
        "INSERT INTO auth_session (session_token, user_id, expires) VALUES ($1,$2,$3)",
        [session.sessionToken, session.userId, session.expires]);
      return session;
    },

    async getSessionAndUser(sessionToken) {
      const { rows } = await db.query<UserRow & { expires: Date; user_id: string }>(
        `SELECT s.expires, s.user_id, u.id, u.email, u.display_name, u.email_verified, u.image
           FROM auth_session s JOIN app_user u ON u.id = s.user_id
          WHERE s.session_token = $1`,
        [sessionToken]);
      const row = rows[0];
      if (!row) return null;
      const session: AdapterSession = {
        sessionToken, userId: String(row.user_id), expires: row.expires,
      };
      return { session, user: toUser(row) };
    },

    async updateSession({ sessionToken, expires, userId }) {
      const { rows } = await db.query<{ session_token: string; user_id: string; expires: Date }>(
        `UPDATE auth_session SET
           expires = COALESCE($2, expires), user_id = COALESCE($3, user_id)
         WHERE session_token = $1 RETURNING session_token, user_id, expires`,
        [sessionToken, expires ?? null, userId ?? null]);
      const row = rows[0];
      return row
        ? { sessionToken: row.session_token, userId: String(row.user_id), expires: row.expires }
        : null;
    },

    async deleteSession(sessionToken) {
      await db.query("DELETE FROM auth_session WHERE session_token = $1", [sessionToken]);
    },

    async createVerificationToken(token) {
      await db.query(
        `INSERT INTO auth_verification_token (identifier, token, expires) VALUES ($1,$2,$3)
         ON CONFLICT (identifier, token) DO UPDATE SET expires = EXCLUDED.expires`,
        [token.identifier, token.token, token.expires]);
      return token;
    },

    /**
     * Redeems a magic link. The DELETE is the check: a token can be spent
     * exactly once, and two clicks race in the database rather than in Node.
     */
    async useVerificationToken({ identifier, token }) {
      const { rows } = await db.query<{ identifier: string; token: string; expires: Date }>(
        `DELETE FROM auth_verification_token
          WHERE identifier = $1 AND token = $2
          RETURNING identifier, token, expires`,
        [identifier, token]);
      return rows[0] ?? null;
    },
  };
}
