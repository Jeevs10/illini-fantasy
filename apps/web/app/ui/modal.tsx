"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Glyph } from "./glyphs.tsx";

/**
 * A route-backed modal — the intercepted `@card` slot's shell.
 *
 * "Closing" it is `router.back()`, not local state: the URL changed to get
 * here (an intercepting route, so the address bar and a refresh both agree
 * with what's on screen), so leaving has to change it back the same way. That
 * is also why there is no `onClose` prop — anywhere this is used, closing
 * means the same one thing.
 */
export function Modal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const close = () => router.back();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button className="modal-scrim" aria-label="Close" onClick={close} />
      <div className="modal" role="dialog" aria-modal="true">
        <button className="modal-close" aria-label="Close" onClick={close}>
          <Glyph name="close" size={18} />
        </button>
        <div className="modal-body">{children}</div>
      </div>
    </>
  );
}
