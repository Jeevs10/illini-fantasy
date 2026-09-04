import { Glyph } from "../ui/glyphs.tsx";
import { signOutAction } from "../signout.tsx";

export default function NoLeague() {
  return (
    <div className="narrow">
      <div className="panel">
        <div className="empty">
          <span className="glyph"><Glyph name="league" size={22} /></span>
          <h3>No league yet</h3>
          <p>
            You are signed in, but this account does not belong to a league. An
            invite has to be redeemed before there is a team to manage.
          </p>
          <p style={{ marginTop: "var(--s-3)" }}>
            If your commissioner has sent you a link, open it now — you are
            signed in, so it will go straight through. Otherwise ask them for
            one; a link names one seat and works once.
          </p>
          <form action={signOutAction} className="controls">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );
}
