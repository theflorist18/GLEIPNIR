// Timestamp formatting for the evidence UI. A forensic record must read the
// same for every examiner, so timestamps render in a fixed, timezone-explicit
// UTC format rather than a locale string (which would differ per machine).
// The full original ISO value, milliseconds included, stays available via a
// `title` tooltip at the call sites.

// "2026-07-21 08:02:54 UTC". Returns an em dash for empty input and, defensively,
// the raw value for anything unparseable (never throw in a render path).
export function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

// Evidence head status → terminal? 'DISPOSED' is set by DisposeEvidence;
// 'REMOVED' is the legacy value still found on older rows — same meaning, so
// pills and filters treat both alike.
export const isDisposed = (status: string | null | undefined): boolean =>
  status === 'DISPOSED' || status === 'REMOVED';
