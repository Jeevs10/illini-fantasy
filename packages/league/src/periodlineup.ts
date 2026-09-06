import type { Db } from "@illini/db";
import { GAME_CONFIG, archetypeFor, type Archetype, type ScoringConfig } from "@illini/scoring";
import {
  DEFAULT_SETTINGS, autoFill, isEligible, validateLineup,
  type LeagueSettings, type LineupSlot, type Slot,
} from "./slots.ts";
import { InvalidLineupError, LineupLockedError, NotOnRosterError } from "./lineups.ts";
import { nightState, type GameState } from "./outlook.ts";

/**
 * The lineup as a decision about the week, not about a night.
 *
 * A manager picks seven players and those seven are their team for the period.
 * Everything each of them plays in it counts, which is what `scorePeriod` now
 * settles — so the question asked here and the question answered there are for
 * the first time the same question.
 *
 * The nightly module this sits beside is not gone and is not deprecated: a
 * night is still the unit a game is played on, still what locks, and still what
 * `/home` shows for tonight. What changed is who decides. A slot assignment is
 * made once for the period and then written across each of that player's game
 * nights inside it, so `lineup_entry` keeps its shape — one row per player per
 * night, carrying the game it was started for — while ceasing to be seven
 * separate decisions a manager has to remember to make.
 *
 * Storing it that way rather than in a new week-keyed table is deliberate.
 * Settlement, the outlook, the standings and five seasons of existing rows all
 * read lineups by date; a second source of truth for the same fact would have
 * to be reconciled with them on every read, and the reconciliation is where the
 * bugs would live. The period is the input, the nights are the storage.
 */

/** One of a starter's games inside the period. */
export interface PeriodGame {
  gameId: number;
  playedOn: string;
  /** ISO 8601, or null when the schedule carries a date but no tip-off time. */
  tipoff: string | null;
  opponent: string | null;
  opponentStrength: number | null;
  /** The filed box score, or null for a night not yet played or not yet in. */
  score: number | null;
  /**
   * Where the night stands as of the clock this was read under.
   *
   * Resolved here rather than in the browser, and from the app's clock rather
   * than the wall clock, because those are two different questions and the
   * screens kept answering the second one. A component comparing a tip-off to
   * `new Date()` cannot tell a game under way from a game that finished in
   * November — both have a tip-off in the past — so a week months behind us
   * read as live for every starter who happened to miss a night.
   */
  state: GameState;
  /** What form expects from this night, for the ones with no score. */
  projected: number;
  /**
   * Whether this particular night was started.
   *
   * Per night rather than per player because the two can disagree. A lineup set
   * for the week starts a player on every night he plays, so they agree by
   * construction — but a week whose lineups were set a night at a time can have
   * started him on Monday and left him benched on Thursday, and Thursday's
   * points did not count. Settlement reads exactly these rows, so anything that
   * totals a week has to read them the same way or report a week that never
   * happened.
   */
  started: boolean;
}

export interface PeriodStarter {
  playerId: number;
  name: string;
  archetype: Archetype;
  /** The Torvik role string — what governs slot eligibility. */
  role: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  /** What he is set to for the period. */
  slot: Slot;
  /** His games inside the period, soonest first. */
  games: PeriodGame[];
  /** What he has actually banked so far. */
  scored: number;
  /**
   * Where his week lands — banked, plus form for the nights still to come.
   * This is what auto-fill ranks on, because it is what the week will be
   * scored on.
   */
  projected: number;
  /**
   * Frozen for the period. True once his first game in it has tipped off or
   * filed a box score: he has begun contributing, and a lineup decision cannot
   * be taken back after the points have started landing. Players who have not
   * played yet stay movable, so a Tuesday injury can still be answered with
   * somebody who plays on Thursday.
   */
  locked: boolean;
  /** The tip-off that locked him, when a clock is what did it. */
  lockedAt: string | null;
}

