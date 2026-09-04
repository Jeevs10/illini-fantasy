import Link from "next/link";
import { Glyph } from "./ui/glyphs.tsx";

export default function NotFound() {
  return (
    <div className="panel" style={{ maxWidth: "34rem", margin: "var(--s-7) auto" }}>
      <div className="empty">
        <span className="glyph"><Glyph name="search" size={22} /></span>
        <h3>Nothing at that address</h3>
        <p>
          The page may have moved, or the player, trade or invite it named no
          longer exists.
        </p>
        <div className="controls">
          <Link className="button primary" href="/home">Home</Link>
          <Link className="button" href="/players">Player pool</Link>
        </div>
      </div>
    </div>
  );
}
