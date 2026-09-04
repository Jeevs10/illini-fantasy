-- Usernames and passwords, in place of magic links.
--
-- Sign-in was an emailed link: the invite and the session were one mechanism.
-- That is a fine story and a bad door — a league is played on a phone late at
-- night, and a round trip through an inbox is slower and less reliable than a
-- password manager. Credentials live here now.
--
-- The invite link survives. It hands over a *team*, not a session: redeeming
-- one is where a manager picks their username. What it no longer proves is
-- ownership of the mailbox it was addressed to, so the token is the whole
-- credential — deliberate, for a link a commissioner passes to somebody they
-- already know.

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash text;

-- Backfill: the local part of the address, stripped to the allowed alphabet and
-- numbered when two addresses collapse onto the same name. Existing rows have
-- no password, which is the correct state — they cannot sign in until a
-- commissioner sets one (`npm run league -- passwd`) or they redeem an invite.
WITH candidate AS (
  SELECT id, base, row_number() OVER (PARTITION BY base ORDER BY id) AS n
    FROM (
      SELECT id,
             CASE WHEN length(cleaned) >= 3 THEN left(cleaned, 20) ELSE 'manager' || id END
               AS base
        FROM (
          SELECT id, regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g')
                       AS cleaned
            FROM app_user
           WHERE username IS NULL
        ) stripped
    ) based
)
UPDATE app_user u
   SET username = CASE WHEN c.n = 1 THEN c.base ELSE c.base || c.n::text END
  FROM candidate c
 WHERE c.id = u.id;

-- A leading character that is not punctuation, so a name cannot be `-` or `..`.
DO $$ BEGIN
  ALTER TABLE app_user ADD CONSTRAINT app_user_username_ck
    CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,23}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE app_user ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_user_username_idx ON app_user (username);

-- What the magic link needed and nothing does now.
--
-- `auth_session` stays: sessions are still rows, so signing out on a lost phone
-- is a DELETE rather than a token nobody can recall. `auth_account` held OAuth
-- links that were never issued, `auth_verification_token` held the links
-- themselves, and `email_verified` / `image` were columns the Auth.js adapter
-- required rather than anything this league displays.
DROP TABLE IF EXISTS auth_verification_token;
DROP TABLE IF EXISTS auth_account;
ALTER TABLE app_user DROP COLUMN IF EXISTS email_verified;
ALTER TABLE app_user DROP COLUMN IF EXISTS image;

-- Every session that exists right now was minted by Auth.js and lives in a
-- cookie by a name nothing reads any more. They are unreachable rather than
-- dangerous, but a row nobody can use should not sit there for thirty days
-- looking like somebody is signed in. Replacing the front door means everyone
-- signs in again.
DELETE FROM auth_session;

-- Sessions are swept on sign-in, but an index makes the sweep and the lookup
-- cheap enough not to think about.
CREATE INDEX IF NOT EXISTS auth_session_expires_idx ON auth_session (expires);
