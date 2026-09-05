"use client";

import Link from "next/link";
import { Glyph } from "./ui/glyphs.tsx";

/**
 * What went wrong, and the two things worth trying.
 *
 * The raw message is kept rather than replaced with reassurance: this league
 * runs against a database whose migrations are hand-applied, and "relation
 * waiver_claim does not exist" is the sentence that tells whoever is running it
 * exactly what to do. But that sentence is meant for whoever runs the app, not
 * for a manager who just clicked a link — so it sits behind a closed
 * disclosure instead of on the page by default, still one click from whoever
 * needs it.
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
          it keeps happening, pass on the technical details below.
        </p>
        <div className="controls">
          <button className="primary" onClick={reset}>Try again</button>
          <Link className="button" href="/home">Back to home</Link>
        </div>
      </div>
      <details className="seatless" style={{ padding: "var(--s-3) var(--s-4)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Technical details</summary>
        <p className="num" style={{ wordBreak: "break-word", marginTop: "var(--s-2)" }}>
          {error.message}
          {error.digest ? ` · ${error.digest}` : ""}
        </p>
      </details>
    </div>
  );
}
