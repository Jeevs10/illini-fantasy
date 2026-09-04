"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Glyph, type GlyphName } from "./ui/glyphs.tsx";

interface Dest { href: string; label: string; glyph: GlyphName }

/**
 * The destinations, in the order a season is actually used.
 *
 * Home first because the question a manager opens the app with is "how am I
 * doing"; the rest is the order they act in — check the team, work the
 * market, read the league.
 */
const PRIMARY: Dest[] = [
  { href: "/home", label: "Home", glyph: "home" },
  { href: "/team", label: "My Team", glyph: "team" },
  { href: "/league", label: "Matchup", glyph: "matchup" },
  { href: "/players", label: "Players", glyph: "players" },
];

const SECONDARY: Dest[] = [
  { href: "/standings", label: "Standings", glyph: "league" },
  { href: "/playoffs", label: "Playoffs", glyph: "trophy" },
  { href: "/waivers", label: "Waivers", glyph: "waivers" },
  { href: "/trades", label: "Trades", glyph: "trades" },
  { href: "/draft", label: "Draft", glyph: "draft" },
];

const COMMISH: Dest = { href: "/commissioner", label: "Commissioner", glyph: "bolt" };

export function Nav({
  commissioner, children,
}: { commissioner: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);

  // A sheet that survives navigation is a sheet nobody asked for twice.
  useEffect(() => { setSheet(false); }, [pathname]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const secondary = commissioner ? [...SECONDARY, COMMISH] : SECONDARY;
  const all = [...PRIMARY, ...secondary];
  const on = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const inSheet = secondary.some((d) => on(d.href));

  return (
    <>
      <header className="masthead">
        <div className="shell masthead-inner">
          <Link href="/home" className="wordmark">
            <span className="mark" aria-hidden="true">IF</span>
            Illini Fantasy
          </Link>

          <nav className="topnav" aria-label="Sections">
            {all.map((d) => (
              <Link key={d.href} href={d.href} data-active={on(d.href)}>{d.label}</Link>
            ))}
          </nav>

          {children}
        </div>
      </header>

      {/* The phone bar. Four destinations plus everything else, rather than a
          horizontally scrolling row of eight links that shows one. */}
      <nav className="bnav" aria-label="Sections">
        {PRIMARY.map((d) => (
          <Link key={d.href} href={d.href} data-active={on(d.href)}>
            <span className="glyph"><Glyph name={d.glyph} size={21} /></span>
            {d.label}
          </Link>
        ))}
        <button type="button" onClick={() => setSheet(true)} aria-expanded={sheet} aria-haspopup="dialog"
                data-active={inSheet || undefined}
                style={inSheet ? { color: "var(--accent-ink)" } : undefined}>
          <span className="glyph"><Glyph name="more" size={21} /></span>
          More
        </button>
      </nav>

      {sheet ? (
        <>
          <button className="sheet-scrim" aria-label="Close" onClick={() => setSheet(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More sections">
            <div className="sheet-grab" />
            <p className="eyebrow">More of the league</p>
            <div className="sheet-links">
              {secondary.map((d) => (
                <Link key={d.href} href={d.href} data-active={on(d.href) || undefined}>
                  <span className="glyph"><Glyph name={d.glyph} size={20} /></span>
                  {d.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
