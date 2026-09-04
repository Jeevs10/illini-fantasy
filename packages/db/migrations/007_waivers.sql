-- Waivers and free agency.
--
-- roster_slot and transaction have modelled the claim/release lifecycle since
-- Phase 2, and claimPlayer / releasePlayer have enforced it. What was missing
-- is the part that makes a claim a contest rather than a race: a blind bid,
-- a moment when every bid is opened at once, and a rule for who wins.
--
-- Nothing here is scheduled by a daemon, for the same reason the draft clock is
-- not. Claims carry the run that will resolve them, and the first reader past
-- that run resolves it — so the outcome is the same whether somebody was
-- watching at 4am or nobody was, and the whole thing is testable by passing a
-- different `now`.

-- ---------------------------------------------------------------------------
-- Waiver priority
--
-- FAAB decides almost every claim on the bid alone. Priority is the tiebreak,
-- and it rolls: the team that wins a tie goes to the back of the line, so the
-- same team cannot win every coin flip all season. Stored rather than derived
-- because it is a consequence of history, not a function of the standings.
-- ---------------------------------------------------------------------------

ALTER TABLE fantasy_team ADD COLUMN IF NOT EXISTS waiver_priority integer;

UPDATE fantasy_team t SET waiver_priority = ranked.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY league_id ORDER BY id) AS rn
          FROM fantasy_team) ranked
 WHERE ranked.id = t.id AND t.waiver_priority IS NULL;

-- ---------------------------------------------------------------------------
-- The wire
--
-- A dropped player does not become free the instant somebody drops him — that
-- rewards whoever is awake, which is the behaviour waivers exist to remove. He
-- sits here until the run named by clears_at, claimable by bid until then and
-- an ordinary free agent afterwards.
--
-- A row is the whole fact. Deleting it is how a player clears, so the wire is
-- always exactly what it says it is rather than a table that has to be read
-- through a date filter to be believed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS waiver_wire (
  league_id     bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES player(id),
  -- Who dropped him, and when. Kept for the transaction log's sake: "claimed
  -- off waivers from X" is a more useful sentence than "claimed".
  dropped_by    bigint REFERENCES fantasy_team(id) ON DELETE SET NULL,
  dropped_at    timestamptz NOT NULL DEFAULT now(),
  clears_at     timestamptz NOT NULL,
  PRIMARY KEY (league_id, player_id)
);
CREATE INDEX IF NOT EXISTS waiver_wire_clears_idx ON waiver_wire (clears_at);

-- ---------------------------------------------------------------------------
-- Claims
--
-- A bid is sealed: nobody sees another team's number until the run opens all of
-- them together. That is the only reason the bid column can be trusted, and it
-- is why claims are resolved in a batch rather than as they arrive.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS waiver_claim (
  id              bigserial PRIMARY KEY,
  league_id       bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  fantasy_team_id bigint NOT NULL,
  player_id       bigint NOT NULL REFERENCES player(id),
  -- Who comes off to make room. Null is legal only while the roster has room,
  -- and that is checked when the claim is resolved rather than when it is made:
  -- a roster that is full on Tuesday may not be on Thursday.
  drop_player_id  bigint REFERENCES player(id),
  bid             integer NOT NULL,
  -- The team's own order for its own claims. A manager with four claims and
  -- room for two is telling us which two.
  sequence        integer NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  -- Why a claim lost. Written at resolution and shown verbatim: a manager who
  -- was outbid, priced out or beaten to the player is owed the difference.
  reason          text,
  -- The run that will open this bid. Set when the claim is made, so a claim
  -- knows which batch it is in and a batch is a fact rather than a time window
  -- recomputed at read time.
  runs_at         timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      bigint REFERENCES app_user(id),
  settled_at      timestamptz,
  CONSTRAINT waiver_claim_status_ck
    CHECK (status IN ('pending', 'won', 'lost', 'invalid', 'cancelled')),
  CONSTRAINT waiver_claim_bid_ck CHECK (bid >= 0),
  -- The same composite key roster_slot uses, so a claim cannot name a team in
  -- another league.
  CONSTRAINT waiver_claim_team_league_fk
    FOREIGN KEY (fantasy_team_id, league_id) REFERENCES fantasy_team (id, league_id)
    ON DELETE CASCADE
);

-- One live bid per team per player. Raising a bid is an update, not a second
-- row, so a team cannot accidentally hold two prices for one man.
CREATE UNIQUE INDEX IF NOT EXISTS waiver_claim_open_idx
  ON waiver_claim (fantasy_team_id, player_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS waiver_claim_batch_idx
  ON waiver_claim (league_id, runs_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS waiver_claim_team_idx
  ON waiver_claim (fantasy_team_id, created_at DESC);
