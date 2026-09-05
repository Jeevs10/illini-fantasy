import type { Db } from "@illini/db";
import { requireCommissioner, type Queryable } from "./membership.ts";
import { rosterLimit } from "./roster.ts";
import { DEFAULT_SETTINGS, type LeagueSettings, type Slot } from "./slots.ts";

/**
 * The numbers the league runs on, and the rules for changing them.
 *
 * Everything here has existed since Phase 2 as a key in `league.settings` with
 * nothing that edits it, so changing the games cap or the FAAB budget has meant
 * an UPDATE by hand. What was missing is not storage — it is the part that
 * knows which changes a league in progress can survive.
 *
 * Three kinds of setting, and the difference between them is the whole module:
 *
 *   - **Ones that only bind the future.** The trade window, the offer life, the
 *     waiver hour. Change them and the next deal follows the new rule; the ones
 *     already in flight carry the deadline they were made under, because those
 *     moments are stored on the row rather than derived on read. That is not a
 *     bug to fix, it is the reason a sealed bid can be sealed at all — so it is
 *     reported as a note rather than silently done.
 *   - **Ones a league in progress can contradict.** The roster limit and the
 *     FAAB budget. A limit below a roster somebody already holds, or a budget
 *     below what somebody already spent, is not a rule — it is a league in a
 *     state it has no way to reach. Those are refused, naming the team.
 *   - **Ones that are scoring, and could rewrite history.** These used to
 *     re-score every already-settled week the moment they moved, in the same
 *     transaction, because `matchup` had nowhere of its own to say what it had
 *     actually been scored under. Now it does: `settleWeek`/`settlePlayoffs`
 *     snapshot the scoring config and the settings onto the row the moment it
 *     settles, so a settled score has nothing left to rewrite.
 *
 * The games cap used to be the third kind and is no longer editable at all: a
 * period is the sum of what its starters scored in it, so there is no cap left
 * to set. Settled matchups still carry the one they were scored under, which is
 * what lets an old week keep reading the way it read at the time.
 */

/** The settings that are a single whole number. */
export type NumericSetting =
  | "bench" | "ir" | "periodDays" | "faabBudget"
  | "waiverHour" | "waiverDays" | "tradeOfferDays" | "tradeReviewHours"
  | "playoffTeams" | "playoffStartWeek" | "playoffRoundWeeks";

export interface SettingField {
  key: NumericSetting;
  label: string;
  /** What the number does. The screen and the CLI both print this one. */
  help: string;
  min: number;
  max: number;
  /** What it is counted in, for the suffix beside the input. */
  unit: string;
}

/**
 * Every editable number, in the order a commissioner thinks about them.
 *
 * The bounds live here rather than in the form, so the screen, the CLI and the
 * server action cannot disagree about what is allowed — the same reason the
 * username rule lives next to the CHECK constraint it mirrors.
 */
export const SETTING_FIELDS: SettingField[] = [
  {
    key: "bench", label: "Bench", min: 0, max: 20, unit: "players",
    help: "Seats that never score. Bench and IR are the difference between a " +
      "roster and a starting five.",
  },
  {
    key: "ir", label: "Injured reserve", min: 0, max: 5, unit: "players",
    help: "Seats that never score and never have to be filled.",
  },
  {
    key: "periodDays", label: "Scoring period", min: 1, max: 14, unit: "days",
    help: "How long a matchup lasts. Only read when the schedule is drawn.",
  },
  {
    key: "faabBudget", label: "FAAB budget", min: 0, max: 10_000, unit: "dollars",
    help: "What each team has to spend on waivers for the whole season.",
  },
  {
    key: "waiverHour", label: "Waiver hour", min: 0, max: 23, unit: "UTC",
    help: "The hour, UTC, at which sealed bids are opened. 9 is 4am Eastern — " +
      "no college game is under way, so a run never lands mid-scoring.",
  },
  {
    key: "waiverDays", label: "Waiver period", min: 0, max: 14, unit: "days",
    help: "How long a dropped player sits on the wire before anybody can just " +
      "add him.",
  },
  {
    key: "tradeOfferDays", label: "Offers stand for", min: 1, max: 30, unit: "days",
    help: "How long an offer waits for an answer before it goes stale.",
  },
  {
    key: "tradeReviewHours", label: "Review window", min: 0, max: 168, unit: "hours",
    help: "How long an agreed trade sits in the open before the players move. " +
      "Zero executes on acceptance, which is a league that trusts itself.",
  },
  {
    key: "playoffTeams", label: "Playoff teams", min: 2, max: 16, unit: "teams",
    help: "How many teams make the bracket. Seeded by the regular-season table.",
  },
  {
    key: "playoffStartWeek", label: "Playoff start week", min: 1, max: 30, unit: "week",
    help: "The first week of the bracket. Regular-season weeks stop before it.",
  },
  {
    key: "playoffRoundWeeks", label: "Round length", min: 1, max: 4, unit: "weeks",
    help: "How many scoring periods each round of the bracket lasts.",
  },
];

