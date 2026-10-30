import { BlockI } from "./blocki.tsx";

/**
 * The way in: sign-in and invite pages. One banner hung at the top with the
 * Block I on it, the page's heading under it, and the form in a single panel.
 * These are the first screens a new manager sees, so they carry the rafters
 * before any league does.
 */
export function Gate({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="narrow gate">
      <div className="gate-banner" aria-hidden="true"><BlockI size={40} /></div>
      <h1>{title}</h1>
      {sub ? <p className="gate-sub">{sub}</p> : null}
      <div className="panel">{children}</div>
    </div>
  );
}
