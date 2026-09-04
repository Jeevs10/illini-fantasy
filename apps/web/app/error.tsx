"use client";

import Link from "next/link";
import { Glyph } from "./ui/glyphs.tsx";

/**
 * What went wrong, and the two things worth trying.
 *
 * The raw message is kept rather than replaced with reassurance: this league
 * runs against a database whose migrations are hand-applied, and "relation
 * waiver_claim does not exist" is the sentence that tells whoever is running it
 * exactly what to do. It sits in a monospace aside rather than as the headline.
 */
export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel" style={{ maxWidth: "38rem", margin: "var(--s-7) auto" }}>
      <div className="empty">
        <span className="glyph" style={{ background: "var(--crit-wash)", color: "var(--crit)" }}>
          <Glyph name="alert" size={22} />
        </span>
        <h3>This screen could not be drawn</h3>
        <p>
          Nothing you did caused it and nothing has been changed. Try again — if
          it keeps happening, the message below is the one to pass on.
        </p>
        <div className="controls">
          <button className="primary" onClick={reset}>Try again</button>
          <Link className="button" href="/home">Back to home</Link>
        </div>
      </div>
      <p className="seatless num" style={{ wordBreak: "break-word" }}>
        {error.message}
        {error.digest ? ` · ${error.digest}` : ""}
      </p>
    </div>
  );
}
