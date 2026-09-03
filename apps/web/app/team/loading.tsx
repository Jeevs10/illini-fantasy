export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton" style={{ width: "12ch", height: "1.75rem" }} />
        <div className="skeleton" style={{ width: "34ch", marginTop: "var(--s-2)" }} />
      </div>
      <div className="panel">
        <div className="panel-body">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="skeleton"
              style={{ marginBottom: "var(--s-3)", opacity: 1 - i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
