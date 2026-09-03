-- The draft.
--
-- Phase 2 filled rosters with a script: rank the season board, deal it out in
-- snake order, insert. That is a seeding tool, not a draft. A draft is a
-- sequence of decisions made by different people at different times, and the
-- thing that has to be durable is the sequence — who was on the clock, what
-- they took, and what the clock did when nobody was there.

CREATE TABLE IF NOT EXISTS draft (
  id            bigserial PRIMARY KEY,
  -- One draft per league. A re-draft is a new league, not a second board.
  league_id     bigint NOT NULL UNIQUE REFERENCES league(id) ON DELETE CASCADE,
  rounds        integer NOT NULL,
  -- How long a manager has on the clock. Zero means no clock at all, which is
  -- how an offline draft is entered after the fact.
  pick_seconds  integer NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled',
  -- The overall pick number on the clock, 1-based. Past the last pick means
  -- the board is exhausted and the status is 'complete'.
  on_the_clock  integer NOT NULL DEFAULT 1,
  -- When the pick on the clock expires. Null unless the draft is live: a
  -- paused draft has no deadline, which is the whole meaning of paused.
  deadline      timestamptz,
  -- The date a drafted tenure begins. Rosters are dated, so the draft has to
  -- name the day it hands players over.
  opens_on      date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  CONSTRAINT draft_status_ck CHECK (status IN ('scheduled', 'live', 'paused', 'complete')),
  CONSTRAINT draft_rounds_ck CHECK (rounds > 0),
  CONSTRAINT draft_clock_ck CHECK (pick_seconds >= 0)
);

-- The whole board, materialised when the draft is created.
--
-- Every pick exists as a row from the start, with the team that owns it and no
-- player yet. "Who picks 47th" is then a fact to read rather than a snake-order
-- calculation repeated in the engine, the auto-picker and the UI — three places
-- that would have to agree about the same off-by-one.
CREATE TABLE IF NOT EXISTS draft_pick (
  draft_id      bigint NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
  overall       integer NOT NULL,
  round         integer NOT NULL,
  in_round      integer NOT NULL,
  fantasy_team_id bigint NOT NULL REFERENCES fantasy_team(id) ON DELETE CASCADE,
  player_id     bigint REFERENCES player(id),
  made_at       timestamptz,
  -- Whether the clock made this pick rather than a person. Worth keeping: a
  -- manager who wakes up to four autopicks is owed an explanation of which
  -- four.
  auto          boolean NOT NULL DEFAULT false,
  made_by       bigint REFERENCES app_user(id),
  PRIMARY KEY (draft_id, overall)
);
-- A player goes once. roster_slot enforces league-wide ownership already; this
-- is the same rule stated where the draft can see it, so a double pick fails on
-- the board rather than only on the roster.
CREATE UNIQUE INDEX IF NOT EXISTS draft_pick_player_idx
  ON draft_pick (draft_id, player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS draft_pick_team_idx ON draft_pick (draft_id, fantasy_team_id);

-- A manager's private list, in their own order.
--
-- The queue is what makes an autopick defensible: a manager who cannot be at a
-- 9pm draft is not asking the league to guess, they are leaving instructions.
CREATE TABLE IF NOT EXISTS draft_queue (
  draft_id      bigint NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
  fantasy_team_id bigint NOT NULL REFERENCES fantasy_team(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  rank          integer NOT NULL,
  PRIMARY KEY (draft_id, fantasy_team_id, player_id)
);
CREATE INDEX IF NOT EXISTS draft_queue_order_idx
  ON draft_queue (draft_id, fantasy_team_id, rank);
