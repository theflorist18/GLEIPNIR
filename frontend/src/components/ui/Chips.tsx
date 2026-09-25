import { useState } from 'react';
import { Icon } from './Icon';

// Small shared chips from the Claude Design screens: status pills whose SHAPE
// carries the meaning as well as colour, initials avatars, and a copy button.

// Round dot = open/active, filled square = closed/disposed (never red — a
// terminal status is not an error), hollow dashed square = archived.
const SHAPE: Record<string, 'open' | 'closed' | 'archived'> = {
  OPEN: 'open', ACTIVE: 'open',
  CLOSED: 'closed', DISPOSED: 'closed', REMOVED: 'closed',
  ARCHIVED: 'archived',
};

export function StatusPill({ status }: { status: string | null | undefined }) {
  const s = status ?? '—';
  return (
    <span className={`status-pill status-${SHAPE[s] ?? 'closed'}`}>
      <span className="status-dot" aria-hidden="true" />{s}
    </span>
  );
}

// Fixed dark swatches so the light initials stay readable in both themes.
const AVATAR_BG = ['#56633F', '#7A8A5E', '#8C491A', '#645C50', '#474238'];

export function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

// Deterministic per `seed` (the username), so a person keeps one colour.
export function Avatar({ name, seed = name, size = 20, ring = false }: { name: string; seed?: string; size?: number; ring?: boolean }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className={`avatar${ring ? ' avatar-ring' : ''}`}
      style={{ width: size, height: size, background: AVATAR_BG[h % AVATAR_BG.length], fontSize: size <= 20 ? 9 : 11 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch { /* clipboard unavailable — the value stays selectable */ }
  };
  return (
    <button type="button" className="icon-btn" aria-label={label} title={done ? 'Copied' : label} onClick={() => void copy()}>
      <Icon name={done ? 'check-circle' : 'copy'} />
    </button>
  );
}
