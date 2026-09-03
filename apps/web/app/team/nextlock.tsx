"use client";

import { useEffect, useState } from "react";

/**
 * How long until the next game starts.
 *
 * The server renders the time; the relative part fills in after mount, so there
 * is no server/client string to disagree about. It matters because the whole
 * screen is a countdown a manager cannot otherwise see.
 */
export function NextLock({ iso, label, nowIso }: { iso: string; label: string; nowIso: string }) {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    // Count down from the server's clock, not the browser's. They are the same
    // in production and deliberately are not when a demo season is pinned —
    // and the lock is evaluated against the server's, so the countdown has to
    // agree with it or it lies about the deadline.
    const offset = Date.now() - new Date(nowIso).getTime();
    const tick = () => {
      const minutes = Math.round((new Date(iso).getTime() - (Date.now() - offset)) / 60000);
      if (minutes <= 0) { setRemaining("any moment"); return; }
      if (minutes < 60) { setRemaining(`in ${minutes} min`); return; }
      const hours = Math.floor(minutes / 60);
      setRemaining(`in ${hours}h ${minutes % 60}m`);
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [iso, nowIso]);

  return (
    <span className="nextlock">
      Next lock <strong>{label}</strong>
      {remaining ? <span className="faint"> · {remaining}</span> : null}
    </span>
  );
}