/** The slots a lineup can be built from, in the order the form shows them. */
export const STARTER_SLOTS: Exclude<Slot, "BENCH" | "IR">[] = ["G", "F", "B", "FLEX"];

/** The most a single slot can hold. Ten guards is a typo, not a league. */
const MAX_PER_SLOT = 10;

/**
 * Raised when a change cannot be made, carrying every reason at once.
 *
 * All of them rather than the first: a form that refuses one field, then
 * refuses the next on resubmission, is a form somebody fills in four times.
 */
export class SettingsRefusedError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
    this.name = "SettingsRefusedError";
  }
}

/** A change to one setting, worded for the log and for the screen. */
export interface SettingChange {
  key: string;
  from: string;
  to: string;
}

export interface SettingsUpdate {
  settings: LeagueSettings;
  /** What actually moved. Empty when the form was submitted unchanged. */
  changed: SettingChange[];
  /**
   * Consequences worth saying out loud that are not refusals — almost always
   * something already in flight that keeps the rule it was created under.
   */
  notes: string[];
}

/**
 * What the league already contains, for the sentences that explain a refusal
 * before somebody runs into it.
 *
 * The screen wants all of this anyway — a commissioner shrinking the bench is
 * owed the number they are shrinking it towards, not a rejection afterwards.
 */
export interface SettingsContext {
  /** The largest roster anybody holds today, and whose. */
  largestRoster: { fantasyTeamId: number; teamName: string; size: number } | null;
  /** The most FAAB anybody has already spent, and who. */
  mostSpent: { fantasyTeamId: number; teamName: string; spent: number } | null;
  /** Weeks already settled. Each keeps the settings and config it settled under. */
  settledWeeks: number;
  /** Whether a schedule exists, which is what freezes the scoring period. */
  scheduleDrawn: boolean;
  /** Whether a playoff bracket exists, which is what freezes its shape. */
  bracketDrawn: boolean;
  /** Bids sealed for a run that has not happened. */
  pendingClaims: number;
  /** Offers nobody has answered yet. */
  liveOffers: number;
  /** Deals agreed and waiting out their review window. */
  pendingTrades: number;
}

export async function leagueSettings(q: Queryable, leagueId: number): Promise<LeagueSettings> {
  const { rows } = await q.query<{ settings: LeagueSettings | null }>(
    "SELECT settings FROM league WHERE id = $1", [leagueId]);
  if (!rows[0]) throw new Error(`no league ${leagueId}`);
  return { ...DEFAULT_SETTINGS, ...(rows[0].settings ?? {}) };
}

