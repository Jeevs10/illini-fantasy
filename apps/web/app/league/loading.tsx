import { SkelHead, SkelMatchups, SkelRows } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <SkelMatchups />
      <div className="panel" style={{ marginTop: "var(--s-6)" }}><SkelRows count={8} /></div>
    </>
  );
}
