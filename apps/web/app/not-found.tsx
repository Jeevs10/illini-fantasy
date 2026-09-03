import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel"><div className="panel-body">
      <h2>Not found</h2>
      <p className="muted">Nothing at that address.</p>
      <Link href="/league" className="button">Back to the matchup</Link>
    </div></div>
  );
}