export async function settingsContext(
  q: Queryable, { leagueId, on }: { leagueId: number; on: string },
): Promise<SettingsContext> {
  const { rows: rosters } = await q.query<{ id: string; name: string; size: string }>(
    `SELECT ft.id, ft.name, count(r.player_id) AS size
       FROM fantasy_team ft
       LEFT JOIN roster_slot r
         ON r.fantasy_team_id = ft.id AND r.acquired_on <= $2
        AND (r.released_on IS NULL OR r.released_on > $2)
      WHERE ft.league_id = $1
      GROUP BY ft.id, ft.name
      ORDER BY count(r.player_id) DESC, ft.id
      LIMIT 1`,
    [leagueId, on]);

  // Spend is summed from won claims rather than read off the team, the same
  // ledger the waiver run itself checks against.
  const { rows: spend } = await q.query<{ id: string; name: string; spent: string }>(
    `SELECT ft.id, ft.name, coalesce(sum(c.bid), 0) AS spent
       FROM fantasy_team ft
       LEFT JOIN waiver_claim c
         ON c.fantasy_team_id = ft.id AND c.status = 'won'
      WHERE ft.league_id = $1
      GROUP BY ft.id, ft.name
      ORDER BY coalesce(sum(c.bid), 0) DESC, ft.id
      LIMIT 1`,
    [leagueId]);

  const { rows: counts } = await q.query<{
    settled: string; scheduled: string; claims: string; offers: string; agreed: string;
    bracket: string;
  }>(
    `SELECT (SELECT count(DISTINCT week) FROM matchup
              WHERE league_id = $1 AND settled_at IS NOT NULL) AS settled,
            (SELECT count(*) FROM matchup WHERE league_id = $1) AS scheduled,
            (SELECT count(*) FROM waiver_claim
              WHERE league_id = $1 AND status = 'pending') AS claims,
            (SELECT count(*) FROM trade
              WHERE league_id = $1 AND status = 'proposed') AS offers,
            (SELECT count(*) FROM trade
              WHERE league_id = $1 AND status = 'accepted') AS agreed,
            (SELECT count(*) FROM matchup
              WHERE league_id = $1 AND round IS NOT NULL) AS bracket`,
    [leagueId]);
  const row = counts[0]!;

  const biggest = rosters[0];
  const spender = spend[0];
  return {
    largestRoster: biggest === undefined ? null : {
      fantasyTeamId: Number(biggest.id), teamName: biggest.name, size: Number(biggest.size),
    },
    mostSpent: spender === undefined ? null : {
      fantasyTeamId: Number(spender.id), teamName: spender.name, spent: Number(spender.spent),
    },
    settledWeeks: Number(row.settled),
    scheduleDrawn: Number(row.scheduled) > 0,
    bracketDrawn: Number(row.bracket) > 0,
    pendingClaims: Number(row.claims),
    liveOffers: Number(row.offers),
    pendingTrades: Number(row.agreed),
  };
}

/** ISO 8601 calendar date, and a real one — 2026-02-30 is neither. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Everything wrong with a proposed set of settings, judged on its own.
 *
 * Shape only — bounds, whole numbers, a date that is a date. What the league
 * already contains is a separate question, asked against the database in
 * `updateSettings`, because it has a different answer every day.
 */
export function settingsProblems(settings: LeagueSettings): string[] {
  const problems: string[] = [];

  for (const field of SETTING_FIELDS) {
    const value = settings[field.key];
    if (!Number.isInteger(value)) {
      problems.push(`${field.label} has to be a whole number.`);
    } else if (value < field.min || value > field.max) {
      problems.push(`${field.label} has to be between ${field.min} and ${field.max}.`);
    }
  }

  const starters = settings.starters;
  const seen = new Set<string>();
  for (const { slot, count } of starters) {
    if (!STARTER_SLOTS.includes(slot)) problems.push(`${slot} is not a starting slot.`);
    if (seen.has(slot)) problems.push(`${slot} is listed twice.`);
    seen.add(slot);
    if (!Number.isInteger(count) || count < 0 || count > MAX_PER_SLOT) {
      problems.push(`${slot} has to hold between 0 and ${MAX_PER_SLOT} players.`);
    }
  }
  const starting = starters.reduce((a, s) => a + (Number.isInteger(s.count) ? s.count : 0), 0);
  if (starting < 1) {
    problems.push("A lineup needs at least one starting slot, or nobody ever scores.");
  }

  const deadline = settings.tradeDeadline;
  if (deadline !== null && !isCalendarDate(deadline)) {
    problems.push("The trade deadline has to be a date, as YYYY-MM-DD.");
  }

  for (const key of ["thirdPlace", "consolation", "reseed"] as const) {
    if (typeof settings[key] !== "boolean") problems.push(`${settingLabel(key)} has to be on or off.`);
  }
  if (settings.playoffTiebreak !== "seed" && settings.playoffTiebreak !== "pointsFor") {
    problems.push("The playoff tiebreak has to be seed or pointsFor.");
  }
  return problems;
}

