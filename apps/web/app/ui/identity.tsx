/**
 * Identity, derived rather than stored.
 *
 * The teams in this league are named and not branded — "Team 4" is a real
 * name here — so ten rows of near-identical text is what the data actually
 * is. A monogram in a hue derived from the team's own id is presentation,
 * not invention: it carries no claim the database does not already make, and
 * it is stable, so the same team is the same colour on every screen.
 */

/** A hue from an id. Golden-angle stepped, so neighbours never collide. */
export function hueFor(seed: number | string): number {
  const n = typeof seed === "number"
    ? seed
    : [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
  return Math.round((n * 137.508) % 360);
}

/** Up to two letters: initials when the name has them, else the trailing number. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const digits = words[words.length - 1]!.match(/^\d+$/);
  if (digits && words.length > 1) return `${words[0]![0]}${digits[0]}`.slice(0, 3).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}

export function Avatar({
  name, seed, size = "md", mine = false, ring,
}: {
  name: string;
  /** Anything stable — a team id, usually. Falls back to the name. */
  seed?: number | string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  mine?: boolean;
  /**
   * A school colour, drawn as a ring outside the monogram. Additive to the
   * derived hue rather than a replacement for it — the monogram still says
   * who, the ring says which school, and a player transferring schools moves
   * rings without losing the identity his own id already derived.
   */
  ring?: string | null;
}) {
  return (
    <span
      className={`avatar${size === "md" ? "" : ` ${size}`}`}
      style={{
        ["--hue" as string]: hueFor(seed ?? name),
        ...(ring ? { ["--ring" as string]: ring } : {}),
      }}
      data-mine={mine || undefined}
      data-ring={ring ? true : undefined}
      aria-hidden="true"
    >
      {monogram(name)}
    </span>
  );
}
