import { SkelRows } from "../../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <div className="hero">
        <div className="skel" style={{ width: 62, height: 62, borderRadius: 18, flex: "none" }} />
        <div className="hero-id">
          <div className="skel" style={{ width: "12ch", height: "2.125rem", borderRadius: 8 }} />
          <div className="skel" style={{ width: "24ch", height: ".8rem", marginTop: "var(--s-3)" }} />
        </div>
      </div>
      <div className="panel">
        <div className="tiles">
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="tile" key={i}>
              <div className="skel" style={{ width: "7ch", height: ".7rem" }} />
              <div className="skel" style={{ width: "5ch", height: "1.5rem", marginTop: 6 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="panel"><SkelRows count={4} /></div>
    </>
  );
}
