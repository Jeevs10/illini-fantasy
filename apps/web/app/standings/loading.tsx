import { SkelHead, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <div className="panel"><SkelRows count={10} /></div>
    </>
  );
}
