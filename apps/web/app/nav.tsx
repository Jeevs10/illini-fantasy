"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/league", "Matchup"],
  ["/team", "My Team"],
  ["/players", "Players"],
  ["/standings", "Standings"],
] as const;

export function Nav({ name }: { name: string }) {
  const pathname = usePathname();
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href="/league" className="wordmark">Illini Fantasy</Link>
        <nav>
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} data-active={pathname.startsWith(href)}>{label}</Link>
          ))}
        </nav>
        <span className="whoami">{name}</span>
      </div>
    </header>
  );
}
