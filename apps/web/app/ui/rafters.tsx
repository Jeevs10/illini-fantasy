"use client";

import Link from "next/link";
import { monogram } from "./identity.tsx";

export interface RafterTeam {
  fantasyTeamId: number;
  name: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  mine: boolean;
}

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? "th"}`;

const record = (t: RafterTeam) => `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ""}`;

/**
 * The league overhead: one banner per team, hung from a single steel rule in
 * standings order, the way the program hangs its title banners in the
 * rafters.
 *
 * A banner's drop is an exact quantity — points for — and never decoration:
 * the shortest banner is the fewest points, and the longest is the most. With
 * nothing scored yet every banner hangs at the same short drop, which is the
 * truth of a league before its first week. The stitching says what kind of
 * number hangs there: solid once a week has settled, dashed before.
 */
export function Rafters({ teams, label = "League standings" }: { teams: RafterTeam[]; label?: string }) {
  const most = Math.max(0, ...teams.map((t) => t.pointsFor));
  const settled = teams.some((t) => t.wins + t.losses + t.ties > 0);
  return (
    <nav className="rafters" aria-label={label}>
      <ol>
        {teams.map((t) => {
          // 0..1 of the way from the shortest drop to the longest.
          const share = most > 0 ? t.pointsFor / most : 0;
          return (
            <li key={t.fantasyTeamId} style={{ ["--drop" as string]: share.toFixed(3) }}>
              <Link
                href={`/teams/${t.fantasyTeamId}`}
                className="banner"
                data-mine={t.mine || undefined}
                data-stitch={settled ? "actual" : "projected"}
                aria-label={`${t.name}${t.mine ? " (your team)" : ""}: ${settled ? `${ordinal(t.rank)}, ` : ""}${record(t)}, ${t.pointsFor.toFixed(0)} points for`}
              >
                {/* Order means nothing until a week settles; before then the
                    banners hang in the schedule's order, unranked. */}
                <span className="banner-rank">{settled ? ordinal(t.rank) : "\u00a0"}</span>
                <span className="banner-mark">{monogram(t.name)}</span>
                <span className="banner-name">{t.name}</span>
                <span className="banner-record">{record(t)}</span>
                <span className="banner-pts">{t.pointsFor.toFixed(0)}<span> pts</span></span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
