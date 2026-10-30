"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { renameMyTeam, type TeamNameState } from "../settings/actions.ts";
import { Glyph } from "../ui/glyphs.tsx";

/**
 * The team name as the page heading, with a pencil beside it that turns it
 * into a field. Saving goes through the same `renameMyTeam` action the
 * settings page uses; Escape or Cancel puts the heading back untouched.
 */
export function TeamNameHeading({ name, max }: { name: string; max: number }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [state, submit, saving] = useActionState<TeamNameState, FormData>(renameMyTeam, {});
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  // A save that worked closes the field; the heading re-renders with the new name.
  useEffect(() => { if (state.ok) setEditing(false); }, [state]);
  useEffect(() => { if (!editing) setValue(name); }, [name, editing]);

  if (!editing) {
    return (
      <div className="row" style={{ gap: "var(--s-2)", flexWrap: "nowrap", minWidth: 0 }}>
        <h1 style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</h1>
        <button
          type="button" className="sm ghost" onClick={() => setEditing(true)}
          aria-label="Rename your team" title="Rename your team"
          style={{ flex: "none", padding: "var(--s-1)", lineHeight: 0 }}
        >
          <Glyph name="pencil" size={16} />
        </button>
      </div>
    );
  }

  return (
    <form action={submit} className="row" style={{ gap: "var(--s-2)", flexWrap: "wrap" }}>
      <input
        ref={input} name="teamName" required maxLength={max} value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        aria-label="Team name"
        style={{ fontSize: "var(--t-lg)", fontWeight: 600, minWidth: "12ch" }}
      />
      <button type="submit" className="sm primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      <button type="button" className="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
      {state.error ? <p className="notice bad" role="status" style={{ flexBasis: "100%", margin: 0 }}>{state.error}</p> : null}
    </form>
  );
}
