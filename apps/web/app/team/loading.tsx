import { SkelHead, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <div className="daystrip" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="skel" style={{ width: 66, height: 62, borderRadius: "var(--r-md)", flex: "none" }} />
        ))}
      </div>
      <div className="panel"><SkelRows count={7} /></div>
      <div className="panel"><SkelRows count={3} /></div>
    </>
  );
}
