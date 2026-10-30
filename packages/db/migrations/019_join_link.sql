-- A league join link: one invite anyone holding it can redeem, until every
-- team has a manager.
--
-- A shared invite names no address, can be redeemed more than once (so it is
-- never marked accepted), and only ever makes managers of the next unclaimed
-- team. Its plaintext token is kept, unlike a personal invite's: the link is
-- meant to be posted where the league talks, so the commissioner has to be
-- able to copy it again, and storing it hides nothing its holders lack.

ALTER TABLE league_invite ALTER COLUMN email DROP NOT NULL;
ALTER TABLE league_invite ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;
ALTER TABLE league_invite ADD COLUMN IF NOT EXISTS share_token text;

ALTER TABLE league_invite DROP CONSTRAINT IF EXISTS league_invite_shared_ck;
ALTER TABLE league_invite ADD CONSTRAINT league_invite_shared_ck CHECK (
  CASE WHEN shared
    THEN email IS NULL AND role = 'manager' AND fantasy_team_id IS NULL AND share_token IS NOT NULL
    ELSE email IS NOT NULL AND share_token IS NULL
  END
);

-- One live join link per league; making a new one revokes the old.
CREATE UNIQUE INDEX IF NOT EXISTS league_invite_one_link_idx
  ON league_invite (league_id) WHERE shared AND revoked_at IS NULL;
