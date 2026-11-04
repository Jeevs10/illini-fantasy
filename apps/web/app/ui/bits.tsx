import Link from "next/link";
import type { AvailabilityStatus, BoxLine, GameState } from "@illini/league";
import { Arrow, Glyph, type GlyphName } from "./glyphs.tsx";

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

/**
 * A week's number, by what kind of number it is. Before anything is scored
 * the projection leads, stitched dashed and called projected, because "0.0"
 * is not what a week that has not started is worth. Once points are banked
 * the score leads and the projection sits under it while games remain.
 */
export function WeekFigure({
  scored, projected, played, size = "md", tone = "default", block = false,
}: {
  scored: number;
  projected: number;
  /** Whether any game in the span has a score yet. */
  played: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  tone?: "default" | "accent";
  /** Stack the note under the number instead of beside it. */
  block?: boolean;
}) {
  if (!played) {
    return (
      <span className="weekfig" data-block={block || undefined}>
        <span className="weekfig-proj" data-stitch="projected">
          <Score value={projected} size={size} tone={tone === "accent" ? "accent" : "default"} />
        </span>
        <span className="weekfig-note">projected</span>
      </span>
    );
  }
  return (
    <span className="weekfig" data-block={block || undefined}>
      <Score value={scored} size={size} tone={tone} />
      {projected > scored + 0.05 ? (
        <span className="weekfig-note">proj <strong className="tnum">{projected.toFixed(1)}</strong></span>
      ) : null}
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
// The forward model's own G / F / C, beside Torvik's eight. "C" is in both.
const ROLE_TAG = new Map([...ROLE_TABLE.map((r) => [r.torvik, r.role] as const), ["G", "G"], ["F", "F"]]);

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

const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  out: "Out", doubtful: "Doubtful", questionable: "Questionable",
  probable: "Probable", available: "Available",
};
const AVAILABILITY_TONE: Record<AvailabilityStatus, "crit" | "warn" | "ghost"> = {
  out: "crit", doubtful: "crit", questionable: "warn", probable: "ghost", available: "ghost",
};

/**
 * The injury glyph, silent for a healthy or an unreported player.
 *
 * `status` is `undefined` for a player `availabilityFor` has no row for at
 * all — nothing has ever been said about him, which is not the same fact as
 * RotoWire reporting him fine, so it renders nothing rather than a claim the
 * ingest never made. `available` renders nothing for the same reason a
 * healthy player needs no callout.
 */
export function AvailabilityTag({
  status, injury, compact = false,
}: { status: AvailabilityStatus | undefined; injury?: string | null; compact?: boolean }) {
  if (!status || status === "available") return null;
  const label = AVAILABILITY_LABEL[status];
  return (
    <span
      className={`pill availability ${AVAILABILITY_TONE[status]}`}
      title={injury ? `${label} — ${injury}` : label}
    >
      <Glyph name="alert" size={12} />
      {compact ? null : label}
    </span>
  );
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
 * The switch between two views the nav now folds into one tab — Standings
 * with Playoffs, Players with Leaders. A real navigation (two routes, each
 * bookmarkable and back-button-able) presented as a same-tab toggle, not a
 * client-side view swap: the two sides read very differently sized data and
 * neither owes the other its query shape.
 */
export function SubTabs({
  tabs, active,
}: { tabs: { href: string; label: string }[]; active: string }) {
  return (
    <nav className="segmented" aria-label="View">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} data-active={t.href === active}>{t.label}</Link>
      ))}
    </nav>
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
/**
 * "14 pts · 6 reb · 3 ast · 24 min" — the box line a score is made of. Steals
 * and blocks only when there are some, so a quiet night stays short.
 */
export function statLine(l: BoxLine): string {
  const bits = [`${l.pts} pts`, `${l.reb} reb`, `${l.ast} ast`];
  if (l.stl) bits.push(`${l.stl} stl`);
  if (l.blk) bits.push(`${l.blk} blk`);
  return `${bits.join(" · ")} · ${l.min} min`;
}

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
      {action && href ? <Link href={href} className="arrowlink">{action} <Arrow /></Link> : null}
    </div>
  );
}

export function Empty({
  glyph = "empty", title, children, action,
}: { glyph?: GlyphName; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty" data-glyph={glyph}>
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
