import type { MetadataRoute } from "next";

/** Lets a phone install the site as an app that opens on Home, full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Illini Fantasy Hoops",
    short_name: "Illini Fantasy",
    start_url: "/home",
    display: "standalone",
    background_color: "#081226",
    theme_color: "#0C1A33",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
