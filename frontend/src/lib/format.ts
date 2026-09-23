// Timestamp formatting for the evidence UI (M-UX). Every timestamp in the app
// used to render as a raw ISO string (e.g. "2026-07-21T08:02:54.455Z") — hard
// to read and, in a chain-of-custody / court report, needlessly ambiguous.
//
// A forensic record must read the same for every examiner, so we render a
// FIXED, timezone-explicit UTC format rather than a locale string (which would
// silently differ per machine). The full original ISO — milliseconds and all —
// stays available via a `title` tooltip at the call sites for exact precision.

// "2026-07-21 08:02:54 UTC". Returns an em dash for empty input and, defensively,
// the raw value for anything unparseable (never throw in a render path).
export function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

// Evidence head status → terminal? 'DISPOSED' since M26 (DisposeEvidence);
// 'REMOVED' is the legacy value on rows written before the rename — same
// meaning, so pills and filters treat both alike.
export const isDisposed = (status: string | null | undefined): boolean =>
  status === 'DISPOSED' || status === 'REMOVED';

// Date-only variant for coarse columns ("2026-07-21").
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
