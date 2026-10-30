import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { Nav } from "./nav.tsx";
import { LeagueSwitch } from "./leagueswitch.tsx";
import { ProfileMenu } from "./profile-menu.tsx";
import { who } from "../lib/session.ts";

// Archivo on its width axis: condensed for labels that have to fit, normal
// for interface, expanded for the scores. One family doing three jobs beats
// three families doing one each. Self-hosted by next/font, so the first paint
// does not wait on a third-party stylesheet.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const serif = Source_Serif_4({
  subsets: ["latin"], axes: ["opsz"], weight: "variable", style: ["normal"], variable: "--font-serif", display: "swap",
});
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Illini Fantasy Hoops",
  description: "College basketball fantasy, scored on the CBB Player-Score model.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#13294B" },
    { media: "(prefers-color-scheme: dark)", color: "#0C1422" },
  ],
};

export default async function RootLayout({
  children, card,
}: { children: React.ReactNode; card: React.ReactNode }) {
  // Cached for the request, so asking here for the nav costs nothing on top of
  // the page's own call.
  const viewer = await who();
  const signedIn = viewer.state === "anonymous" ? null : viewer.state === "member"
    ? {
        name: viewer.viewer.name || viewer.viewer.email,
        commissioner: viewer.viewer.membership.role === "commissioner",
        leagues: viewer.viewer.memberships.map((m) => ({ leagueId: m.leagueId, leagueName: m.leagueName })),
        current: viewer.viewer.membership.leagueId,
      }
    : { name: viewer.name || viewer.email, commissioner: false, leagues: [], current: 0 };
  return (
    <html lang="en" className={`${archivo.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        {signedIn ? (
          <Nav commissioner={signedIn.commissioner}>
            <LeagueSwitch leagues={signedIn.leagues} current={signedIn.current} />
            <ProfileMenu name={signedIn.name} commissioner={signedIn.commissioner} />
          </Nav>
        ) : null}
        <main className="page">{children}</main>
        {card}
      </body>
    </html>
  );
}
