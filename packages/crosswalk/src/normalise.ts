/**
 * Name and team normalisation for identity resolution.
 *
 * Four systems, four ID spaces, none shared: Torvik `pid`, ESPN `athlete.id`,
 * NCAA `playerid`, RotoWire `ID`. Every join between them runs through here.
 */

/**
 * Letters NFKD does not decompose, because they are distinct code points rather
 * than a base plus a combining mark. International rosters are full of them.
 */
const TRANSLITERATE: Record<string, string> = {
  "\u0110": "D", "\u0111": "d",   // Đ đ
  "\u00d8": "O", "\u00f8": "o",   // Ø ø
  "\u0141": "L", "\u0142": "l",   // Ł ł
  "\u00c6": "AE", "\u00e6": "ae", // Æ æ
  "\u0152": "OE", "\u0153": "oe", // Œ œ
  "\u00df": "ss",                  // ß
  "\u00d0": "D", "\u00f0": "d",   // Ð ð
  "\u00de": "Th", "\u00fe": "th", // Þ þ
  "\u0131": "i",                   // ı
};

/** Strip accents, punctuation and generational suffixes; casefold; collapse space. */
export function normaliseName(raw: string | null | undefined): string {
  // Sources are inconsistent about types — CBBD returns numeric school ids in
  // some recruiting rows where a name is expected. Coerce rather than throw,
  // so one bad row cannot take down a whole ingest.
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/[\u0110\u0111\u00d8\u00f8\u0141\u0142\u00c6\u00e6\u0152\u0153\u00df\u00d0\u00f0\u00de\u00fe\u0131]/g,
      (ch) => TRANSLITERATE[ch] ?? ch)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.'\u2019`]/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Last, First" -> "first last". Leaves anything else alone. */
export function canonicaliseName(raw: string | null | undefined): string {
  const source = raw === null || raw === undefined ? "" : String(raw);
  const comma = source.indexOf(",");
  const reordered = comma > 0
    ? `${source.slice(comma + 1).trim()} ${source.slice(0, comma).trim()}`
    : source;
  return normaliseName(reordered);
}

/**
 * Team-name aliases. Built from the 38 RotoWire team names that had no NCAA
 * counterpart, plus the Torvik and CBBD spellings for the same schools.
 * Keys are already normalised; values are the canonical school name.
 */
const TEAM_ALIASES: Record<string, string> = {
  // RotoWire spellings
  "connecticut": "UConn",
  "central florida": "UCF",
  "arkansas little rock": "Little Rock",
  "college of charleston": "Charleston",
  "citadel": "The Citadel",
  // Torvik spellings, checked against CBBD's own team list.
  "albany": "UAlbany",
  "grambling state": "Grambling",
  "mcneese state": "McNeese",
  "nicholls state": "Nicholls",
  "appalachian state": "App State",
  "cal baptist": "California Baptist",
  "fiu": "Florida International",
  "illinois chicago": "UIC",
  "iu indy": "IU Indianapolis",
  "liu": "Long Island University",
  "loyola md": "Loyola Maryland",
  "mississippi": "Ole Miss",
  "penn": "Pennsylvania",
  "saint francis": "St. Francis (PA)",
  "southeastern louisiana": "SE Louisiana",
  "st thomas": "St. Thomas-Minnesota",
  "saint thomas": "St. Thomas-Minnesota",
  "tennessee martin": "UT Martin",
  "texas a and m corpus chris": "Texas A&M-Corpus Christi",
  "umkc": "Kansas City",
  "usc upstate": "South Carolina Upstate",
  // Sources disagree on whether "State" belongs in the school name at all.
  "middle tennessee state": "Middle Tennessee",
  "middle tennessee st": "Middle Tennessee",
  "san jose state": "San Jose State",
  "sam houston": "Sam Houston",
  "cal state bakersfield": "Cal State Bakersfield",
  "cal state fullerton": "Cal State Fullerton",
  "bethune cookman": "Bethune-Cookman",
  "cal state northridge": "Cal State Northridge",
  "e tennessee state": "East Tennessee State",
  "alcorn state": "Alcorn State",
  "delaware state": "Delaware State",
  "florida a&m": "Florida A&M",
  "chicago state": "Chicago State",
  "louisiana lafayette": "Louisiana",
  "louisiana monroe": "UL Monroe",
  "miami florida": "Miami",
  "miami fl": "Miami",
  "miami ohio": "Miami (OH)",
  "miami oh": "Miami (OH)",
  "texas a&m corpus christi": "Texas A&M-Corpus Christi",
  "southern mississippi": "Southern Miss",
  "nc state": "NC State",
  "north carolina state": "NC State",
  "saint marys": "Saint Mary's",
  "st marys": "Saint Mary's",
  "saint josephs": "Saint Joseph's",
  "st josephs": "Saint Joseph's",
  "saint peters": "Saint Peter's",
  "detroit": "Detroit Mercy",
  "loyola chicago": "Loyola Chicago",
  "loyola marymount": "Loyola Marymount",
  "sam houston state": "Sam Houston",
  "seattle": "Seattle U",
  "omaha": "Nebraska Omaha",
  "purdue fort wayne": "Purdue Fort Wayne",
  "iupui": "IU Indianapolis",
  "utsa": "UT San Antonio",
  "utep": "UTEP",
  "smu": "SMU",
  "tcu": "TCU",
  "lsu": "LSU",
  "byu": "BYU",
  "vcu": "VCU",
  "unlv": "UNLV",
  "uab": "UAB",
  "usc": "USC",
  "ucla": "UCLA",
  "ucf": "UCF",
  "uconn": "UConn",
};

