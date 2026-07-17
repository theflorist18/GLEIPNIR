import type { ReactNode } from 'react';

export type BadgeTone = 'accent' | 'ok' | 'warn' | 'danger' | 'muted';

// Small labelled chip (M21) — wraps the existing .badge class with tones.
export function Badge({ tone = 'muted', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}