export interface PeriodLineupResult {
  from: string;
  to: string;
  entries: LineupSlot[];
  locked: number[];
}

/**
 * Everyone on the roster with at least one game in the period, and what they
 * are set to.
 *
 * A player whose real team does not play at all this period is not here: there
 * is no game for him to be started for, so he is bench by construction rather
 * than by decision. The screens list him separately.
 */
export async function startableInPeriod(
  db: Db,
  { fantasyTeamId, from, to, configId, config = GAME_CONFIG, now = new Date() }: {
    fantasyTeamId: number; from: string; to: string; configId: number;
    config?: ScoringConfig; now?: Date;
  },
): Promise<PeriodStarter[]> {
  const today = now.toISOString().slice(0, 10);
  // Whose roster: the one that applies inside the period. A finished week is
  // read with the players who were actually owned then — a March trade must not
  // rewrite who was starting in January — and a week still ahead with the
  // roster as it stands now, which is the only one anybody could be picking.
  const asOf = today < from ? from : today > to ? to : today;

  const { rows } = await db.query<{
    player_id: string; name: string; role: string | null; archetype: Archetype | null;
    primary_color: string | null; secondary_color: string | null; slot: Slot | null;
    game_id: string; played_on: string; tipoff: Date | null;
    opponent: string | null; opponent_strength: number | null;
    score: number | null; projected: number | null;
  }>(
    `WITH roster AS (
       SELECT r.player_id, p.name, p.team_id
         FROM roster_slot r
         JOIN player p ON p.id = r.player_id
        WHERE r.fantasy_team_id = $1
          AND r.acquired_on <= $4
          AND (r.released_on IS NULL OR r.released_on > $4)
     ),
     slate AS (
       SELECT g.id AS game_id, g.played_on, g.tipoff, g.season,
              g.home_team_id AS team_id, g.away_team_id AS opponent_id
         FROM game g WHERE g.played_on BETWEEN $2 AND $3
       UNION ALL
       SELECT g.id, g.played_on, g.tipoff, g.season, g.away_team_id, g.home_team_id
         FROM game g WHERE g.played_on BETWEEN $2 AND $3
     )
     SELECT roster.player_id, roster.name,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = roster.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role,
            form.archetype,
            own.primary_color, own.secondary_color,
            l.slot,
            slate.game_id, to_char(slate.played_on, 'YYYY-MM-DD') AS played_on, slate.tipoff,
            opp.name AS opponent, rating.strength AS opponent_strength,
            -- A score dated after today is the season's future, not this
            -- night's result: the same barrier the outlook reads under.
            CASE WHEN slate.played_on <= $6 THEN filed.score ELSE NULL END AS score,
            form.projected
       FROM roster
       JOIN slate ON slate.team_id = roster.team_id
       LEFT JOIN team opp ON opp.id = slate.opponent_id
       LEFT JOIN team own ON own.id = roster.team_id
       LEFT JOIN player_game_score filed
         ON filed.player_id = roster.player_id AND filed.played_on = slate.played_on
        AND filed.config_id = $5
       LEFT JOIN lineup_entry l
         ON l.fantasy_team_id = $1 AND l.player_id = roster.player_id
        AND l.played_on = slate.played_on
       LEFT JOIN LATERAL (
         SELECT strength FROM team_rating tr
          WHERE tr.team_id = slate.opponent_id AND tr.season = slate.season
            AND tr.as_of <= slate.played_on
          ORDER BY tr.as_of DESC LIMIT 1
       ) rating ON true
       LEFT JOIN LATERAL (
         SELECT avg(sc.score) AS projected,
                (array_agg(sc.archetype ORDER BY sc.played_on DESC))[1] AS archetype
           FROM player_game_score sc
          WHERE sc.player_id = roster.player_id AND sc.config_id = $5
            AND sc.played_on < LEAST(slate.played_on, $6::date)
       ) form ON true
      ORDER BY roster.player_id, slate.played_on, slate.tipoff NULLS LAST`,
    [fantasyTeamId, from, to, asOf, configId, today],
  );

  const byPlayer = new Map<number, PeriodStarter>();
  // The first starting slot each player's nights name, kept as the rows go by
  // so the slot does not have to be searched for again afterwards.
  const slotOf = new Map<number, Slot>();
  for (const r of rows) {
    const playerId = Number(r.player_id);
    const projected = r.projected === null ? 0 : Number(r.projected);
    const night = {
      playedOn: r.played_on,
      tipoff: r.tipoff === null ? null : r.tipoff.toISOString(),
      score: r.score === null ? null : Number(r.score),
    };
    const game: PeriodGame = {
      gameId: Number(r.game_id),
      ...night,
      opponent: r.opponent,
      opponentStrength: r.opponent_strength === null ? null : Number(r.opponent_strength),
      state: nightState(night, now),
      projected,
      started: r.slot !== null && r.slot !== "BENCH" && r.slot !== "IR",
    };
    if (game.started && !slotOf.has(playerId)) slotOf.set(playerId, r.slot!);

    const held = byPlayer.get(playerId);
    if (held === undefined) {
      byPlayer.set(playerId, {
        playerId,
        name: r.name,
        archetype: r.archetype ?? archetypeFor(r.role, config),
        role: r.role,
        primaryColor: r.primary_color,
        secondaryColor: r.secondary_color,
        // Resolved below from whichever nights say he started: a weekly
        // lineup writes the same slot to all of them, but legacy nightly rows
        // can start him on one night and bench him on the next.
        slot: "BENCH",
        games: [game],
        scored: 0,
        projected: 0,
        locked: false,
        lockedAt: null,
      });
      continue;
    }
    // One row per player per night: a team on the schedule twice that day is
    // one game night, and the earlier tip is the one whose clock matters.
    if (!held.games.some((g) => g.playedOn === game.playedOn)) held.games.push(game);
  }

  for (const starter of byPlayer.values()) {
    starter.games.sort((a, b) => (a.playedOn === b.playedOn
      ? (a.tipoff ?? "~").localeCompare(b.tipoff ?? "~")
      : a.playedOn.localeCompare(b.playedOn)));

    // The slot he holds for the period is whichever starting slot his nights
    // name. A player only ever benched — or with no row at all — has not been
    // picked, which is bench.
    starter.slot = slotOf.get(starter.playerId) ?? "BENCH";

    // Banked: only nights he was actually started, which is precisely what
    // `scorePeriod` counts. Summing every night he played instead would credit
    // a legacy week with games nobody ever started him for, and this page would
    // report a bigger week than the matchup screen scores.
    starter.scored = starter.games.reduce((a, g) => a + (g.started ? (g.score ?? 0) : 0), 0);
    // Forward-looking, so it takes the whole remaining slate: a lineup set for
    // the period starts him on every night left in it. Only nights that have
    // not finished are projected — a night behind us with no box score is a
    // DNP worth zero, and adding his average to it would have every historic
    // week quoting a projection above the score it actually finished on.
    starter.projected = starter.scored
      + starter.games.reduce((a, g) => a + (g.state === "final" ? 0 : g.projected), 0);

    // His first night is the one that freezes him. A filed score counts as
    // played whatever the clock says, for the same reason it does nightly:
    // box scores arrive a day at a time and can land before a pinned clock
    // reaches the tip-off — and a night already behind us locks him whether or
    // not it ever filed one.
    const first = starter.games[0];
    if (first !== undefined) {
      starter.locked = first.state !== "upcoming";
      starter.lockedAt = starter.locked ? first.tipoff : null;
    }
  }

  return [...byPlayer.values()];
}

