"use client";

import { useEffect, useRef } from "react";

/** Accessible dialog: focus moves in on open, Escape closes, backdrop click closes. */
export function Modal({ title, onClose, children, wide, testId }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel modal ${wide ? "wide" : ""}`}
        data-testid={testId}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      >
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn small" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
