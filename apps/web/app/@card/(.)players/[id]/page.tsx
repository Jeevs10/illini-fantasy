import { notFound } from "next/navigation";
import { requireViewer } from "../../../../lib/session.ts";
import { loadPlayerCard } from "../../../players/[id]/data.ts";
import { Availability, GameLogSection, Hero, Overview, SeasonAveragesSection } from "../../../players/[id]/content.tsx";
import { CardTabs } from "../../../players/[id]/modal-tabs.tsx";
import { Modal } from "../../../ui/modal.tsx";

export const dynamic = "force-dynamic";

/**
 * The intercepted route: any `<Link href="/players/123">` clicked from
 * inside the app lands here instead of navigating away, because this segment
 * — `(.)players/[id]` inside the `@card` slot — matches it first. A direct
 * link, a refresh, or a shared URL still resolves to the full page at
 * `app/players/[id]/page.tsx`, which Next.js never routes through here.
 */
export default async function PlayerCardModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const data = await loadPlayerCard(Number(id), viewer.membership);
  if (!data) notFound();

  const { card, rankTrend, averages, projection, availability, percentileOf } = data;

  return (
    <Modal>
      <Hero card={card} />
      {availability && availability.status !== "available" ? (
        <Availability availability={availability} />
      ) : null}
      <CardTabs
        overview={<Overview card={card} rankTrend={rankTrend} projection={projection} />}
        seasonAverages={averages ? <SeasonAveragesSection averages={averages} percentileOf={percentileOf} /> : null}
        gameLog={<GameLogSection card={card} />}
      />
    </Modal>
  );
}
