/**
 * Loading, shaped like what is arriving.
 *
 * A generic spinner tells a manager the app is busy. A skeleton in the shape
 * of a scorebug tells them the scorebug is coming, which is the difference
 * between waiting and wondering whether you clicked the right thing.
 */

export function SkelHead() {
  return (
    <div className="pagehead">
      <div style={{ flex: 1 }}>
        <div className="skel" style={{ width: "10ch", height: "2.125rem", borderRadius: 8 }} />
        <div className="skel" style={{ width: "28ch", marginTop: "var(--s-3)", height: ".8rem" }} />
      </div>
    </div>
  );
}

export function SkelRows({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-row" key={i} style={{ opacity: 1 - i * 0.11 }}>
          <div className="skel skel-circle" />
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ width: `${45 + ((i * 13) % 30)}%`, height: ".75rem" }} />
            <div className="skel" style={{ width: "30%", height: ".6rem", marginTop: 6 }} />
          </div>
          <div className="skel" style={{ width: "3.5rem", height: "1rem" }} />
        </div>
      ))}
    </>
  );
}

export function SkelBug() {
  return (
    <div className="scorebug" style={{ marginBottom: "var(--s-5)" }}>
      <div className="scorebug-top">
        <div className="skel" style={{ width: "22ch", height: ".7rem" }} />
      </div>
      <div className="scorebug-body">
        <div className="scorebug-side">
          <div className="skel" style={{ width: "14ch", height: "1rem" }} />
          <div className="skel" style={{ width: "7ch", height: "3rem", borderRadius: 8 }} />
        </div>
        <div className="scorebug-mid"><div className="skel" style={{ width: "2ch", height: ".7rem" }} /></div>
        <div className="scorebug-side them">
          <div className="skel" style={{ width: "14ch", height: "1rem" }} />
          <div className="skel" style={{ width: "7ch", height: "3rem", borderRadius: 8 }} />
        </div>
      </div>
      <div className="scorebug-foot">
        <div className="skel" style={{ height: 8, borderRadius: 999 }} />
      </div>
    </div>
  );
}