/**
 * Sets one lineup for a whole period.
 *
 * `entries` is a patch, for the same reason the nightly version is: a player it
 * does not name keeps the slot he has, so a manager who opened the page on
 * Monday and submitted on Wednesday does not silently bench whoever started
 * playing in between.
 */
export async function setPeriodLineup(
  db: Db,
  { fantasyTeamId, from, to, entries, configId, config = GAME_CONFIG,
    settings = DEFAULT_SETTINGS, now = new Date() }: {
    fantasyTeamId: number; from: string; to: string;
    entries: { playerId: number; slot: Slot }[];
    configId: number; config?: ScoringConfig; settings?: LeagueSettings; now?: Date;
  },
): Promise<PeriodLineupResult> {
  const startable = await startableInPeriod(db, { fantasyTeamId, from, to, configId, config, now });
  const byId = new Map(startable.map((s) => [s.playerId, s]));

  for (const entry of entries) {
    if (!byId.has(entry.playerId)) throw new NotOnRosterError(entry.playerId, fantasyTeamId);
  }

  const desired = new Map(entries.map((e) => [e.playerId, e.slot]));
  for (const player of startable) {
    const want = desired.get(player.playerId) ?? player.slot;
    if (player.locked && want !== player.slot) {
      throw new LineupLockedError(player.playerId, player.lockedAt);
    }
  }

  const lineup: LineupSlot[] = startable.map((s) => ({
    playerId: s.playerId,
    role: s.role,
    slot: desired.get(s.playerId) ?? s.slot,
  }));

  const violations = validateLineup(lineup, settings);
  if (violations.length > 0) throw new InvalidLineupError(violations);

  await writePeriodLineup(db, fantasyTeamId, lineup, byId);
  return {
    from, to, entries: lineup,
    locked: startable.filter((s) => s.locked).map((s) => s.playerId),
  };
}

