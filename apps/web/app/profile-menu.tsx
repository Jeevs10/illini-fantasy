"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Glyph } from "./ui/glyphs.tsx";
import { signOutAction } from "./signout.tsx";

/**
 * Who you are, and the three destinations that are about the league's
 * plumbing rather than the season itself — the draft (one event, not a
 * weekly stop), your account, and (for whoever runs it) the commissioner
 * tools. Sleeper's own pattern: these live behind the identity control, not
 * beside Matchup and Waivers in the row a manager reads every day.
 */
export function ProfileMenu({
  name, commissioner,
}: { name: string; commissioner: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="profilemenu" ref={rootRef}>
      <button
        type="button"
        className="profilemenu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name}
      >
        <span className="whoami-name">{name}</span>
        <span className="profilemenu-chevron" data-open={open || undefined} aria-hidden="true">
          <Glyph name="chevron" size={14} />
        </span>
      </button>

      {open ? (
        <div className="profilemenu-panel" role="menu" aria-label={name}>
          <Link role="menuitem" href="/draft">
            <Glyph name="draft" size={17} />Draft
          </Link>
          <Link role="menuitem" href="/settings">
            <Glyph name="gear" size={17} />Account
          </Link>
          {commissioner ? (
            <Link role="menuitem" href="/commissioner">
              <Glyph name="bolt" size={17} />Commissioner
            </Link>
          ) : null}
          <hr />
          <form action={signOutAction}>
            <button type="submit" role="menuitem">Sign out</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
