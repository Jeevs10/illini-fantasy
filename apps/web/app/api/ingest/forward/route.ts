import { timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { assertFeed, ingestForwardFeed } from "@illini/ingest/forward";
import { fillTipoffs } from "@illini/ingest/tipoffs";
import { settleDue } from "@illini/league";
import { db } from "../../../../lib/db.ts";

/**
 * The morning feed from the Data repo (`export_fantasy.py push`, the last
 * step of its daily refresh): rosters, projections, the last week's valAdj
 * lines and the injury list. Writes them, fills the tip-offs CBBD has as TBD
 * from ESPN for the next two weeks, then settles whatever the clock has
 * made due — waiver runs, trades, finished weeks, the bracket — for every
 * league in the feed's season.
 *
 * Bearer-token only, the token in FANTASY_INGEST_TOKEN on both sides; there
 * is no session here and nothing a browser should ever call. The body may be
 * gzipped, which keeps a full feed well under the 4.5 MB request limit.
 */
export const maxDuration = 300;

function authorised(header: string | null): boolean {
  const token = process.env.FANTASY_INGEST_TOKEN;
  if (!token || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  let feed: unknown;
  try {
    const raw = Buffer.from(await request.arrayBuffer());
    // Gzip by its magic number rather than the header: a proxy may have
    // decoded the body and left Content-Encoding in place, or the reverse.
    const body = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
    feed = JSON.parse(body.toString("utf8"));
    assertFeed(feed);
  } catch (error) {
    return Response.json({ error: `not a feed: ${(error as Error).message}` }, { status: 400 });
  }

  const started = Date.now();
  const ingest = await ingestForwardFeed(db, feed);
  // After the schedule: a feed that moved a game resets its time first.
  const tipoffs = await fillTipoffs(db, { from: feed.asof }).catch((error: Error) => ({ error: error.message }));
  const settled = await settleDue(db, { season: feed.season, through: feed.asof });
  return Response.json({ asof: feed.asof, ingest, tipoffs, settled, ms: Date.now() - started });
}
