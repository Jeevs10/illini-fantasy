"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Glyph, type GlyphName } from "./ui/glyphs.tsx";

interface Dest {
  href: string;
  label: string;
  glyph: GlyphName;
  /** Other routes this tab now also covers, folded in as an in-page toggle. */
  aliases?: string[];
}

/**
 * The four the phone bar has room for. Home first because the question a
 * manager opens the app with is "how am I doing"; the rest is the order they
 * act in — check the team, work the market, read the league.
 */
const MOBILE_PRIMARY: Dest[] = [
  { href: "/home", label: "Home", glyph: "home" },
  { href: "/team", label: "My Team", glyph: "team" },
  { href: "/league", label: "Matchup", glyph: "matchup" },
  { href: "/players", label: "Players", glyph: "players", aliases: ["/leaders"] },
];

/**
 * The desktop bar: every season-long section a manager reads, all visible at
 * once — no row that scrolls to show the tab you actually wanted. Standings
 * carries Playoffs and Players carries Leaders as an in-page toggle rather
 * than a tab of their own, which is what keeps this list at seven instead of
 * nine.
 */
const TOPNAV: Dest[] = [
  ...MOBILE_PRIMARY,
  { href: "/standings", label: "Standings", glyph: "league", aliases: ["/playoffs"] },
  { href: "/waivers", label: "Waivers", glyph: "waivers" },
  { href: "/trades", label: "Trades", glyph: "trades" },
];

/**
 * Everything the four-slot phone bar has no room for. On desktop this same
 * set — minus what the top bar already carries — lives behind the profile
 * menu instead; the phone has no such menu, so it all collects in one sheet.
 */
const MOBILE_SHEET: Dest[] = [
  { href: "/standings", label: "Standings", glyph: "league", aliases: ["/playoffs"] },
  { href: "/waivers", label: "Waivers", glyph: "waivers" },
  { href: "/trades", label: "Trades", glyph: "trades" },
  { href: "/draft", label: "Draft", glyph: "draft" },
  { href: "/settings", label: "Settings", glyph: "gear" },
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

  const sheetDests = commissioner ? [...MOBILE_SHEET, COMMISH] : MOBILE_SHEET;
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const on = (d: Dest) => matches(d.href) || (d.aliases ?? []).some(matches);
  const inSheet = sheetDests.some(on);

  return (
    <>
      <header className="masthead">
        <div className="shell masthead-inner">
          <Link href="/home" className="wordmark">
            <span className="mark" aria-hidden="true">IF</span>
            Illini Fantasy
          </Link>

          <nav className="topnav" aria-label="Sections">
            {TOPNAV.map((d) => (
              <Link key={d.href} href={d.href} data-active={on(d)}>{d.label}</Link>
            ))}
          </nav>

          {children}
        </div>
      </header>

      {/* The phone bar. Four destinations plus everything else, rather than a
          horizontally scrolling row of links that shows one. */}
      <nav className="bnav" aria-label="Sections">
        {MOBILE_PRIMARY.map((d) => (
          <Link key={d.href} href={d.href} data-active={on(d)}>
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
              {sheetDests.map((d) => (
                <Link key={d.href} href={d.href} data-active={on(d) || undefined}>
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
