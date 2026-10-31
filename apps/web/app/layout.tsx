import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Graduate } from "next/font/google";
import "./globals.css";
import { Nav } from "./nav.tsx";
import { LeagueSwitch } from "./leagueswitch.tsx";
import { ProfileMenu } from "./profile-menu.tsx";
import { who } from "../lib/session.ts";

// Barlow for the interface, its condensed cut for the caps labels, and
// Graduate — a varsity block — only for banner marks and headline numbers.
// Self-hosted by next/font, so the first paint waits on nobody else.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-barlow", display: "swap" });
const barlowCond = Barlow_Condensed({
  subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow-cond", display: "swap",
});
const graduate = Graduate({ subsets: ["latin"], weight: "400", variable: "--font-graduate", display: "swap" });

export const metadata: Metadata = {
  title: "Illini Fantasy Hoops",
  description: "The Illinois staff fantasy league, scored on the forward model.",
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#0C1A33" },
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
        addDrop: viewer.viewer.membership.settings.weeklyAdds != null,
        leagues: viewer.viewer.memberships.map((m) => ({ leagueId: m.leagueId, leagueName: m.leagueName })),
        current: viewer.viewer.membership.leagueId,
      }
    : { name: viewer.name || viewer.email, commissioner: false, addDrop: false, leagues: [], current: 0 };
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCond.variable} ${graduate.variable}`}>
      <body>
        {signedIn ? (
          <Nav commissioner={signedIn.commissioner} addDrop={signedIn.addDrop}>
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
