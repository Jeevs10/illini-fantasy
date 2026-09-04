import { bracketView, playoffPicture } from "@illini/league";
import { db } from "../../lib/db.ts";
import { requireViewer, viewNow } from "../../lib/session.ts";
import { Empty } from "../ui/bits.tsx";
import { Bracket } from "./bracket.tsx";
import { Picture } from "./picture.tsx";
import { DrawBracket } from "./draw.tsx";

export const dynamic = "force-dynamic";

export default async function PlayoffsPage() {
  const viewer = await requireViewer();
  const { leagueId, leagueName, role } = viewer.membership;

  // Settle-on-read, the same rule the wire and the negotiating table follow:
  // there is no worker, so opening this page is what advances a round.
  const view = await bracketView(db, { leagueId, now: viewNow() });

  if (!view) {
    const picture = await playoffPicture(db, leagueId);
    return (
      <>
        <div className="pagehead">
          <div>
            <h1>Playoffs</h1>
            <p className="meta"><span>{leagueName}</span></p>
          </div>
        </div>
        <Picture picture={picture} />
        {role === "commissioner" ? <DrawBracket /> : (
          <div className="panel">
            <Empty title="The bracket has not been drawn" glyph="trophy">
              Whoever runs {leagueName} draws it once the regular season is
              the one that should count.
            </Empty>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Playoffs</h1>
          <p className="meta"><span>{leagueName}</span></p>
        </div>
      </div>
      <Bracket view={view} title="Bracket" bracket="winners" rounds={view.rounds} />
      {view.hasThird ? <Bracket view={view} title="Third place" bracket="third" rounds={["3rd"]} /> : null}
      {view.consolationRounds.length > 0 ? (
        <Bracket view={view} title="Consolation bracket" bracket="consolation" rounds={view.consolationRounds} />
      ) : null}
    </>
  );
}
