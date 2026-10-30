/**
 * The Block I, drawn: the program's mark, in Illinois Orange with a banner-
 * white keyline so it holds on the navy. Used in the masthead and on the
 * sign-in card only — it is the program's signature, not an ornament.
 */
export function BlockI({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={Math.round(size * 0.78)} height={size} viewBox="0 0 42 54"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      className="blocki"
    >
      <path
        d="M2 2H40V15H29V39H40V52H2V39H13V15H2Z"
        fill="var(--accent)" stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="miter"
      />
    </svg>
  );
}
