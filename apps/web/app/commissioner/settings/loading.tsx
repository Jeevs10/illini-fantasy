import { SkelHead, SkelRows } from "../../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <div className="panel"><SkelRows count={2} /></div>
      <div className="panel"><SkelRows count={4} /></div>
      <div className="panel"><SkelRows count={3} /></div>
    </>
  );
}
