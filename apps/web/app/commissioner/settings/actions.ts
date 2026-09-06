"use server";

import { revalidatePath } from "next/cache";
import {
  SETTING_FIELDS, STARTER_SLOTS, SettingsRefusedError, setStrengthAdjustment, settingLabel,
  updateSettings, type LeagueSettings,
} from "@illini/league";
import { db } from "../../../lib/db.ts";
import { requireViewer, viewNow } from "../../../lib/session.ts";

export interface SettingsState {
  error?: string;
  /** Every refusal at once, so the form is corrected once rather than four times. */
  reasons?: string[];
  ok?: string;
  /** What moved, worded, so the confirmation is a receipt rather than "Saved". */
  changed?: string[];
  notes?: string[];
  at?: number;
}

/**
 * A number from the form, or undefined if the field was not submitted.
 *
 * Undefined and zero are different answers — a FAAB budget of zero is a league
 * with no waiver auction, which is a legitimate way to run one — so an empty
 * field cannot be allowed to read as a nought.
 */
function number(form: FormData, key: string): number | undefined {
  const raw = form.get(key);
  if (raw === null || String(raw).trim() === "") return undefined;
  return Number(raw);
}

/**
 * Saves the league's settings.
 *
 * The form submits every field, and the patch is assembled from what it sent
 * rather than from what changed: `updateSettings` works out the difference
 * against the row it has locked, which is the only version that cannot be stale
 * by the time the save lands.
 */
export async function save(
  _state: SettingsState, formData: FormData,
): Promise<SettingsState> {
  const viewer = await requireViewer();
  const { leagueId, role } = viewer.membership;
  if (role !== "commissioner") {
    return { error: "Only the commissioner can change the league settings.", at: Date.now() };
  }

  const patch: Partial<LeagueSettings> = {};
  for (const field of SETTING_FIELDS) {
    const value = number(formData, field.key);
    if (value !== undefined) patch[field.key] = value;
  }

  const starters = STARTER_SLOTS
    .map((slot) => ({ slot, count: number(formData, `slot_${slot}`) ?? 0 }))
    // A slot nobody starts is not a slot. Dropping the zeroes keeps the stored
    // shape the same one `autoFill` iterates, rather than a list of empties it
    // has to skip.
    .filter((entry) => entry.count > 0);
  if (starters.length > 0) patch.starters = starters;

  const deadline = String(formData.get("tradeDeadline") ?? "").trim();
  patch.tradeDeadline = deadline === "" ? null : deadline;

  try {
    const result = await updateSettings(db, {
      leagueId, byUserId: viewer.userId, patch, now: viewNow(),
    });

    if (result.changed.length === 0) {
      return { ok: "Nothing was different, so nothing was written.", at: Date.now() };
    }

    // Every screen reads the settings — the roster limit, the games cap line,
    // the waiver budget, the trade window are all on one of them.
    revalidatePath("/", "layout");

    return {
      ok: `${result.changed.length} setting${result.changed.length === 1 ? "" : "s"} changed.`,
      changed: result.changed.map((c) => `${settingLabel(c.key)}: ${c.from} → ${c.to}`),
      notes: result.notes,
      at: Date.now(),
    };
  } catch (error) {
    if (error instanceof SettingsRefusedError) {
      return {
        error: "Nothing was saved.",
        reasons: error.reasons,
        at: Date.now(),
      };
    }
    console.error("settings save failed", error);
    return { error: "The settings could not be saved.", at: Date.now() };
  }
}

export interface StrengthState {
  error?: string;
  ok?: string;
  /** Where the setting ended up, so the control can re-label without a refetch. */
  on?: boolean;
  at?: number;
}

/**
 * Turns the opponent-strength multiplier on or off.
 *
 * Its own action rather than a field on the settings form: it does not save a
 * number, it repoints the league at a different set of already-computed
 * scores, and the receipt a commissioner wants back is how much history that
 * touched.
 */
export async function setStrength(
  _state: StrengthState, formData: FormData,
): Promise<StrengthState> {
  const viewer = await requireViewer();
  const { leagueId, role } = viewer.membership;
  if (role !== "commissioner") {
    return { error: "Only the commissioner can change how the league scores.", at: Date.now() };
  }

  const on = String(formData.get("on") ?? "") === "on";
  const result = await setStrengthAdjustment(db, { leagueId, byUserId: viewer.userId, on });

  revalidatePath("/", "layout");

  if (!result.changed) {
    return { on, ok: `Already ${on ? "adjusted for" : "ignoring"} strength of schedule.`, at: Date.now() };
  }
  const kept = result.settledWeeks > 0
    ? ` The ${result.settledWeeks} settled week${result.settledWeeks === 1 ? "" : "s"} keep the rules they settled under.`
    : "";
  return {
    on,
    ok: on
      ? `Scores are weighted by opponent strength again.${kept}`
      : `Strength of schedule is off — scores are raw production now.${kept}`,
    at: Date.now(),
  };
}
