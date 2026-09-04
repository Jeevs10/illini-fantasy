-- Trades.
--
-- transaction.kind has carried a 'trade' value since Phase 2, and roster_slot
-- has always closed one tenure and opened another on a date, so the ownership
-- move was never the missing part. What was missing is everything around it:
-- an offer somebody can refuse, a moment it stops being refusable, and a window
-- in which the rest of the league can see what was agreed before it happens.
--
-- Nothing here is scheduled by a daemon either. An accepted trade carries the
-- moment it executes, and the first reader past that moment executes it — the
-- same rule the draft clock and the waiver run already follow, for the same
-- reason: the outcome must not depend on who was awake.

CREATE TABLE IF NOT EXISTS trade (
  id              bigserial PRIMARY KEY,
  league_id       bigint NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  -- The two sides, kept apart because they are not symmetrical: one team made
  -- an offer and the other is being asked, and only the second of those can
  -- accept it.
  from_team_id    bigint NOT NULL,
  to_team_id      bigint NOT NULL,
  status          text NOT NULL DEFAULT 'proposed',
  -- What the proposer said about it. A trade is a negotiation, and the sentence
  -- explaining why the deal is fair is half of what gets it accepted.
  message         text,
  -- Why it ended the way it did, written at settlement and shown verbatim.
  -- 'rejected' is self-explanatory; 'invalid' and 'vetoed' are not, and a
  -- manager whose agreed trade did not happen is owed the difference.
  reason          text,
  -- An offer nobody answers goes stale rather than standing all season.
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  -- When the review window closes and the players actually move. Null until
  -- somebody accepts: an offer has no execution time, only an expiry.
  executes_at     timestamptz,
  -- The date the tenures change hands. Rosters are dated, so a trade has to
  -- name the day, and it is the day of the execution rather than of the offer.
  executed_on     date,
  vetoed_by       bigint REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      bigint REFERENCES app_user(id),
  settled_at      timestamptz,
  CONSTRAINT trade_status_ck CHECK (status IN
    ('proposed', 'accepted', 'rejected', 'cancelled', 'expired', 'vetoed', 'executed', 'invalid')),
  CONSTRAINT trade_sides_ck CHECK (from_team_id <> to_team_id),
  -- The same composite key roster_slot and waiver_claim use, so neither side of
  -- a trade can name a team in another league.
  CONSTRAINT trade_from_league_fk FOREIGN KEY (from_team_id, league_id)
    REFERENCES fantasy_team (id, league_id) ON DELETE CASCADE,
  CONSTRAINT trade_to_league_fk FOREIGN KEY (to_team_id, league_id)
    REFERENCES fantasy_team (id, league_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS trade_league_idx ON trade (league_id, created_at DESC);
-- The two statuses a reader has to act on: offers that may have gone stale, and
-- accepted deals whose window may have closed.
CREATE INDEX IF NOT EXISTS trade_live_idx ON trade (league_id, status)
  WHERE status IN ('proposed', 'accepted');

-- Who is being exchanged, and by whom.
--
-- fantasy_team_id is the side giving him up; the receiving side is the other
-- half of the trade, so it is never stored twice and the two can never drift.
-- One row per player per trade: a man moves one way or he is not in the deal.
CREATE TABLE IF NOT EXISTS trade_item (
  trade_id        bigint NOT NULL REFERENCES trade(id) ON DELETE CASCADE,
  fantasy_team_id bigint NOT NULL REFERENCES fantasy_team(id) ON DELETE CASCADE,
  player_id       bigint NOT NULL REFERENCES player(id),
  PRIMARY KEY (trade_id, player_id)
);
CREATE INDEX IF NOT EXISTS trade_item_player_idx ON trade_item (player_id);
