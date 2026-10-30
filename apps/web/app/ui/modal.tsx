"use client";

import { useEffect, useRef } from "react";
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
export function Modal({ children, label }: { children: React.ReactNode; label: string }) {
  const router = useRouter();
  const close = () => router.back();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus goes into the card and comes back to whatever opened it — the
    // player's name in a list — so a keyboard reader picks up where they were.
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab" || !box.current) return;
      // Tab cycles inside the card: the page behind the scrim is not there.
      const focusable = [...box.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      )];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button className="modal-scrim" aria-label="Close" tabIndex={-1} onClick={close} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={box}>
        <button className="modal-close" aria-label="Close" onClick={close}>
          <Glyph name="close" size={18} />
        </button>
        <div className="modal-body">{children}</div>
      </div>
    </>
  );
}
