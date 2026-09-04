import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@illini/db";

/** A pool or a checked-out client — anything that can run one statement. */
export type Queryable = Pick<Db, "query">;

export type Role = "commissioner" | "manager";

export interface Member {
  userId: number;
  email: string;
  displayName: string;
  role: Role;
  fantasyTeamId: number | null;
  fantasyTeamName: string | null;
}

/** An invite's plaintext token exists only in this object, and only once. */
export interface Invite {
  id: number;
  leagueId: number;
  email: string;
  role: Role;
  fantasyTeamId: number | null;
  /** ISO 8601. */
  expiresAt: string;
  /** Present on creation, never on a read — only the hash is stored. */
  token?: string;
}

const INVITE_TTL_DAYS = 14;

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * A free username derived from an address.
 *
 * Every `app_user` carries a username; only some carry a password. A row can be
 * made before its person ever signs in — the commissioner seat `league create`
 * mints, an invite redeemed from the CLI — and giving it a name up front means
 * setting a password later is the only step left, rather than a rename as well.
 */
export async function suggestUsername(db: Queryable, email: string): Promise<string> {
  const cleaned = (email.split("@")[0] ?? "")
    .toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[^a-z0-9]+/, "").slice(0, 20);
  const base = cleaned.length >= 3 ? cleaned : "manager";

  const { rows } = await db.query<{ username: string }>(
    "SELECT username FROM app_user WHERE username LIKE $1", [`${base}%`]);
  const taken = new Set(rows.map((r) => r.username));

  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

/**
 * Registers a user by email, returning the existing row if there is one.
 *
 * Email is the identity here — it is what an invite is addressed to — so a
 * second redemption never mints a second person. The username is what they sign
 * in with, and is only derived when the row is new: renaming somebody because
 * an invite was re-sent would lock them out of their own account.
 */
export async function upsertUser(
  db: Queryable, { email, displayName }: { email: string; displayName?: string },
): Promise<{ id: number; email: string; displayName: string; username: string }> {
  const address = email.trim().toLowerCase();
  const name = displayName?.trim() || address.split("@")[0];

  // Two rows racing for one derived username is possible and rare; the unique
  // index catches it and the second attempt picks the next free name.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { rows } = await db.query<{
        id: string; email: string; display_name: string; username: string;
      }>(
        `INSERT INTO app_user (email, display_name, username) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET display_name =
           COALESCE(NULLIF(EXCLUDED.display_name, ''), app_user.display_name)
         RETURNING id, email, display_name, username`,
        [address, name, await suggestUsername(db, address)],
      );
      const row = rows[0]!;
      return {
        id: Number(row.id), email: row.email,
        displayName: row.display_name, username: row.username,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "23505" || attempt >= 3) throw error;
    }
  }
}

