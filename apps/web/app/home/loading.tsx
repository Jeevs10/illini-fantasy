import { SkelHead, SkelBug, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <SkelBug />
      <div className="split">
        <div className="panel"><SkelRows count={7} /></div>
        <div className="stack">
          <div className="card"><SkelRows count={3} /></div>
          <div className="card"><SkelRows count={5} /></div>
        </div>
      </div>
    </>
  );
}
