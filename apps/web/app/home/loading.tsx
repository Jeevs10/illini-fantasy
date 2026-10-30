import { SkelHead, SkelMatchups, SkelRafters, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <SkelRafters />
      <div className="split">
        <SkelMatchups />
        <div className="stack">
          <div className="card"><SkelRows count={3} /></div>
          <div className="card"><SkelRows count={5} /></div>
        </div>
      </div>
    </>
  );
}
