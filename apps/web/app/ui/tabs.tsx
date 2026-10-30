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

/** The ids a tab and its panel share, so each can name the other. */
export const tabId = (base: string, key: string) => `${base}-tab-${key}`;
export const panelId = (base: string) => `${base}-panel`;

/**
 * The ARIA tabs pattern: one tab in the Tab order, the arrow keys (and Home
 * and End) moving between them, each naming the panel it controls. The owner
 * renders that panel with `role="tabpanel"` and `id={panelId(idBase)}`.
 */
export function PanelTabs({
  tabs, active, onSelect, ariaLabel, idBase,
}: { tabs: PanelTab[]; active: string; onSelect: (key: string) => void; ariaLabel: string; idBase: string }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === active);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(tabs[next]!.key);
    document.getElementById(tabId(idBase, tabs[next]!.key))?.focus();
  };
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(idBase, t.key)}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          aria-controls={panelId(idBase)}
          tabIndex={t.key === active ? 0 : -1}
          data-active={t.key === active || undefined}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
