import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireViewer } from "../../../lib/session.ts";
import { loadPlayerCard } from "./data.ts";
import { PlayerCardContent } from "./content.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireViewer();
  const data = await loadPlayerCard(Number(id), viewer.membership);
  return { title: data ? `${data.card.name} · Illini Fantasy` : "Player · Illini Fantasy" };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const data = await loadPlayerCard(Number(id), viewer.membership);
  if (!data) notFound();

  return <PlayerCardContent data={data} linkAway="/players" />;
}
