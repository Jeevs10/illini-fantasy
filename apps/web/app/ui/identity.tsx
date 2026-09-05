"use client";

import { useEffect, useState } from "react";

/**
 * Identity, derived rather than stored.
 *
 * The teams in this league are named and not branded — "Team 4" is a real
 * name here — so ten rows of near-identical text is what the data actually
 * is. A monogram in a hue derived from the team's own id is presentation,
 * not invention: it carries no claim the database does not already make, and
 * it is stable, so the same team is the same colour on every screen.
 *
 * A real player, unlike a fantasy team, has a face — and ESPN already has it.
 * `public/headshots/ncaa_player_espn_ids.json` is a name→ESPN-player-id map
 * (same file, same matching rules, as the one illini-prospect-analyzer.org
 * ships at the same path) fetched once client-side and matched against
 * whatever name this component is given. A fantasy team's name ("Team 4")
 * simply never matches, so it falls straight through to the monogram below —
 * one code path serves both, and no call site needs to say which it has.
 */

// Serve headshots through ESPN's combiner (resizer), not the raw /full/ path —
// that source image is 600x436 and far too heavy for an avatar-sized tile.
// scale=crop is required: without it the combiner squashes the landscape
// source into a square instead of cropping it, which compresses every face.
const ESPN_HEADSHOT_BASE =
  "https://a.espncdn.com/combiner/i?img=/i/headshots/mens-college-basketball/players/full";
const ESPN_HEADSHOT_PX = 128;

function espnHeadshotUrl(espnId: string): string {
  return `${ESPN_HEADSHOT_BASE}/${espnId}.png&w=${ESPN_HEADSHOT_PX}&h=${ESPN_HEADSHOT_PX}&scale=crop`;
}

// JSON keys are exact display names ("Melvin Council Jr."). A raw name from
// this app misses on punctuation, diacritics and "State" vs "St", so both the
// map's keys and every lookup normalise the same way before comparing.
//
// Suffixes (Jr/Sr/II/III/IV) get two passes because stripping them is not
// always safe — "Anthony Robinson II" and "Anthony Robinson" are two different
// people in the source data. `strictName` keeps the suffix, for an exact
// match; `looseName` strips it as a fallback, but only for names that turn out
// unambiguous once stripped — anything that collides two players under one
// stripped key is dropped rather than guessed.
function baseName(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\bstate\b/g, "st");
}
function strictName(name: string): string {
  return baseName(name).replace(/[^a-z0-9]+/g, " ").trim();
}
function looseName(name: string): string {
  return baseName(name)
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface EspnIdMaps { strict: Record<string, string>; loose: Record<string, string> }
const EMPTY_ESPN_MAPS: EspnIdMaps = { strict: {}, loose: {} };

function buildEspnIdMaps(raw: Record<string, string>): EspnIdMaps {
  const strict: Record<string, string> = {};
  const looseIds = new Map<string, Set<string>>();
  for (const [name, id] of Object.entries(raw)) {
    strict[strictName(name)] = id;
    const key = looseName(name);
    if (!looseIds.has(key)) looseIds.set(key, new Set());
    looseIds.get(key)!.add(id);
  }
  const loose: Record<string, string> = {};
  for (const [key, ids] of looseIds) {
    // Keep only unambiguous loose keys — never guess between two players.
    if (ids.size === 1) loose[key] = ids.values().next().value as string;
  }
  return { strict, loose };
}

function lookupEspnId(maps: EspnIdMaps, name: string): string | null {
  return maps.strict[strictName(name)] ?? maps.loose[looseName(name)] ?? null;
}

// Fetched once for the whole page: every Avatar awaits the same promise, so
// mounting fifty of them in a pool costs one request, not fifty.
let espnIdsPromise: Promise<EspnIdMaps> | null = null;
function loadEspnIds(): Promise<EspnIdMaps> {
  if (!espnIdsPromise) {
    espnIdsPromise = fetch("/headshots/ncaa_player_espn_ids.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((raw: Record<string, string>) => buildEspnIdMaps(raw))
      .catch(() => EMPTY_ESPN_MAPS); // degrade to no photos; never throw
  }
  return espnIdsPromise;
}

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
  const [espnId, setEspnId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    let live = true;
    loadEspnIds().then((maps) => {
      if (live) setEspnId(lookupEspnId(maps, name));
    });
    return () => { live = false; };
  }, [name]);

  const showPhoto = espnId !== null && !photoError;

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
      {showPhoto ? (
        <img
          className="avatar-photo"
          src={espnHeadshotUrl(espnId)}
          alt=""
          // The combiner 404s on an unknown id rather than serving a
          // placeholder, so a bad id has to fall back the same way a missed
          // name lookup does — back to the derived monogram.
          onError={() => setPhotoError(true)}
        />
      ) : monogram(name)}
    </span>
  );
}
