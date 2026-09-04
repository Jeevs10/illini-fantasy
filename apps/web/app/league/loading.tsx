import { SkelHead, SkelBug, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <SkelBug />
      <div className="panel"><SkelRows count={8} /></div>
    </>
  );
}
