-- Membership, invites and the lineup lock.
--
-- Phase 2 built the league mechanics with one user owning every team, lineups
-- written after the games were played, and nothing stopping two teams from
-- rostering the same player. This migration closes all three.

-- ---------------------------------------------------------------------------
-- Identity
--
-- app_user doubles as the Auth.js user table rather than sitting beside a
-- second one. This project already carries a crosswalk because four sources
-- mint their own player ids; there is no reason to repeat that mistake for
-- humans. The adapter maps camelCase to these columns.
-- ---------------------------------------------------------------------------

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email_verified timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS image text;

CREATE TABLE IF NOT EXISTS auth_account (
  user_id            bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider           text NOT NULL,
  provider_account_id text NOT NULL,
  type               text NOT NULL,
  refresh_token      text,
  access_token       text,
  expires_at         bigint,
  token_type         text,
  scope              text,
  id_token           text,
  session_state      text,
  PRIMARY KEY (provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS auth_account_user_idx ON auth_account (user_id);

CREATE TABLE IF NOT EXISTS auth_session (
  session_token text PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires       timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_session (user_id);

-- Magic-link tokens. Auth.js hashes these before storing, so a leak of this
-- table does not hand out live sign-in links.
CREATE TABLE IF NOT EXISTS auth_verification_token (
  identifier text NOT NULL,
  token      text NOT NULL,
  expires    timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ---------------------------------------------------------------------------
-- Membership and invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS league_member (
  league_id  bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'manager',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id),
  CONSTRAINT league_member_role_ck CHECK (role IN ('commissioner', 'manager'))
);

-- Only the hash is stored: the plaintext token is shown once, at the moment the
-- invite is created, and is unrecoverable afterwards. An emailed link is a
-- bearer credential, and this table is the one most likely to be dumped into a
-- commissioner screen.
CREATE TABLE IF NOT EXISTS league_invite (
  id              bigserial PRIMARY KEY,
  league_id       bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  email           text NOT NULL,
  token_hash      text NOT NULL UNIQUE,
  role            text NOT NULL DEFAULT 'manager',
  -- Which team the invitee takes over. Null means the next unclaimed one.
  fantasy_team_id bigint REFERENCES fantasy_team(id) ON DELETE SET NULL,
  invited_by      bigint REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  accepted_by     bigint REFERENCES app_user(id),
  revoked_at      timestamptz,
  CONSTRAINT league_invite_role_ck CHECK (role IN ('commissioner', 'manager'))
);
CREATE INDEX IF NOT EXISTS league_invite_league_idx ON league_invite (league_id);
-- One live invite per address per league; a resend supersedes rather than
-- accumulates, so revoking one link cannot leave a forgotten second one valid.
CREATE UNIQUE INDEX IF NOT EXISTS league_invite_open_idx
  ON league_invite (league_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Backfill: whoever created the existing leagues is their commissioner.
INSERT INTO league_member (league_id, user_id, role)
SELECT id, commissioner_id, 'commissioner' FROM league WHERE commissioner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- One player, one team, per league
--
-- The old index was unique on (fantasy_team_id, player_id), which stops a team
-- rostering the same player twice but happily lets two teams in one league both
-- own him. Enforcing it league-wide needs league_id on the row; the composite
-- foreign key back to fantasy_team is what keeps that copy honest, so no
-- trigger is required and the two can never drift.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE fantasy_team ADD CONSTRAINT fantasy_team_id_league_key UNIQUE (id, league_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

ALTER TABLE roster_slot ADD COLUMN IF NOT EXISTS league_id bigint;
UPDATE roster_slot r SET league_id = t.league_id
  FROM fantasy_team t WHERE t.id = r.fantasy_team_id AND r.league_id IS NULL;
ALTER TABLE roster_slot ALTER COLUMN league_id SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE roster_slot ADD CONSTRAINT roster_slot_team_league_fk
    FOREIGN KEY (fantasy_team_id, league_id) REFERENCES fantasy_team (id, league_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP INDEX IF EXISTS roster_slot_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS roster_slot_owned_idx
  ON roster_slot (league_id, player_id) WHERE released_on IS NULL;

-- ---------------------------------------------------------------------------
-- The lineup lock
--
-- The league locks per game at tip-off, Sleeper-style, not once a week. That
-- needs a tip-off time, which the schema did not carry: game held a date only,
-- so the earliest a lineup could be judged legal was the following morning.
-- CBBD has been returning startDate all along.
-- ---------------------------------------------------------------------------

ALTER TABLE game ADD COLUMN IF NOT EXISTS tipoff timestamptz;
CREATE INDEX IF NOT EXISTS game_tipoff_idx ON game (tipoff);

-- Which game a started player was started for. Recorded at write time so the
-- lock can be evaluated before any box score exists — the old lineup path
-- joined player_game_stat, which is to say it could only set a lineup for
-- games that had already been played.
ALTER TABLE lineup_entry ADD COLUMN IF NOT EXISTS game_id bigint REFERENCES game(id);
