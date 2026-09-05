"use client";

import Link from "next/link";

/**
 * A horizontally-scrolling strip of tabs — the shape this app reaches for
 * whenever a row of destinations or sections has outgrown a flat row.
 *
 * Two variants share the markup and the styling rather than one trying to be
 * both: `NavTabs` moves between pages (plain hrefs, active by the current
 * path) and `PanelTabs` switches sections of the same screen without a
 * navigation (local state, no href). Neither takes a callback across a
 * server/client boundary — `NavTabs`' hrefs are plain strings a server
 * component can build, and `PanelTabs` never leaves the client component that
 * owns it.
 */

export interface NavTab { key: string; label: string; href: string; active: boolean }

export function NavTabs({ tabs, ariaLabel }: { tabs: NavTab[]; ariaLabel: string }) {
  return (
    <nav className="segmented" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} data-active={t.active || undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

export interface PanelTab { key: string; label: string }

export function PanelTabs({
  tabs, active, onSelect, ariaLabel,
}: { tabs: PanelTab[]; active: string; onSelect: (key: string) => void; ariaLabel: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          data-active={t.key === active || undefined}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
