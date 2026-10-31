import { ImageResponse } from "next/og";

/**
 * The home-screen icon: the Block I on the masthead navy, full bleed so the
 * phone's own corner mask does the rounding. The mark sits inside the
 * centre 60%, which keeps it clear of the circle Android crops a maskable
 * icon to.
 */
export function appIcon(size: number): ImageResponse {
  const h = Math.round(size * 0.6);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#081226" }}>
        <svg width={Math.round(h * 42 / 54)} height={h} viewBox="0 0 42 54">
          <path d="M2 2H40V15H29V39H40V52H2V39H13V15H2Z" fill="#FF5F05" stroke="#F4F6FA" strokeWidth={2.5} strokeLinejoin="miter" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
