import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./nav.tsx";
import { LeagueSwitch } from "./leagueswitch.tsx";
import { SignOut } from "./signout.tsx";
import { who } from "../lib/session.ts";

export const metadata: Metadata = {
  title: "Illini Fantasy Hoops",
  description: "College basketball fantasy, scored on the CBB Player-Score model.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {signedIn ? (
          <Nav commissioner={signedIn.commissioner}>
            <LeagueSwitch leagues={signedIn.leagues} current={signedIn.current} />
            <SignOut name={signedIn.name} />
          </Nav>
        ) : null}
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