export async function roleOf(db: Db, leagueId: number, userId: number): Promise<Role | null> {
  const { rows } = await db.query<{ role: Role }>(
    "SELECT role FROM league_member WHERE league_id = $1 AND user_id = $2", [leagueId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Throws unless the user is the league's commissioner.
 *
 * Every commissioner-only path calls this rather than checking
 * `league.commissioner_id` directly, so the answer comes from one place and a
 * co-commissioner is a row rather than a schema change.
 */
export async function requireCommissioner(
  db: Db, leagueId: number, userId: number,
): Promise<void> {
  if (await roleOf(db, leagueId, userId) !== "commissioner") {
    throw new Error(`user ${userId} is not a commissioner of league ${leagueId}`);
  }
}

export async function members(db: Db, leagueId: number): Promise<Member[]> {
  const { rows } = await db.query<{
    user_id: string; email: string; display_name: string; role: Role;
    team_id: string | null; team_name: string | null;
  }>(
    `SELECT m.user_id, u.email, u.display_name, m.role,
            t.id AS team_id, t.name AS team_name
       FROM league_member m
       JOIN app_user u ON u.id = m.user_id
       LEFT JOIN fantasy_team t ON t.league_id = m.league_id AND t.owner_id = m.user_id
      WHERE m.league_id = $1
      ORDER BY m.role, u.display_name`,
    [leagueId],
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    fantasyTeamId: r.team_id === null ? null : Number(r.team_id),
    fantasyTeamName: r.team_name,
  }));
}

/**
 * Creates an invite and returns its one-time token.
 *
 * Re-inviting an address supersedes the outstanding invite rather than adding a
 * second: two live links to one seat means revoking the one you remember still
 * leaves the other working.
 */
export async function inviteToLeague(
  db: Db,
  { leagueId, email, invitedBy, role = "manager", fantasyTeamId, ttlDays = INVITE_TTL_DAYS }: {
    leagueId: number; email: string; invitedBy: number; role?: Role;
    fantasyTeamId?: number; ttlDays?: number;
  },
): Promise<Invite> {
  await requireCommissioner(db, leagueId, invitedBy);
  const address = email.trim().toLowerCase();

  if (fantasyTeamId !== undefined) {
    const { rows } = await db.query<{ owner_id: string | null }>(
      "SELECT owner_id FROM fantasy_team WHERE id = $1 AND league_id = $2",
      [fantasyTeamId, leagueId],
    );
    if (rows.length === 0) throw new Error(`team ${fantasyTeamId} is not in league ${leagueId}`);
  }

  const token = randomBytes(32).toString("base64url");
  await db.query(
    `UPDATE league_invite SET revoked_at = now()
      WHERE league_id = $1 AND lower(email) = $2
        AND accepted_at IS NULL AND revoked_at IS NULL`,
    [leagueId, address],
  );

  const { rows } = await db.query<{ id: string; expires_at: Date }>(
    `INSERT INTO league_invite
       (league_id, email, token_hash, role, fantasy_team_id, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
     RETURNING id, expires_at`,
    [leagueId, address, hashToken(token), role, fantasyTeamId ?? null, invitedBy, ttlDays],
  );

  return {
    id: Number(rows[0]!.id),
    leagueId,
    email: address,
    role,
    fantasyTeamId: fantasyTeamId ?? null,
    expiresAt: rows[0]!.expires_at.toISOString(),
    token,
  };
}

export interface AcceptedInvite {
  leagueId: number;
  userId: number;
  role: Role;
  fantasyTeamId: number;
  fantasyTeamName: string;
}

/**
 * Redeems an invite token, joining the user and handing them a team.
 *
 * Runs in one transaction and takes a row lock on the claimed team, because two
 * people opening the same link at once must not end up sharing a roster.
 */
export async function acceptInvite(
  db: Db, { token, email, displayName }: { token: string; email: string; displayName?: string },
): Promise<AcceptedInvite> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: invites } = await client.query<{
      id: string; league_id: string; email: string; role: Role;
      fantasy_team_id: string | null; expired: boolean;
    }>(
      `SELECT id, league_id, email, role, fantasy_team_id, expires_at < now() AS expired
         FROM league_invite
        WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
        FOR UPDATE`,
      [hashToken(token)],
    );
    const invite = invites[0];
    if (!invite) throw new Error("invite not found, already used, or revoked");
    if (invite.expired) throw new Error("invite has expired");

    // The link is addressed to one person. Compared at fixed length so a
    // mismatch cannot be narrowed down by timing.
    const claimed = Buffer.from(hashToken(email.trim().toLowerCase()));
    if (!timingSafeEqual(claimed, Buffer.from(hashToken(invite.email)))) {
      throw new Error("invite was issued to a different email address");
    }

    const leagueId = Number(invite.league_id);
    const user = await upsertUser(client, { email, displayName });

    await client.query(
      `INSERT INTO league_member (league_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (league_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [leagueId, user.id, invite.role],
    );

    // Named team if the invite specified one, otherwise the lowest unclaimed.
    const { rows: teams } = await client.query<{ id: string; name: string }>(
      invite.fantasy_team_id === null
        ? `SELECT id, name FROM fantasy_team
            WHERE league_id = $1 AND owner_id IS NULL
            ORDER BY id LIMIT 1 FOR UPDATE`
        : `SELECT id, name FROM fantasy_team WHERE id = $2 AND league_id = $1 FOR UPDATE`,
      invite.fantasy_team_id === null ? [leagueId] : [leagueId, invite.fantasy_team_id],
    );
    const team = teams[0];
    if (!team) throw new Error(`league ${leagueId} has no unclaimed team left`);

    await client.query("UPDATE fantasy_team SET owner_id = $2 WHERE id = $1", [team.id, user.id]);
    await client.query(
      "UPDATE league_invite SET accepted_at = now(), accepted_by = $2 WHERE id = $1",
      [invite.id, user.id],
    );
    await client.query(
      `INSERT INTO transaction (league_id, kind, payload, created_by)
       VALUES ($1, 'join', $2, $3)`,
      [leagueId, JSON.stringify({ fantasyTeamId: Number(team.id), role: invite.role }), user.id],
    );

    await client.query("COMMIT");
    return {
      leagueId,
      userId: user.id,
      role: invite.role,
      fantasyTeamId: Number(team.id),
      fantasyTeamName: team.name,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeInvite(
  db: Db, { inviteId, byUserId }: { inviteId: number; byUserId: number },
): Promise<boolean> {
  const { rows } = await db.query<{ league_id: string }>(
    "SELECT league_id FROM league_invite WHERE id = $1", [inviteId],
  );
  if (!rows[0]) return false;
  await requireCommissioner(db, Number(rows[0].league_id), byUserId);
  const { rowCount } = await db.query(
    "UPDATE league_invite SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL",
    [inviteId],
  );
  return (rowCount ?? 0) > 0;
}

/** Open invites, without tokens — those are unrecoverable by design. */
export async function openInvites(db: Db, leagueId: number): Promise<Invite[]> {
  const { rows } = await db.query<{
    id: string; email: string; role: Role; fantasy_team_id: string | null; expires_at: Date;
  }>(
    `SELECT id, email, role, fantasy_team_id, expires_at
       FROM league_invite
      WHERE league_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at`,
    [leagueId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    leagueId,
    email: r.email,
    role: r.role,
    fantasyTeamId: r.fantasy_team_id === null ? null : Number(r.fantasy_team_id),
    expiresAt: r.expires_at.toISOString(),
  }));
}

/** A seat in the league: the team, and whoever runs it. */
export interface LeagueTeam {
  id: number;
  name: string;
  ownerId: number | null;
  ownerName: string | null;
  ownerEmail: string | null;
}

/**
 * Every team in the league, claimed or not.
 *
 * Teams are created unowned and a manager takes one by redeeming an invite, so
 * "how many seats are left" is a question about this table rather than about
 * the member list. A commissioner screen needs both sides of it: who to name
 * an invite at, and whether there is anything left to hand out.
 */
export async function teamsInLeague(db: Queryable, leagueId: number): Promise<LeagueTeam[]> {
  const { rows } = await db.query<{
    id: string; name: string;
    owner_id: string | null; owner_name: string | null; owner_email: string | null;
  }>(
    `SELECT t.id, t.name, t.owner_id, u.display_name AS owner_name, u.email AS owner_email
       FROM fantasy_team t
       LEFT JOIN app_user u ON u.id = t.owner_id
      WHERE t.league_id = $1
      ORDER BY t.id`,
    [leagueId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    ownerId: r.owner_id === null ? null : Number(r.owner_id),
    ownerName: r.owner_name,
    ownerEmail: r.owner_email,
  }));
}

/** What an invite says about itself, before anyone commits to redeeming it. */
export interface InvitePreview {
  id: number;
  leagueId: number;
  leagueName: string;
  /** The address the link was issued to. Only this address can redeem it. */
  email: string;
  role: Role;
  fantasyTeamName: string | null;
  expiresAt: string;
  expired: boolean;
}

/**
 * Looks up an open invite by its plaintext token, without redeeming it.
 *
 * Redemption is a one-way door — it claims a team and burns the link — so the
 * page that offers it has to be able to say what is on the other side first.
 * Nothing here is a secret the holder of the token does not already have.
 *
 * Returns null for a token that is unknown, already used, or revoked; the three
 * are deliberately indistinguishable to the caller, since telling them apart
 * only helps someone guessing.
 */
export async function inviteByToken(
  db: Queryable, token: string,
): Promise<InvitePreview | null> {
  const { rows } = await db.query<{
    id: string; league_id: string; league_name: string; email: string; role: Role;
    team_name: string | null; expires_at: Date; expired: boolean;
  }>(
    `SELECT i.id, i.league_id, l.name AS league_name, i.email, i.role,
            t.name AS team_name, i.expires_at, i.expires_at < now() AS expired
       FROM league_invite i
       JOIN league l ON l.id = i.league_id
       LEFT JOIN fantasy_team t ON t.id = i.fantasy_team_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    leagueId: Number(row.league_id),
    leagueName: row.league_name,
    email: row.email,
    role: row.role,
    fantasyTeamName: row.team_name,
    expiresAt: row.expires_at.toISOString(),
    expired: row.expired,
  };
}
