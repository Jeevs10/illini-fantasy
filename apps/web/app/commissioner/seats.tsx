"use client";

import { monogram } from "../ui/identity.tsx";

export interface Seat { id: number; name: string; owner: string | null; mine: boolean }

/**
 * Every seat in the league as a small banner: stitched solid once a manager
 * holds it, dashed while it waits for someone to redeem an invite. How full
 * the league is reads at a glance, before the table below says who.
 */
export function SeatStrip({ seats }: { seats: Seat[] }) {
  return (
    <ol className="ondeck seatstrip" aria-label="Seats">
      {seats.map((s) => (
        <li key={s.id} data-mine={s.mine || undefined} data-open={s.owner === null || undefined}
            aria-label={`${s.name}: ${s.owner ?? "open seat"}`}>
          <span className="ondeck-mark" aria-hidden="true">{monogram(s.name)}</span>
          <span className="ondeck-name" aria-hidden="true">{s.owner ?? "Open"}</span>
        </li>
      ))}
    </ol>
  );
}
