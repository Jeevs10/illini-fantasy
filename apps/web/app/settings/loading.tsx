import { SkelHead, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <div className="narrow">
      <SkelHead />
      <div className="panel"><SkelRows count={1} /></div>
      <div className="panel"><SkelRows count={2} /></div>
    </div>
  );
}
