import { ImageResponse } from "next/og";

/**
 * The home-screen icon: a championship banner from the rafters, in Illinois
 * Orange with a stitched edge and the notched hem the home page's banners
 * have, hanging from its rod over the masthead navy, a basketball on it.
 *
 * Full bleed, so the phone's own corner mask does the rounding, and drawn
 * inside the centre 80% so Android's circular crop of a maskable icon keeps
 * all of it.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="90%">
      <stop offset="0" stop-color="#1B3366"/><stop offset="1" stop-color="#081226"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" fill="url(#glow)"/>
  <g transform="translate(50 50) scale(0.9) translate(-50 -50)">
    <rect x="18" y="15" width="64" height="2.6" rx="1.3" fill="#9AA8C2"/>
    <path d="M25 18H75V84L50 75L25 84Z" fill="#FF5F05"/>
    <path d="M28.5 21.5H71.5V79L50 71.3L28.5 79Z" fill="none" stroke="#F4F6FA" stroke-width="1.1"
          stroke-dasharray="2.2 1.6" stroke-linejoin="round"/>
    <g transform="translate(50 45)">
      <circle r="16" fill="#081226" stroke="#F4F6FA" stroke-width="1.2"/>
      <g fill="none" stroke="#FF5F05" stroke-width="1.6" stroke-linecap="round">
        <path d="M0 -16V16"/>
        <path d="M-16 0H16"/>
        <path d="M-10.5 -12C-4 -6 -4 6 -10.5 12"/>
        <path d="M10.5 -12C4 -6 4 6 10.5 12"/>
      </g>
    </g>
  </g>
</svg>`;

const SRC = `data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`;

export function appIcon(size: number): ImageResponse {
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={SRC} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
