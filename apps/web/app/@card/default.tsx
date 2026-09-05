/**
 * The `@card` slot's default — rendered for every route that is not the
 * intercepted player page, which is all of them most of the time. Parallel
 * routes require one; a slot with no default throws on any URL it does not
 * itself match.
 */
export default function Default() {
  return null;
}
