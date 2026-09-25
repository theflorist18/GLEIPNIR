// Icons from the same-origin sprite (public/icons/sprite.svg, Claude Design
// handoff): currentColor symbols, so an icon takes the colour of its text.
// Always decorative — the accessible name comes from the surrounding label.
export type IconName =
  | 'nav-ingest' | 'nav-cases' | 'nav-search' | 'nav-lead-dashboard' | 'nav-users' | 'nav-case-admin'
  | 'menu' | 'sign-out' | 'chevron-down' | 'chevron-right' | 'add' | 'filter' | 'copy' | 'hash' | 'anchor'
  | 'fingerprint' | 'lock' | 'eye' | 'eye-off' | 'download' | 'export' | 'report' | 'print' | 'verify'
  | 'clock' | 'info' | 'help' | 'help-filled' | 'check-circle' | 'x-circle' | 'warning' | 'info-filled'
  | 'clock-filled' | 'stop-square' | 'dash-circle' | 'flag' | 'note' | 'upload' | 'file' | 'file-image'
  | 'refresh' | 'op-create' | 'op-transfer' | 'op-access' | 'op-dispose' | 'offline' | 'spinner';

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon${name === 'spinner' ? ' spin' : ''}${className ? ` ${className}` : ''}`} width={size} height={size} aria-hidden="true" focusable="false">
      <use href={`/icons/sprite.svg#${name}`} />
    </svg>
  );
}

// PLACEHOLDER mark — direction A ("1a") from the Claude Design boards, used
// until the authors pick the brand (no brand exports / favicon until then).
// One file to swap. The crossing is drawn by over-painting in var(--ground),
// which the container sets to its own background colour.
export function BrandMark({ size }: { size: number }) {
  const tail = 'M18.9 17.4C19.6 16.3 19.93 15.2 19.93 14.06C19.93 11 17.9 8.97 16 9';
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4.07 12C4.07 17 8 20.75 12.73 20.75C17 20.75 19.93 17.6 19.93 14.06C19.93 11 17.9 8.97 15.39 8.97C13.5 8.97 12.23 10.3 12.23 12C12.23 13.7 13.5 15.03 15.39 15.03C17.9 15.03 19.93 13 19.93 9.94C19.93 6.4 17 3.25 12.73 3.25C8 3.25 4.07 7 4.07 12Z"
        stroke="currentColor" strokeWidth="2.6"
      />
      <path d={tail} style={{ stroke: 'var(--ground)' }} strokeWidth="5" />
      <path d={tail} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
