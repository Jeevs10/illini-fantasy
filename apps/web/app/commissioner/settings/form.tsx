"use client";

import { useActionState, useState } from "react";
import type { LeagueSettings, SettingField, SettingsContext, Slot } from "@illini/league";
import { save, type SettingsState } from "./actions.ts";

/**
 * The numbers the league runs on.
 *
 * Grouped the way a commissioner thinks about them rather than the way they are
 * stored, and every field carries the sentence that says what it does — this is
 * the one screen in the app whose whole job is that a number is understood
 * before it is changed.
 *
 * The roster limit is derived on screen as the slots move. It is the number
 * that actually bites, and it is not a field: a commissioner who adds a bench
 * seat is really asking "how many players is that", and answering it afterwards
 * with a refusal is answering it too late.
 *
 * The field descriptors arrive as a prop rather than as an import. They live in
 * `@illini/league` beside the rules that enforce them, and importing that as a
 * value here would drag the database driver into the browser bundle — the same
 * reason every other client component in this app takes its data down rather
 * than reaching for it.
 */

const GROUPS: { title: string; note: string; keys: string[] }[] = [
  {
    title: "Scoring",
    note: "What counts, and over how long.",
    keys: ["gamesCap", "periodDays"],
  },
  {
    title: "Waivers",
    note: "The blind auction and the wire it runs on.",
    keys: ["faabBudget", "waiverHour", "waiverDays"],
  },
  {
    title: "Trades",
    note: "How long a deal waits, and how long the league gets to look at it.",
    keys: ["tradeOfferDays", "tradeReviewHours"],
  },
];

export function SettingsForm({
  settings, context, fields, starterSlots,
}: {
  settings: LeagueSettings;
  context: SettingsContext;
  fields: SettingField[];
  starterSlots: Exclude<Slot, "BENCH" | "IR">[];
}) {
  const [state, submit, saving] = useActionState<SettingsState, FormData>(save, {});
  const FIELD = new Map(fields.map((f) => [f.key as string, f]));

  const [slots, setSlots] = useState<Record<string, number>>(() =>
    Object.fromEntries(starterSlots.map((slot) => [
      slot, settings.starters.find((s) => s.slot === slot)?.count ?? 0,
    ])));
  const [bench, setBench] = useState(settings.bench);
  const [ir, setIr] = useState(settings.ir);

  const starting = starterSlots.reduce((a, slot) => a + (slots[slot] ?? 0), 0);
  const limit = starting + bench + ir;
  const held = context.largestRoster?.size ?? 0;
  const tooSmall = held > limit;

  return (
    <form action={submit}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Roster</h2>
            <p>
              The starting slots, and the seats behind them. FLEX takes anybody;
              the bench and IR never score.
            </p>
          </div>
          <span className={`pill ${tooSmall ? "crit" : "ghost"}`}>
            {limit} player{limit === 1 ? "" : "s"}
          </span>
        </div>

        <div className="panel-body">
          <div className="setgrid">
            {starterSlots.map((slot) => (
              <label className="setfield" key={slot}>
                <span className="setlabel">{slot === "FLEX" ? "Flex" : slot}</span>
                <input
                  type="number" name={`slot_${slot}`} min={0} max={10} required
                  value={slots[slot] ?? 0}
                  onChange={(e) => setSlots({ ...slots, [slot]: Number(e.target.value) })}
                />
              </label>
            ))}
            <label className="setfield">
              <span className="setlabel">Bench</span>
              <input
                type="number" name="bench" min={0} max={20} required
                value={bench} onChange={(e) => setBench(Number(e.target.value))}
              />
            </label>
            <label className="setfield">
              <span className="setlabel">IR</span>
              <input
                type="number" name="ir" min={0} max={5} required
                value={ir} onChange={(e) => setIr(Number(e.target.value))}
              />
            </label>
          </div>

          <p className="sethelp" role="status">
            {starting} starting {starting === 1 ? "slot" : "slots"}, {bench} on the
            bench, {ir} on IR — a roster limit of <strong>{limit}</strong>.
            {context.largestRoster === null ? null : tooSmall ? (
              <>
                {" "}<strong>{context.largestRoster.teamName}</strong> already holds {held},
                so this will be refused until somebody is dropped.
              </>
            ) : (
              <> The fullest roster in the league holds {held}.</>
            )}
          </p>
        </div>
      </div>

      {GROUPS.map((group) => (
        <div className="panel" key={group.title}>
          <div className="panel-head">
            <div>
              <h2>{group.title}</h2>
              <p>{group.note}</p>
            </div>
          </div>
          <div className="panel-body stack">
            {group.keys.map((key) => {
              const field = FIELD.get(key)!;
              return (
                <div className="setrow" key={key}>
                  <label className="setfield">
                    <span className="setlabel">{field.label}</span>
                    <input
                      type="number" name={field.key}
                      min={field.min} max={field.max} required
                      defaultValue={settings[field.key]}
                    />
                    <span className="setunit">{field.unit}</span>
                  </label>
                  <p className="sethelp">
                    {field.help}
                    {key === "gamesCap" && context.settledWeeks > 0 ? (
                      <>
                        {" "}<strong>
                          Changing it re-scores the {context.settledWeeks} week
                          {context.settledWeeks === 1 ? "" : "s"} already settled
                        </strong>, so the standings and the matchup screen keep
                        telling the same story.
                      </>
                    ) : null}
                    {key === "periodDays" && context.scheduleDrawn ? (
                      <>
                        {" "}The schedule is already drawn and its weeks are stored
                        rather than derived, so this can no longer be changed.
                      </>
                    ) : null}
                    {key === "faabBudget" && context.mostSpent !== null
                      && context.mostSpent.spent > 0 ? (
                      <>
                        {" "}<strong>{context.mostSpent.teamName}</strong> has spent
                        ${context.mostSpent.spent}, which is the floor.
                      </>
                    ) : null}
                  </p>
                </div>
              );
            })}

            {group.title === "Trades" ? (
              <div className="setrow">
                <label className="setfield">
                  <span className="setlabel">Trade deadline</span>
                  <input
                    type="date" name="tradeDeadline"
                    defaultValue={settings.tradeDeadline ?? ""}
                  />
                </label>
                <p className="sethelp">
                  The last day a trade may be <em>agreed</em>. Leave it empty for
                  no deadline. A deal agreed on the deadline day still executes
                  when its review window closes, even if that is the day after —
                  the window belongs to the league, not to the two managers.
                  {context.liveOffers > 0 ? (
                    <>
                      {" "}A deadline already in the past expires the{" "}
                      {context.liveOffers} standing offer
                      {context.liveOffers === 1 ? "" : "s"} on the next read.
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ))}

      <div className="controls">
        <button className="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        <span className="deal-note">
          Every change is written to the league's transaction log.
        </span>
      </div>

      <div role="status" aria-live="polite" style={{ marginTop: "var(--s-4)" }}>
        {state.error ?? state.ok ? (
          <p className={`notice ${state.error ? "bad" : "good"}`}>{state.error ?? state.ok}</p>
        ) : null}
        {state.reasons?.length ? (
          <ul className="setreasons">
            {state.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        ) : null}
        {state.changed?.length ? (
          <ul className="setreasons done">
            {state.changed.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
        {state.notes?.map((note) => (
          <p className="fineprint" key={note}>{note}</p>
        ))}
      </div>
    </form>
  );
}
