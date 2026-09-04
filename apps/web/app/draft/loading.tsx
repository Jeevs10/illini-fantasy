import { SkelHead, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <div className="clockbar">
        <div style={{ flex: 1 }}>
          <div className="skel" style={{ width: "8ch", height: ".7rem" }} />
          <div className="skel" style={{ width: "16ch", height: "1.4rem", marginTop: 8 }} />
        </div>
        <div className="skel" style={{ width: "5ch", height: "2rem" }} />
      </div>
      <div className="draftgrid">
        <div className="panel"><SkelRows count={8} /></div>
        <div className="panel"><SkelRows count={4} /></div>
      </div>
    </>
  );
}