/**
 * Fans one period decision out across the nights it still applies to.
 *
 * A row per player per game night, carrying the game he was started for — the
 * shape settlement already reads. A player's nights all get the same slot,
 * because that is what "set for the week" means.
 *
 * Only nights that have not started, though, and that is the whole subtlety.
 * This used to rewrite every night of every player named in the lineup, which
 * meant moving one player on Wednesday reached back and restamped Monday for
 * everybody — and Monday has been played. Two ways that goes wrong. A week set
 * a night at a time can have started a player on Monday and benched him on
 * Thursday; `startableInPeriod` resolves him to a single slot for the period,
 * so rewriting Thursday from that slot retroactively started him in a game
 * nobody started him in. And a player newly moved into a slot mid-week would
 * pick up rows for nights already in the books, banking points he was not
 * fielded for.
 *
 * A played night is a fact, not a preference. The lock exists to say so, and
 * the write has to honour it as well as the check does.
 */
async function writePeriodLineup(
  db: Db, fantasyTeamId: number, lineup: LineupSlot[],
  starters: Map<number, PeriodStarter>,
): Promise<void> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const entry of lineup) {
    const starter = starters.get(entry.playerId);
    if (starter === undefined) continue;
    for (const game of starter.games) {
      if (game.state !== "upcoming") continue;
      values.push(fantasyTeamId, game.playedOn, entry.playerId, entry.slot, game.gameId);
      const base = values.length - 5;
      tuples.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
    }
  }
  if (tuples.length === 0) return;

  await db.query(
    `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
     VALUES ${tuples.join(",")}
     ON CONFLICT (fantasy_team_id, played_on, player_id) DO UPDATE SET
       slot = EXCLUDED.slot, game_id = EXCLUDED.game_id, locked_at = now()`,
    values,
  );
}


