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
