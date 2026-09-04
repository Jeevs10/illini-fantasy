import Link from "next/link";
import type { GameState } from "@illini/league";
import { Glyph, type GlyphName } from "./glyphs.tsx";

/* Small shared parts. Everything here is presentational and takes only what
   the caller already has, so nothing in this file can decide to show a number
   the page did not fetch. */

/** A fantasy score, in the broadcast voice. */
export function Score({
  value, size = "md", tone = "default", className = "",
}: {
  value: number;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  tone?: "default" | "lead" | "quiet" | "accent" | "live";
  className?: string;
}) {
  const colour = tone === "quiet" ? "var(--ink-3)"
    : tone === "accent" ? "var(--accent)"
    : tone === "live" ? "var(--live)"
    : undefined;
  return (
    <span
      className={`score score-${size} ${className}`}
      style={colour ? { color: colour } : undefined}
      data-lead={tone === "lead" || undefined}
    >
      {value.toFixed(1)}
    </span>
  );
}

/** LIVE, with a dot that breathes. Never colour alone — the word is there. */
export function LiveTag({ label = "Live" }: { label?: string }) {
  return <span className="pill live"><span className="livedot" />{label}</span>;
}

/**
 * What is happening to a player's night.
 *
 * Three states and no fourth: the box score exists, the game has tipped off
 * and it does not, or it has not tipped off. Anything else would be a claim
 * about a game the app cannot see.
 */
export function GameStatus({
  state, tipoff, opponent, compact = false,
}: { state: GameState; tipoff: string | null; opponent: string | null; compact?: boolean }) {
  if (state === "live") return <LiveTag />;
  if (state === "final") return <span className="pill">Final</span>;
  return (
    <span className="pill ghost">
      {tipoff ? <ET iso={tipoff} /> : "TBD"}
      {!compact && opponent ? ` · ${opponent}` : ""}
    </span>
  );
}

/**
 * What Torvik calls it, what the score explains it as, and what it starts at.
 *
 * Kept here rather than imported from `@illini/league` — this is presentation
 * for a client component, and pulling a value from that package would drag
 * the Postgres driver its barrel also exports into the browser bundle. The
 * eligibility this mirrors is enforced server-side, in `slots.ts`; this table
 * only has to agree with it, not be it.
 */
const ROLE_TABLE: { torvik: string; archetype: string; role: string }[] = [
  { torvik: "Pure PG", archetype: "lead", role: "G" },
  { torvik: "Scoring PG", archetype: "lead", role: "G" },
  { torvik: "Combo G", archetype: "combo", role: "G" },
  { torvik: "Wing G", archetype: "combo", role: "G · F" },
  { torvik: "Wing F", archetype: "wing", role: "F" },
  { torvik: "Stretch 4", archetype: "swing", role: "F" },
  { torvik: "PF/C", archetype: "big", role: "F · B" },
  { torvik: "C", archetype: "big", role: "B" },
];
const ROLE_TAG = new Map(ROLE_TABLE.map((r) => [r.torvik, r.role]));

/**
 * The lineup role — G, F, B, or both of a pair for a Wing G or a PF/C.
 *
 * Not the archetype: `lead`/`combo`/`wing`/`swing`/`big` explain the score,
 * this is what the slot machinery actually checks. A role this app does not
 * recognise reads as "—" rather than a guess, the same choice server-side
 * eligibility makes for FLEX.
 */
export function RoleTag({ role }: { role: string | null }) {
  const tag = role === null ? undefined : ROLE_TAG.get(role);
  return <span className="pill ghost">{tag ?? "—"}</span>;
}

/**
 * The three position vocabularies this app runs on, mapped to each other.
 *
 * Torvik's role, the scoring model's archetype, and the roster slot are three
 * names for the same underlying thing, and nothing else on screen says so —
 * this is the one place that does.
 */
export function RoleGlossary() {
  return (
    <details className="glossary">
      <summary>What do G, F and B mean?</summary>
      <p>
        Three names for the same position, from three parts of the app: the
        role Torvik reports, the archetype the scoring model weights against,
        and the slot it starts at.
      </p>
      <table>
        <thead>
          <tr><th scope="col">Torvik role</th><th scope="col">Archetype</th><th scope="col">Starts at</th></tr>
        </thead>
        <tbody>
          {ROLE_TABLE.map((r) => (
            <tr key={r.torvik}>
              <td>{r.torvik}</td><td>{r.archetype}</td><td>{r.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * A tip-off, always in Eastern.
 *
 * Not the viewer's zone: formatting from the browser means the server renders
 * one string and the client another, which is a hydration mismatch and — as it
 * turned out once — a column that silently flips to UTC on a client-side
 * navigation. College tip-offs are published in Eastern anyway.
 */
const ET_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
});
export function ET({ iso }: { iso: string }) {
  return <time dateTime={iso}>{ET_TIME.format(new Date(iso))}</time>;
}

export function StatTile({
  label, value, note, tone,
}: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "accent" | "live" | "warn" }) {
  const colour = tone === "accent" ? "var(--accent)"
    : tone === "live" ? "var(--live)"
    : tone === "warn" ? "var(--warn)" : undefined;
  return (
    <div className="tile">
      <div className="cap">{label}</div>
      <div className="val score score-md" style={colour ? { color: colour } : undefined}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

export function SectionHead({
  title, action, href, children,
}: { title: string; action?: string; href?: string; children?: React.ReactNode }) {
  return (
    <div className="sectionhead">
      <h2>{title}</h2>
      {children}
      {action && href ? <Link href={href}>{action} →</Link> : null}
    </div>
  );
}

export function Empty({
  glyph = "empty", title, children, action,
}: { glyph?: GlyphName; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="glyph"><Glyph name={glyph} size={22} /></span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div className="controls">{action}</div> : null}
    </div>
  );
}

/** A share-of-total bar. Width is a percentage the caller has already worked out. */
export function Bar({
  percent, tone, thick = false, thin = false, label,
}: { percent: number; tone?: "live" | "quiet"; thick?: boolean; thin?: boolean; label?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span
      className={`bar${thick ? " thick" : ""}${thin ? " thin" : ""}`}
      role={label ? "meter" : undefined}
      aria-label={label}
      aria-valuenow={label ? Math.round(clamped) : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
    >
      <span style={{ width: `${clamped}%` }} data-tone={tone} />
    </span>
  );
}