/**
 * Carries the last lineup a team set into a period nobody has set yet.
 *
 * A lineup is a standing decision, not a weekly chore. Left alone, the app
 * asked the same question every seven days and scored a zero for anyone who
 * forgot to answer it — a manager whose team has not changed had to re-pick
 * the same seven players to keep the ones they already picked. So an untouched
 * period inherits: whoever was starting most recently and still plays this
 * week starts this week, in the slot he already held.
 *
 * Three things it deliberately will not do.
 *
 * It never overwrites a decision. If any player already holds a starting slot
 * in the period, somebody has been here — even to bench everyone but one — and
 * the carry stands down entirely rather than second-guessing them.
 *
 * It does not fill the gaps. A carried guard who has no game this week leaves
 * his slot empty, and the page says so. That is a real decision with a real
 * cost, and quietly auto-filling it would hide the one thing the manager needs
 * to be told. `autoFillPeriod` is still there, one button away, for anybody who
 * wants the machine to choose.
 *
 * It seats by recency, not by projection. The carried slots come from
 * `lineup_entry`, most recent night first, so a legacy week that named three
 * different guards across three nights resolves to the guard who was most
 * recently in that seat rather than to whoever the model likes best. Anyone the
 * shape cannot seat — because the slot filled up, or because he is no longer
 * eligible for it — lands on the bench, where the manager can see him.
 */
export async function carryForwardLineup(
  db: Db,
  { fantasyTeamId, from, to, settings = DEFAULT_SETTINGS, startable }: {
    fantasyTeamId: number; from: string; to: string;
    settings?: LeagueSettings;
    /** The period's startable players, when the caller has already read them. */
    startable: PeriodStarter[];
  },
): Promise<number> {
  if (startable.length === 0) return 0;
  // Somebody has already decided this week. Nothing to carry into.
  if (startable.some((s) => s.slot !== "BENCH" && s.slot !== "IR")) return 0;

  const { rows } = await db.query<{ player_id: string; slot: Slot }>(
    `SELECT DISTINCT ON (l.player_id) l.player_id, l.slot
       FROM lineup_entry l
      WHERE l.fantasy_team_id = $1 AND l.played_on < $2
        AND l.slot NOT IN ('BENCH', 'IR')
      ORDER BY l.player_id, l.played_on DESC`,
    [fantasyTeamId, from],
  );
  if (rows.length === 0) return 0;

  const held = new Map(rows.map((r) => [Number(r.player_id), r.slot]));
  const room = new Map<Slot, number>(settings.starters.map((s) => [s.slot, s.count]));

  // Most recently started first, so the scarcest seats go to whoever most
  // recently held them when a legacy week names more players than there are.
  const byRecency = startable
    .filter((s) => held.has(s.playerId))
    .sort((a, b) => (b.lockedAt ?? "").localeCompare(a.lockedAt ?? ""));

  const lineup: LineupSlot[] = [];
  const seated = new Set<number>();
  for (const player of byRecency) {
    const slot = held.get(player.playerId)!;
    const left = room.get(slot) ?? 0;
    if (left <= 0 || !isEligible(player.role, slot)) continue;
    room.set(slot, left - 1);
    lineup.push({ playerId: player.playerId, role: player.role, slot });
    seated.add(player.playerId);
  }
  if (lineup.length === 0) return 0;

  for (const player of startable) {
    if (seated.has(player.playerId)) continue;
    lineup.push({ playerId: player.playerId, role: player.role, slot: "BENCH" });
  }

  // The bench can be over its seat count here — a roster whose starters mostly
  // sat out this week piles everyone onto it — and that is not a reason to
  // carry nothing. Only the rules that would corrupt a lineup are enforced;
  // the bench overflow is the page's problem to show, not this one's to refuse.
  const violations = validateLineup(lineup, settings)
    .filter((v) => v.slot !== "BENCH");
  if (violations.length > 0) throw new InvalidLineupError(violations);

  await writePeriodLineup(db, fantasyTeamId, lineup, new Map(startable.map((s) => [s.playerId, s])));
  return lineup.filter((l) => l.slot !== "BENCH").length;
}

/**
 * The best legal lineup for a period, ranked on where each player's whole week
 * is expected to land rather than on any one night.
 *
 * That ranking is the point of doing it per period: a player with two games is
 * worth more than an equal player with one, and under cumulative scoring the
 * auto-fill should say so. Locked players keep what they are in.
 */
