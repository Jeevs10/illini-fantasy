import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { requireViewer } from "../../../lib/session.ts";
import { loadPlayerCard } from "./data.ts";
import { PlayerCardContent } from "./content.tsx";
import { idFromParam, playerPath } from "../../../lib/links.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireViewer();
  const data = await loadPlayerCard(idFromParam(id), viewer.membership);
  return { title: data ? `${data.card.name} · Illini Fantasy` : "Player · Illini Fantasy" };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const data = await loadPlayerCard(idFromParam(id), viewer.membership);
  if (!data) notFound();
  // A bare id or a stale name redirects to the current spelling, so every
  // shared link ends up saying who it is.
  const canonical = playerPath(data.card.playerId, data.card.name);
  if (`/players/${decodeURIComponent(id)}` !== canonical) permanentRedirect(canonical);

  return <PlayerCardContent data={data} linkAway="/players" />;
}
