import type { Db } from "@illini/db";
import { requireCommissioner, type Queryable } from "./membership.ts";
import { rosterLimit } from "./roster.ts";
import { scorePeriod } from "./settle.ts";
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
 *   - **One that is scoring.** The games cap decides which started games count,
 *     so moving it re-scores every week that has already been played. The
 *     codebase's standing rule is that a settled score is never quietly
 *     rewritten — so the weeks are re-scored *here*, in the same transaction,
 *     and the count comes back with the change. The alternative is standings
 *     that disagree with the matchup screen sitting next to them.
 */

/** The settings that are a single whole number. */
export type NumericSetting =
  | "bench" | "ir" | "gamesCap" | "periodDays" | "faabBudget"
  | "waiverHour" | "waiverDays" | "tradeOfferDays" | "tradeReviewHours";

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
    key: "gamesCap", label: "Games cap", min: 1, max: 40, unit: "games",
    help: "Most started games that count in one scoring period. College " +
      "schedules are uneven, and without a cap the matchup goes to whoever " +
      "happened to draw the heavier slate.",
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
  /** Weeks re-scored because the games cap moved. */
  rescored: number[];
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
  /** Weeks already settled. A games-cap change re-scores every one of them. */
  settledWeeks: number;
  /** Whether a schedule exists, which is what freezes the scoring period. */
  scheduleDrawn: boolean;
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
  }>(
    `SELECT (SELECT count(DISTINCT week) FROM matchup
              WHERE league_id = $1 AND settled_at IS NOT NULL) AS settled,
            (SELECT count(*) FROM matchup WHERE league_id = $1) AS scheduled,
            (SELECT count(*) FROM waiver_claim
              WHERE league_id = $1 AND status = 'pending') AS claims,
            (SELECT count(*) FROM trade
              WHERE league_id = $1 AND status = 'proposed') AS offers,
            (SELECT count(*) FROM trade
              WHERE league_id = $1 AND status = 'accepted') AS agreed`,
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
  return problems;
}

/** How a value reads in the log and in the sentence that says it changed. */
function worded(key: string, value: unknown): string {
  if (key === "starters") {
    return (value as LeagueSettings["starters"]).map((s) => `${s.slot}${s.count}`).join(" ");
  }
  return value === null ? "none" : String(value);
}

const KEYS: (keyof LeagueSettings)[] = [
  "starters", ...SETTING_FIELDS.map((f) => f.key), "tradeDeadline",
];

const LABELS: Record<string, string> = {
  starters: "Starting slots",
  tradeDeadline: "Trade deadline",
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

/**
 * Re-scores every week that has already been settled.
 *
 * Only the points. `settled_at` is left where it was: the week was settled when
 * it was settled, and a cap change re-scores it rather than re-dating it. The
 * standings read those points, so this is what stops a change to the cap from
 * leaving the table and the matchup screen telling two different stories.
 */
async function rescoreSettled(
  q: Queryable, leagueId: number, settings: LeagueSettings,
): Promise<number[]> {
  const { rows } = await q.query<{
    id: string; week: number; config_id: string;
    home_team_id: string; away_team_id: string; starts_on: string; ends_on: string;
  }>(
    `SELECT m.id, m.week, l.config_id, m.home_team_id, m.away_team_id,
            to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on
       FROM matchup m JOIN league l ON l.id = m.league_id
      WHERE m.league_id = $1 AND m.settled_at IS NOT NULL
      ORDER BY m.week, m.id`,
    [leagueId]);

  const weeks = new Set<number>();
  for (const m of rows) {
    const configId = Number(m.config_id);
    const home = await scorePeriod(q, {
      fantasyTeamId: Number(m.home_team_id), configId, from: m.starts_on, to: m.ends_on, settings });
    const away = await scorePeriod(q, {
      fantasyTeamId: Number(m.away_team_id), configId, from: m.starts_on, to: m.ends_on, settings });
    await q.query("UPDATE matchup SET home_points = $2, away_points = $3 WHERE id = $1",
      [m.id, home.total, away.total]);
    weeks.add(m.week);
  }
  return [...weeks];
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
      return { settings: before, changed: [], notes: [], rescored: [] };
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

    if (problems.length > 0) throw new SettingsRefusedError(problems);

    await client.query("UPDATE league SET settings = $2 WHERE id = $1",
      [leagueId, JSON.stringify(after)]);

    // The games cap decides which started games counted, so a settled week
    // scored under the old one is no longer the score this league plays by.
    const rescored = moved.has("gamesCap") ? await rescoreSettled(client, leagueId, after) : [];

    const notes: string[] = [];
    if (rescored.length > 0) {
      notes.push(
        `${rescored.length} settled week${rescored.length === 1 ? " was" : "s were"} re-scored ` +
        "under the new cap, so the standings and the matchup screen still agree.");
    }
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
      [leagueId, JSON.stringify({ changed, rescored }), byUserId]);

    await client.query("COMMIT");
    return { settings: after, changed, notes, rescored };
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