/** How a value reads in the log and in the sentence that says it changed. */
function worded(key: string, value: unknown): string {
  if (key === "starters") {
    return (value as LeagueSettings["starters"]).map((s) => `${s.slot}${s.count}`).join(" ");
  }
  if (typeof value === "boolean") return value ? "on" : "off";
  return value === null ? "none" : String(value);
}

const KEYS: (keyof LeagueSettings)[] = [
  "starters", ...SETTING_FIELDS.map((f) => f.key), "tradeDeadline",
  "thirdPlace", "consolation", "reseed", "playoffTiebreak",
];

const LABELS: Record<string, string> = {
  starters: "Starting slots",
  tradeDeadline: "Trade deadline",
  thirdPlace: "Third-place game",
  consolation: "Consolation bracket",
  reseed: "Re-seed each round",
  playoffTiebreak: "Playoff tiebreak",
  ...Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, f.label])),
};

/** What moved between two sets of settings, in the order the screen lists them. */
export function diffSettings(before: LeagueSettings, after: LeagueSettings): SettingChange[] {
  return KEYS
    .map((key) => ({ key, from: worded(key, before[key]), to: worded(key, after[key]) }))
    .filter((change) => change.from !== change.to);
}

export function settingLabel(key: string): string {
  return LABELS[key] ?? key;
}

export interface SettingsChangeEvent {
  id: number;
  at: string;
  byName: string | null;
  changed: SettingChange[];
  /** Weeks re-scored by this change, if it moved the games cap. */
  rescored: number[];
}

/**
 * The settings changes, newest first.
 *
 * Read off the transaction log rather than kept in a table of its own, because
 * the log is already where a league goes to find out what happened to it — a
 * rule change belongs beside the trade it enabled, not in a second history
 * nobody thinks to open.
 */
export async function settingsHistory(
  q: Queryable, { leagueId, limit = 10 }: { leagueId: number; limit?: number },
): Promise<SettingsChangeEvent[]> {
  const { rows } = await q.query<{
    id: string; created_at: Date; by_name: string | null;
    payload: { changed?: SettingChange[]; rescored?: number[] };
  }>(
    `SELECT t.id, t.created_at, u.display_name AS by_name, t.payload
       FROM transaction t
       LEFT JOIN app_user u ON u.id = t.created_by
      WHERE t.league_id = $1 AND t.kind = 'settings'
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $2`,
    [leagueId, limit]);
  return rows.map((r) => ({
    id: Number(r.id),
    at: r.created_at.toISOString(),
    byName: r.by_name,
    changed: r.payload.changed ?? [],
    rescored: r.payload.rescored ?? [],
  }));
}

/**
 * Changes the league's settings.
 *
 * The commissioner's, and serialised on the league row — the same row the
 * waiver run and the trade run take, so a budget cannot be cut out from under a
 * batch of bids that is in the middle of being opened.
 *
 * A patch rather than a whole object, because the CLI sets one number and the
 * form submits nine, and a form that has to send every field is a form that
 * silently reverts whatever it did not know about.
 */
