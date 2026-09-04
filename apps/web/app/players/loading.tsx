import { SkelHead, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <div className="stickybar">
        <div className="skel" style={{ height: 40, borderRadius: "var(--r-md)" }} />
      </div>
      <div className="panel"><SkelRows count={10} /></div>
    </>
  );
}
