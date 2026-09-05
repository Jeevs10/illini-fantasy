import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "./nav.tsx";
import { LeagueSwitch } from "./leagueswitch.tsx";
import { ProfileMenu } from "./profile-menu.tsx";
import { who } from "../lib/session.ts";

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Archivo on its width axis: condensed for labels that have to fit,
            normal for interface, expanded for the scores. One family doing
            three jobs beats three families doing one each. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
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
