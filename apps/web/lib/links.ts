/**
 * Every URL a screen builds to a player or a school, in one place, so a link
 * cannot drift from the route that answers it.
 *
 * A player's path carries his name after the id — `/players/3734-tyler-tanner`
 * — so a pasted link says who it is. Only the id is read; the name is
 * decoration, and a stale one still resolves (the full page redirects to the
 * current spelling).
 */

const kebab = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function playerPath(id: number, name?: string | null): string {
  const tail = name ? kebab(name) : "";
  return tail ? `/players/${id}-${tail}` : `/players/${id}`;
}

/** The id at the front of a `/players/[id]` segment, or NaN. */
export const idFromParam = (param: string) => {
  const m = /^(\d+)(?:-|$)/.exec(decodeURIComponent(param));
  return m ? Number(m[1]) : NaN;
};

export const schoolPath = (slug: string) => `/schools/${slug}`;

/** From a school's crosswalk key ("st johns") — the same rule as `schoolSlug` in @illini/league. */
export const schoolPathFor = (key: string) => schoolPath(key.replace(/ /g, "-"));

/**
 * The Data repo's staff site, where the forward model's own player and team
 * pages live. Signed-in staff only on that side; a league member without an
 * account there lands on its sign-in page.
 */
export const DATA_SITE = (process.env.DATA_SITE_URL ?? "https://www.illini-prospect-analyzer.org").replace(/\/$/, "");

export const dataPlayerUrl = (forwardKey: string) => `${DATA_SITE}/college-players/${encodeURIComponent(forwardKey)}`;
export const dataTeamUrl = (forwardSlug: string) => `${DATA_SITE}/teams/${encodeURIComponent(forwardSlug)}`;