/**
 * Schools whose "College" or "University" is the whole distinction.
 *
 * The strip below exists because sources disagree about whether a school's name
 * carries the word at all — CBBD's "American University" and Torvik's
 * "American" are one school, as are "Queens University" and "Queens". It is
 * wrong wherever two *different* programmes differ only by that word: dropping
 * it files Boston College and Boston University under "boston", pooling two
 * rosters and two schedules onto one row, and the only visible symptom is that
 * the merged team appears to play twice on the same night.
 *
 * Which of the two a name is cannot be derived — it is a fact about the
 * schools. Keys here are the normalised form with the word kept. Bare
 * "Colorado" and "Georgia" stay as they are; it is their much smaller
 * namesakes, which appear only as opponents on the schedule, that move.
 */
const KEEPS_ITS_SUFFIX = new Set([
  "boston college",
  "boston university",
  "colorado college",
  "georgia college",
]);

/**
 * Torvik abbreviates "State" to "St.", so the two sources disagree on ~90
 * schools. But a *leading* "St." is Saint, not State — expanding it blindly
 * turned "St. Thomas" into "state thomas". Only a trailing "St" is State.
 */
function expandStateAbbreviation(name: string): string {
  return name.replace(/(?<!^)\bst\b\.?(?=\s|$)/g, "state").replace(/\s+/g, " ").trim();
}

/**
 * Canonical form of a school name.
 *
 * Applies aliases and the strip pipeline repeatedly until the result stops
 * changing. A single pass is not enough: an alias's *output* has to go through
 * the same normalisation its input did, or "LIU" -> "Long Island University"
 * ends up beside CBBD's own "Long Island University" -> "long island", and the
 * two never meet.
 */
export function normaliseTeam(raw: string | null | undefined): string {
  let current = normaliseName(raw).replace(/&/g, " and ").replace(/\s+/g, " ").trim();

  for (let pass = 0; pass < 4; pass += 1) {
    // Aliases are checked before stripping "college"/"university", or an entry
    // like "college of charleston" can never match its own key.
    const aliased = TEAM_ALIASES[current] ?? TEAM_ALIASES[expandStateAbbreviation(current)];
    const stripped = KEEPS_ITS_SUFFIX.has(current)
      ? current
      : current
        .replace(/\b(university|college)\b/g, "")
        .replace(/^\s*of\s+/, "")
        .replace(/\s+of\s+/g, " ");
    const next = normaliseName(aliased ?? stripped)
      .replace(/&/g, " and ").replace(/\s+/g, " ").trim();

    const expanded = expandStateAbbreviation(next);
    if (expanded === current) return current;
    current = expanded;
  }
  return current;
}

/** Register additional aliases at runtime, e.g. from a commissioner override. */
export function addTeamAlias(from: string, to: string): void {
  TEAM_ALIASES[normaliseName(from)] = to;
}