export async function updateSettings(
  db: Db,
  { leagueId, byUserId, patch, now = new Date() }: {
    leagueId: number; byUserId: number; patch: Partial<LeagueSettings>; now?: Date;
  },
): Promise<SettingsUpdate> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await requireCommissioner(db, leagueId, byUserId);

    const { rows } = await client.query<{ settings: LeagueSettings | null }>(
      "SELECT settings FROM league WHERE id = $1 FOR UPDATE", [leagueId]);
    if (!rows[0]) throw new Error(`no league ${leagueId}`);
    const before: LeagueSettings = { ...DEFAULT_SETTINGS, ...(rows[0].settings ?? {}) };
    const after: LeagueSettings = { ...before, ...patch };

    const changed = diffSettings(before, after);
    if (changed.length === 0) {
      await client.query("COMMIT");
      return { settings: before, changed: [], notes: [] };
    }

    const problems = settingsProblems(after);
    const moved = new Set(changed.map((c) => c.key));
    const context = await settingsContext(client, { leagueId, on: isoDay(now) });

    // The two ways a league in progress can contradict a new rule. Both are
    // states the league is already in, so the refusal names the team rather
    // than the number: a commissioner who has to go and find out who is full
    // has been told nothing.
    const limit = rosterLimit(after);
    const biggest = context.largestRoster;
    if (biggest !== null && biggest.size > limit
        && (moved.has("starters") || moved.has("bench") || moved.has("ir"))) {
      problems.push(
        `${biggest.teamName} holds ${biggest.size} players and that shape leaves room for ` +
        `${limit}. Somebody has to be dropped before the roster can shrink.`);
    }

    const spent = context.mostSpent;
    if (moved.has("faabBudget") && spent !== null && spent.spent > after.faabBudget) {
      problems.push(
        `${spent.teamName} has already spent $${spent.spent} of the budget, so $` +
        `${after.faabBudget} is a season nobody could have played.`);
    }

    // The scoring period is read once, when the schedule is drawn. Changing it
    // afterwards moves nothing — the weeks are rows in `matchup` — so the
    // honest answer is a refusal rather than a saved number that does nothing.
    if (moved.has("periodDays") && context.scheduleDrawn) {
      problems.push(
        "The schedule is already drawn, and its weeks are stored rather than derived. " +
        "Changing the scoring period now would move nothing.");
    }

    // The bracket is materialised at creation the same way the schedule and the
    // draft board are — its rounds are rows, dated to real weeks. Moving the
    // shape afterwards would leave those rows pointing at a bracket that no
    // longer describes them. `thirdPlace`/`consolation` are shape too — whether
    // those rows exist at all — decided the same moment `playoffTeams` is.
    // `reseed`/`playoffTiebreak` are deliberately not here: neither is baked
    // into row shape, and both are read fresh by `settlePlayoffs` for whichever
    // round is still unsettled, which is exactly the flexibility a commissioner
    // mid-bracket should keep.
    if (context.bracketDrawn && (moved.has("playoffTeams") || moved.has("playoffStartWeek")
        || moved.has("playoffRoundWeeks") || moved.has("thirdPlace") || moved.has("consolation"))) {
      problems.push(
        "The bracket is already drawn, and its rounds are stored rather than derived. " +
        "Changing its shape now would move nothing.");
    }

    if (problems.length > 0) throw new SettingsRefusedError(problems);

    await client.query("UPDATE league SET settings = $2 WHERE id = $1",
      [leagueId, JSON.stringify(after)]);

    const notes: string[] = [];
    // Everything already in flight carries the moment it was created with,
    // because that moment is stored on the row rather than derived on read —
    // which is the only reason a sealed bid can be sealed at all.
    if (moved.has("waiverHour") && context.pendingClaims > 0) {
      notes.push(`${context.pendingClaims} sealed bid${context.pendingClaims === 1 ? "" : "s"} ` +
        "will still open at the hour they were filed for.");
    }
    if (moved.has("tradeOfferDays") && context.liveOffers > 0) {
      notes.push(`${context.liveOffers} standing offer${context.liveOffers === 1 ? "" : "s"} ` +
        "keep the expiry they were made under.");
    }
    if (moved.has("tradeReviewHours") && context.pendingTrades > 0) {
      notes.push(`${context.pendingTrades} agreed trade${context.pendingTrades === 1 ? "" : "s"} ` +
        "keep the window they were agreed under.");
    }
    if (moved.has("tradeDeadline") && after.tradeDeadline !== null
        && isoDay(now) > after.tradeDeadline && context.liveOffers > 0) {
      notes.push(`That deadline is already past, so ${context.liveOffers} standing ` +
        `offer${context.liveOffers === 1 ? "" : "s"} will expire on the next read.`);
    }

    await client.query(
      `INSERT INTO transaction (league_id, kind, payload, created_by)
       VALUES ($1, 'settings', $2, $3)`,
      [leagueId, JSON.stringify({ changed }), byUserId]);

    await client.query("COMMIT");
    return { settings: after, changed, notes };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The roster date for a moment. Rosters are dated; the clock is not. */
function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
