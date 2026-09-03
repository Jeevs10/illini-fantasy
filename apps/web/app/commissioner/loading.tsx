/**
 * A skeleton shaped like this page, not like a page.
 *
 * The commissioner screen opens with a form, so the placeholder is a form: two
 * fields and a button, then the seats table. A generic stack of bars would
 * settle into something structurally different, which is a worse wait than a
 * plain blank.
 */
export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton" style={{ width: "14ch", height: "1.75rem" }} />
        <div className="skeleton" style={{ width: "38ch", marginTop: "var(--s-2)" }} />
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="inviteform">
            <div className="skeleton" style={{ flex: "1 1 18rem", height: "44px" }} />
            <div className="skeleton" style={{ width: "12rem", height: "44px" }} />
            <div className="skeleton" style={{ width: "9rem", height: "44px" }} />
          </div>
        </div>
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
