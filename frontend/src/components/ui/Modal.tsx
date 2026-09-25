import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

// Minimal overlay dialog in the card idiom (M21): Escape and overlay-click
// close it; the panel stops click propagation. Deliberately no portal or
// focus-TRAP machinery — simple and usable beats clever (ARCHITECTURE §5).
// It does, however, move focus into the dialog on open and restore it to the
// opener on close, and links its title via aria-labelledby, so keyboard and
// screen-reader users are not stranded (a11y, not a trap).
export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