export async function autoFillPeriod(
  db: Db,
  { fantasyTeamId, from, to, configId, config = GAME_CONFIG,
    settings = DEFAULT_SETTINGS, now = new Date() }: {
    fantasyTeamId: number; from: string; to: string; configId: number;
    config?: ScoringConfig; settings?: LeagueSettings; now?: Date;
  },
): Promise<PeriodLineupResult> {
  const startable = await startableInPeriod(db, { fantasyTeamId, from, to, configId, config, now });
  if (startable.length === 0) return { from, to, entries: [], locked: [] };

  const locked = startable.filter((s) => s.locked);
  const open = startable.filter((s) => !s.locked);

  const remaining = settings.starters.map(({ slot, count }) => ({
    slot,
    count: count - locked.filter((l) => l.slot === slot).length,
  })).filter((s) => s.count > 0);

  const filled = autoFill(
    open.map((s) => ({ playerId: s.playerId, role: s.role, projected: s.projected })),
    { ...settings, starters: remaining },
  );

  const lineup: LineupSlot[] = [
    ...locked.map((l) => ({ playerId: l.playerId, role: l.role, slot: l.slot })),
    ...filled,
  ];

  await writePeriodLineup(db, fantasyTeamId, lineup, new Map(startable.map((s) => [s.playerId, s])));
  return { from, to, entries: lineup, locked: locked.map((l) => l.playerId) };
}

export interface SeededPeriod extends PeriodLineupResult {
  /** How many player-nights the decision was written across. */
  nights: number;
}

/**
 * Sets a period's lineup from scratch, as if the manager had set it on the
 * Monday — over nights already played, if that is what the period holds.
 *
 * This is the seeding path, and it is the only one allowed to rewrite a night
 * that has been played. `setPeriodLineup` and `autoFillPeriod` deliberately
 * cannot: a played night is a decision the clock has already made, and the lock
 * exists to say so. A generated season has no such decision to protect. Nobody
 * managed those teams; the rows are there because a script put them there, and
 * a script re-cutting them into weeks is not overruling anybody.
 *
 * That is also why this is not the fallback for a manager who missed a week.
 * It answers "what would this period have looked like, decided once" — for a
 * season being generated, and for one generated a night at a time that now has
 * to read as weekly, which is the same question asked twice.
 *
 * Two rules keep the answer honest.
 *
 * **It ranks on what the Monday knew.** A player's week is his scoring average
 * from before the period opened, multiplied by the games he plays inside it —
 * so a heavier slate is worth more, which is the whole point of picking for a
 * week, and March's totals never reach back to pick November's lineup. Form is
 * cut off at `from` rather than at each night, so every night of the period is
 * ranked by the same numbers: one decision, one basis for it.
 *
 * **It writes the period and nothing else.** Every existing row inside it is
 * replaced, so the nightly leftovers that made a week look like seven separate
 * decisions go with them, and a player is written only for the nights he was
 * actually owned on — a mid-week waiver claim does not retroactively start
 * somebody for a game his manager did not have him for.
 */
