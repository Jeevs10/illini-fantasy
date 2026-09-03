import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./nav.tsx";
import { auth } from "../auth.ts";

export const metadata: Metadata = {
  title: "Illini Fantasy Hoops",
  description: "College basketball fantasy, scored on the CBB Player-Score model.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
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
        {session?.user ? <Nav name={session.user.name ?? session.user.email ?? ""} /> : null}
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
