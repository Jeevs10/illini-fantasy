"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/league", "Matchup"],
  ["/team", "My Team"],
  ["/draft", "Draft"],
  ["/players", "Players"],
  ["/standings", "Standings"],
] as const;

export function Nav({
  commissioner, children,
}: { commissioner: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  // The commissioner's tools are the one thing not everyone can act on, so the
  // link only exists for the person it works for.
  const links = commissioner ? [...LINKS, ["/commissioner", "Commissioner"] as const] : LINKS;
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href="/league" className="wordmark">Illini Fantasy</Link>
        <nav>
          {links.map(([href, label]) => (
            <Link key={href} href={href} data-active={pathname.startsWith(href)}>{label}</Link>
          ))}
        </nav>
        {children}
      </div>
    </header>
  );
}