export async function seedPeriodLineup(
  db: Db,
  { fantasyTeamId, from, to, configId, settings = DEFAULT_SETTINGS }: {
    fantasyTeamId: number; from: string; to: string; configId: number;
    settings?: LeagueSettings;
  },
): Promise<SeededPeriod> {
  const { rows } = await db.query<{
    player_id: string; role: string | null; form: number | null;
    game_id: string; played_on: string;
  }>(
    `WITH roster AS (
       SELECT r.player_id, p.team_id, r.acquired_on, r.released_on
         FROM roster_slot r
         JOIN player p ON p.id = r.player_id
        WHERE r.fantasy_team_id = $1
          AND r.acquired_on <= $3
          AND (r.released_on IS NULL OR r.released_on > $2)
     ),
     slate AS (
       SELECT g.id AS game_id, g.played_on, g.tipoff, g.home_team_id AS team_id
         FROM game g WHERE g.played_on BETWEEN $2 AND $3
       UNION ALL
       SELECT g.id, g.played_on, g.tipoff, g.away_team_id
         FROM game g WHERE g.played_on BETWEEN $2 AND $3
     )
     SELECT roster.player_id,
            (SELECT st.role FROM player_game_stat st
              WHERE st.player_id = roster.player_id AND st.role IS NOT NULL
              ORDER BY st.played_on DESC LIMIT 1) AS role,
            (SELECT avg(sc.score) FROM player_game_score sc
              WHERE sc.player_id = roster.player_id AND sc.config_id = $4
                AND sc.played_on < $2) AS form,
            slate.game_id, to_char(slate.played_on, 'YYYY-MM-DD') AS played_on
       FROM roster
       JOIN slate ON slate.team_id = roster.team_id
      WHERE roster.acquired_on <= slate.played_on
        AND (roster.released_on IS NULL OR roster.released_on > slate.played_on)
      ORDER BY roster.player_id, slate.played_on, slate.tipoff NULLS LAST`,
    [fantasyTeamId, from, to, configId],
  );

  interface Candidate {
    playerId: number; role: string | null; form: number;
    games: { gameId: number; playedOn: string }[];
  }
  const byPlayer = new Map<number, Candidate>();
  for (const r of rows) {
    const playerId = Number(r.player_id);
    const game = { gameId: Number(r.game_id), playedOn: r.played_on };
    const held = byPlayer.get(playerId);
    if (held === undefined) {
      byPlayer.set(playerId, {
        playerId, role: r.role, form: r.form === null ? 0 : Number(r.form), games: [game],
      });
      continue;
    }
    // One night per player: a team on the schedule twice in a day is still one
    // night, and the earlier tip is the game he is started for.
    if (!held.games.some((g) => g.playedOn === game.playedOn)) held.games.push(game);
  }

  const candidates = [...byPlayer.values()];
  const lineup = autoFill(
    candidates.map((c) => ({ playerId: c.playerId, role: c.role, projected: c.form * c.games.length })),
    settings,
  );

  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const entry of lineup) {
    for (const game of byPlayer.get(entry.playerId)!.games) {
      values.push(fantasyTeamId, game.playedOn, entry.playerId, entry.slot, game.gameId);
      const base = values.length - 5;
      tuples.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
    }
  }

  // The clear and the write are one statement pair or neither: a period left
  // cleared because the insert failed is a team that fielded nobody, which is a
  // worse state than the one being repaired.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM lineup_entry WHERE fantasy_team_id = $1 AND played_on BETWEEN $2 AND $3",
      [fantasyTeamId, from, to]);
    if (tuples.length > 0) {
      await client.query(
        `INSERT INTO lineup_entry (fantasy_team_id, played_on, player_id, slot, game_id)
         VALUES ${tuples.join(",")}`,
        values);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { from, to, entries: lineup, locked: [], nights: tuples.length };
}

/** Seeds one period for every team in a league. */
export async function seedPeriodLeague(
  db: Db, leagueId: number, from: string, to: string,
): Promise<{ teams: number; started: number }> {
  const { rows } = await db.query<{ id: string; config_id: string; settings: LeagueSettings }>(
    `SELECT t.id, l.config_id, l.settings
       FROM fantasy_team t JOIN league l ON l.id = t.league_id
      WHERE t.league_id = $1 ORDER BY t.id`,
    [leagueId],
  );

  let started = 0;
  for (const row of rows) {
    const result = await seedPeriodLineup(db, {
      fantasyTeamId: Number(row.id),
      from, to,
      configId: Number(row.config_id),
      settings: { ...DEFAULT_SETTINGS, ...(row.settings ?? {}) },
    });
    started += result.entries.filter((e) => e.slot !== "BENCH" && e.slot !== "IR").length;
  }
  return { teams: rows.length, started };
}
