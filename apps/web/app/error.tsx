"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel"><div className="panel-body">
      <h2>Something went wrong</h2>
      <p className="muted">{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div></div>
  );
}
