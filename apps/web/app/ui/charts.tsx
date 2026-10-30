/**
 * Small inline-SVG charts, hand-drawn like the icon set in `glyphs.tsx` — a
 * rank trend is a handful of points, not a library's worth of chart types.
 */

/** A rank over time, axis inverted so rank 1 — the best — sits at the top. */
export function RankTrendChart({
  points, height = 64,
}: { points: { playedOn: string; rank: number }[]; height?: number }) {
  if (points.length < 2) return null;

  const width = 100;
  const pad = 4;
  const ranks = points.map((p) => p.rank);
  const best = Math.min(...ranks);
  const worst = Math.max(...ranks);
  const span = Math.max(1, worst - best);

  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (rank: number) => pad + ((rank - best) / span) * (height - pad * 2);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.rank).toFixed(2)}`)
    .join(" ");
  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none"
      role="img"
      aria-label={
        `Overall rank from ${first.rank} on ${first.playedOn} to ${last.rank} on ${last.playedOn}` +
        ` — rank 1 is best`
      }
    >
      <path
        d={path} fill="none" stroke="var(--accent)" strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(points.length - 1)} cy={y(last.rank)} r={2.6} fill="var(--accent)" />
    </svg>
  );
}

/**
 * Where a projection sits and how sure the model is of it: a track from zero
 * to the best projection in the pool, the model's range drawn on it as a band,
 * and the projection itself as the tick. Read left to right like a ruler, so
 * two players' strips compare at a glance.
 */
export function RangeStrip({
  value, lo, hi, top, label,
}: { value: number; lo: number | null; hi: number | null; top: number; label: string }) {
  // The best projection's own range can run past it, so the ruler ends at whichever is further.
  const end = Math.max(top, hi ?? 0, 1);
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / end) * 100)).toFixed(2)}%`;
  return (
    <span className="rangestrip" role="img" aria-label={label}>
      {lo !== null && hi !== null ? (
        <span className="rangestrip-band" style={{ left: at(lo), right: `calc(100% - ${at(hi)})` }} />
      ) : null}
      <span className="rangestrip-tick" style={{ left: at(value) }} />
    </span>
  );
}

/**
 * A projection morning by morning: the line is the Player Score, the shaded
 * band the model's range around it. The axis is fitted to the band, not to
 * zero — a projection moves a point or two, and a chart pinned at zero would
 * draw that as a flat line.
 */
export function ProjectionTrendChart({
  points, height = 72,
}: { points: { asOf: string; score: number; lo: number | null; hi: number | null }[]; height?: number }) {
  if (points.length < 2) return null;
  const width = 100;
  const pad = 5;
  const all = points.flatMap((p) => [p.score, p.lo ?? p.score, p.hi ?? p.score]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.score).toFixed(2)}`).join(" ");
  const banded = points.every((p) => p.lo !== null && p.hi !== null);
  const band = banded
    ? points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.hi!).toFixed(2)}`).join(" ")
      + " " + [...points].reverse().map((p, j) => `L${x(points.length - 1 - j).toFixed(2)},${y(p.lo!).toFixed(2)}`).join(" ")
      + " Z"
    : null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img"
      aria-label={`Projected Player Score from ${first.score.toFixed(1)} on ${first.asOf} to ${last.score.toFixed(1)} on ${last.asOf}`}
    >
      {band ? <path d={band} fill="var(--accent)" opacity={0.14} /> : null}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(last.score)} r={2.6} fill="var(--accent)" />
    </svg>
  );
}
