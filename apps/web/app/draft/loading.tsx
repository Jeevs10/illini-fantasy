export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton" style={{ width: "8ch", height: "1.75rem" }} />
        <div className="skeleton" style={{ width: "40ch", marginTop: "var(--s-2)" }} />
      </div>
      <div className="panel">
        <div className="panel-body">
          <div className="skeleton" style={{ width: "22ch", height: "1.5rem" }} />
        </div>
      </div>
      <div className="panel">
        <div className="panel-body">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ marginBottom: "var(--s-3)", opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      </div>
    </>
  );
}
