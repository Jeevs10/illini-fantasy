/**
 * The day a game belongs to, as everyone but UTC would name it.
 *
 * CBBD timestamps a tip-off in UTC, so a 9pm ET game on the 10th is already the
 * 11th in UTC — and Torvik, which labels a box score with the local game date,
 * calls it the 10th. Storing the UTC date filed 158 of 280 games a day late,
 * which nothing noticed while lineups were derived from the box scores; join
 * the schedule instead and half the slate vanishes.
 *
 * The boundary is 09:00 UTC — 4am Eastern, 1am Pacific. Nothing tips between
 * 05:00 and 16:00 UTC, so the empty band is hours wide on both sides.
 */
export function basketballDate(startDate: string): string {
  const shifted = new Date(startDate);
  shifted.setUTCHours(shifted.getUTCHours() - 9);
  return shifted.toISOString().slice(0, 10);
}

/** The calendar date in the Eastern time zone, for a CBBD start with no real time behind it. */
export function easternDate(instant: string): string {
  return new Date(instant).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
