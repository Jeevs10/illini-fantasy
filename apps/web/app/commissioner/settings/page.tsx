import Link from "next/link";
import {
  SETTING_FIELDS, STARTER_SLOTS, settingLabel, settingsContext, settingsHistory, tradingClosed,
} from "@illini/league";
import { db } from "../../../lib/db.ts";
import { requireViewer, viewDate, viewNow } from "../../../lib/session.ts";
import { SettingsForm } from "./form.tsx";

export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
});

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York",
});

export default async function Settings() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, season, role, settings } = viewer.membership;

  // `updateSettings` refuses a non-commissioner on its own, so this is about
  // telling a manager where they are rather than about keeping anyone out.
  if (role !== "commissioner") {
    return (
      <div className="narrow">
        <div className="panel"><div className="panel-body">
          <h1>Commissioner only</h1>
          <p className="muted">
            The numbers {leagueName} runs on belong to whoever runs it. You play
            by them, which is everything except this page.
          </p>
          <Link className="button" href="/team">Back to my team</Link>
        </div></div>
      </div>
    );
  }

  const [context, changes] = await Promise.all([
    settingsContext(db, { leagueId, on: viewDate() }),
    settingsHistory(db, { leagueId, limit: 8 }),
  ]);
  const closed = tradingClosed(settings, viewNow());

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>League settings</h1>
          <p className="meta">
            <span>{leagueName}</span>
            <span>{season - 1}–{String(season).slice(2)}</span>
            <span>
              {context.settledWeeks === 0
                ? "Nothing settled yet"
                : `${context.settledWeeks} week${context.settledWeeks === 1 ? "" : "s"} settled`}
            </span>
          </p>
        </div>
        <div className="controls">
          <Link className="button" href="/commissioner">Seats and invites</Link>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <p className="prose" style={{ margin: 0 }}>
            These are the numbers every other screen reads. Most of them only
            bind what happens next — a bid already sealed opens at the hour it
            was filed for, and a deal already agreed keeps the window it was
            agreed under, because those moments are written down when they are
            made rather than worked out when they are read. The games cap is the
            exception: it decides which started games counted, so moving it
            re-scores the weeks that are already in the books.
          </p>
          {settings.tradeDeadline !== null ? (
            // One span, not three text nodes: `.notice` is a flex row, so a
            // bare <strong> between two fragments becomes three flex items and
            // the sentence acquires gaps — visible as an orphaned full stop the
            // moment the line wraps.
            <p className="notice" style={{ marginTop: "var(--s-4)" }}>
              <span>
                Trading {closed ? "closed" : "closes"} after{" "}
                <strong>{DAY.format(new Date(`${settings.tradeDeadline}T12:00:00Z`))}</strong>.
                {closed ? " Nothing new can be offered or agreed." : ""}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      <SettingsForm
        settings={settings}
        context={context}
        fields={SETTING_FIELDS}
        starterSlots={STARTER_SLOTS}
      />

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>What has been changed</h2>
            <p>
              Straight off the transaction log, the same place a trade or a
              waiver award lands. A rule nobody can see being changed is the one
              a league argues about.
            </p>
          </div>
        </div>
        {changes.length === 0 ? (
          <div className="empty">
            <h3>Nothing has been changed</h3>
            <p>
              {leagueName} is still playing by the numbers it was created with.
            </p>
          </div>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">Settings changes, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">By</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((event) => (
                  <tr key={event.id}>
                    <td className="num faint">
                      <time dateTime={event.at}>{WHEN.format(new Date(event.at))}</time>
                    </td>
                    <td>{event.byName ?? "—"}</td>
                    <td className="muted">
                      {event.changed.map((change, i) => (
                        <span key={change.key}>
                          {i > 0 ? ", " : ""}
                          {settingLabel(change.key).toLowerCase()}{" "}
                          <span className="faint">{change.from} &rarr; {change.to}</span>
                        </span>
                      ))}
                      {event.rescored.length > 0 ? (
                        <span className="sub">
                          {event.rescored.length} settled week
                          {event.rescored.length === 1 ? "" : "s"} re-scored
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
