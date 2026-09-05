/**
 * The icon set.
 *
 * Hand-drawn on a 24-grid rather than pulled from a library: eleven glyphs is
 * not worth a dependency, and drawing them here keeps the stroke weight
 * matched to Archivo's rather than to somebody else's grid.
 */

const base = {
  width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.9,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true as const, focusable: "false" as const,
};

export type GlyphName =
  | "home" | "team" | "matchup" | "players" | "league" | "draft"
  | "waivers" | "trades" | "search" | "more" | "clock" | "alert"
  | "chevron" | "bolt" | "check" | "swap" | "empty" | "trophy" | "star" | "close";

export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  const p = { ...base, width: size, height: size };
  switch (name) {
    case "home":
      return <svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /></svg>;
    case "team":
      return <svg {...p}><path d="M4 20v-1.5A3.5 3.5 0 0 1 7.5 15h4A3.5 3.5 0 0 1 15 18.5V20" /><circle cx="9.5" cy="8" r="3.2" /><path d="M17 20v-1.6c0-1.3-.7-2.4-1.7-3" /><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6" /></svg>;
    case "matchup":
      return <svg {...p}><path d="M4 6h5v12H4z" /><path d="M15 6h5v12h-5z" /><path d="M12 8v8" /></svg>;
    case "players":
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5c3 3 3 14 0 17M3.6 12h16.8M5 7.2c4 2 10 2 14 0M5 16.8c4-2 10-2 14 0" /></svg>;
    case "league":
      return <svg {...p}><path d="M7 20h10M12 15.5V20" /><path d="M6 4h12v4.5a6 6 0 0 1-12 0z" /><path d="M6 6H3.5v1.5A3.5 3.5 0 0 0 6 10.8M18 6h2.5v1.5A3.5 3.5 0 0 1 18 10.8" /></svg>;
    case "draft":
      return <svg {...p}><path d="M4 6h16M4 12h16M4 18h9" /><circle cx="18.5" cy="18" r="2.5" /></svg>;
    case "waivers":
      return <svg {...p}><path d="M12 4v16M4 9l8-5 8 5" /><path d="M4 9v6a8 8 0 0 0 16 0V9" /></svg>;
    case "trades":
      return <svg {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>;
    case "swap":
      return <svg {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>;
    case "search":
      return <svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
    case "more":
      return <svg {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>;
    case "clock":
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg>;
    case "alert":
      return <svg {...p}><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4M12 16.8v.2" /></svg>;
    case "bolt":
      return <svg {...p}><path d="M13 3 5 13.5h6L11 21l8-10.5h-6z" /></svg>;
    case "check":
      return <svg {...p}><path d="m5 12.5 4.5 4.5L19 7" /></svg>;
    case "chevron":
      return <svg {...p}><path d="m9 5 7 7-7 7" /></svg>;
    case "empty":
      return <svg {...p}><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" /><path d="M4 8.5 12 13l8-4.5M12 13v7" /></svg>;
    case "trophy":
      return <svg {...p}><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 5H4v2a4 4 0 0 0 4 4M17 5h3v2a4 4 0 0 1-4 4" /><path d="M12 14v3M9 20h6M9.5 17h5l.5 3H9z" /></svg>;
    case "star":
      return <svg {...p}><path d="M12 3.5 14.7 9.4 21 10.2 16.4 14.5 17.6 20.8 12 17.6 6.4 20.8 7.6 14.5 3 10.2 9.3 9.4z" /></svg>;
    case "close":
      return <svg {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
  }
}
