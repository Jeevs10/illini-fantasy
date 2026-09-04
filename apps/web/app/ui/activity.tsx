import Link from "next/link";
import type { Activity } from "@illini/league";
import { Avatar } from "./identity.tsx";
import { Empty } from "./bits.tsx";

/**
 * The league, out loud.
 *
 * One sentence per entry in the transaction log, worded from what the log
 * actually holds. A kind it does not recognise is still shown — with its own
 * name as the verb — rather than silently dropped: an unexplained line in the
 * feed is a bug report, and a missing one is not.
 */

const VERB: Record<string, string> = {
  join: "joined the league",
  draft: "drafted",
  waiver: "won on waivers",
  free_agent: "added",
  trade: "traded for",
  release: "dropped",
  drop: "dropped",
  settings: "changed the league settings",
};

const AGO = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "America/New_York",
});

export function ActivityFeed({ events, mineId }: { events: Activity[]; mineId: number | null }) {
  if (events.length === 0) {
    return (
      <Empty title="Nothing has happened yet" glyph="bolt">
        Joins, drafts, waiver awards, adds, drops and trades all land here as
        they happen.
      </Empty>
    );
  }
  return (
    <>
      {events.map((event) => {
        const verb = VERB[event.kind] ?? event.kind.replace(/_/g, " ");
        const mine = event.fantasyTeamId !== null && event.fantasyTeamId === mineId;
        return (
          <div className="plr" key={event.id} data-mine={mine || undefined}>
            <span className="plr-lead">
              <Avatar
                name={event.teamName ?? event.byName ?? "?"}
                seed={event.fantasyTeamId ?? event.kind}
                size="sm"
                mine={mine}
              />
            </span>
            <span className="plr-id">
              <span className="plr-name" style={{ whiteSpace: "normal" }}>
                <strong>{event.teamName ?? event.byName ?? "Somebody"}</strong>{" "}
                <span style={{ fontWeight: 400, color: "var(--ink-2)" }}>{verb}</span>
                {event.playerName ? (
                  <>
                    {" "}
                    {event.playerId === null ? event.playerName : (
                      <Link href={`/players/${event.playerId}`}>{event.playerName}</Link>
                    )}
                  </>
                ) : null}
              </span>
              <span className="plr-sub">
                <span>{AGO.format(new Date(event.at))}</span>
                {event.byName && event.teamName ? (
                  <>
                    <span className="dot" />
                    <span>{event.byName}</span>
                  </>
                ) : null}
              </span>
            </span>
            {/* No status chip: the sentence has already said what happened,
                and a pill repeating it is a second thing to read that adds
                nothing. */}
          </div>
        );
      })}
    </>
  );
}
