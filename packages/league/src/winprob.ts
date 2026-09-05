/**
 * Win probability, from a projected margin and how many games are left to
 * settle it.
 *
 * Grounded rather than invented: the standard deviation of one player's one
 * game under this league's scoring model, measured off `player_game_score`
 * across a full season (~17 points, mean ~27), is the unit of uncertainty a
 * game still to play actually carries. More games left widens the spread
 * around the projected margin; a bigger projected lead narrows how much of
 * that spread still favours the trailing side. This is a model exactly the
 * way `projected` already is on `TeamOutlook` — displayed as one, not as a
 * fact, and wrong in exactly the way the rest of the app's projections are
 * wrong when a player's average does not predict his next game.
 */

/** Per-player-game score standard deviation, measured against real data. */
const PLAYER_GAME_STDEV = 17;

/** Abramowitz–Stegun 7.1.26, good to ~1.5e-7 — no stats library for one call. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * The left side's chance of finishing ahead, given its projected margin over
 * the right side and how many games either side still has to play.
 *
 * With nothing left, the margin has already happened: a lead is certain, a
 * deficit is lost, and a tie is a coin flip — none of them a model's call to
 * make. `NaN` and infinite margins are not domain errors here (an unplayed
 * bye week can report either), so they fall through to the same certain
 * answer a zero-variance margin would.
 */
export function winProbability(projectedMargin: number, gamesRemaining: number): number {
  if (gamesRemaining <= 0) {
    return projectedMargin > 0 ? 1 : projectedMargin < 0 ? 0 : 0.5;
  }
  const spread = PLAYER_GAME_STDEV * Math.sqrt(gamesRemaining);
  return normalCdf(projectedMargin / spread);
}
