import type { ReactNode } from 'react';

export interface TimelineItem {
  key: string;
  /** Dot content (icon/initial); tone colours the dot. */
  marker?: ReactNode;
  tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
  content: ReactNode;
}

// Vertical rail timeline (M21): dot + connector per item, slot-rendered
// content. Used for audit trails and activity feeds.
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="timeline">
      {items.map((it) => (
        <li key={it.key} className="tl-item">
          <span className={`tl-dot tone-${it.tone ?? 'accent'}`}>{it.marker}</span>
          <div className="tl-content">{it.content}</div>
        </li>
      ))}
    </ol>
  );
}
