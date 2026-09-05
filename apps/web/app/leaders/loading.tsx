import { SkelHead, SkelRows, SkelSegmented } from "../ui/skeleton.tsx";

export default function Loading() {
  return (
    <>
      <SkelHead />
      <div className="row" style={{ gap: "var(--s-3)", marginBottom: "var(--s-4)" }}>
        <SkelSegmented count={4} />
        <SkelSegmented count={4} />
      </div>
      <div className="panel"><SkelRows count={10} /></div>
    </>
  );
}
