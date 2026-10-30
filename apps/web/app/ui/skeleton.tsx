/**
 * Loading, shaped like what is arriving.
 *
 * A generic spinner tells a manager the app is busy. A skeleton in the shape
 * of the banners tells them the banners are coming, which is the difference
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

/** A row of segmented-control pills, for pages that filter above a list. */
export function SkelSegmented({ count = 4 }: { count?: number }) {
  return (
    <div className="segmented" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel" style={{ width: "6ch", height: "1.5rem", margin: 3 }} />
      ))}
    </div>
  );
}

/** The banner strip, waiting: twelve short banners on the steel rule. */
export function SkelRafters({ count = 12 }: { count?: number }) {
  return (
    <div className="rafters" aria-hidden="true">
      <ol>
        {Array.from({ length: count }, (_, i) => (
          <li key={i}><div className="banner skel" style={{ height: 148 }} /></li>
        ))}
      </ol>
    </div>
  );
}

/** A week's matchups, waiting: one list row per game. */
export function SkelMatchups({ count = 6 }: { count?: number }) {
  return (
    <ol className="mlist" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}><div className="mrow">
          <div className="skel" style={{ width: "60%", height: ".85rem" }} />
          <div className="skel" style={{ width: "4ch", height: ".6rem", justifySelf: "center" }} />
          <div className="skel" style={{ width: "60%", height: ".85rem", justifySelf: "end" }} />
        </div></li>
      ))}
    </ol>
  );
}
