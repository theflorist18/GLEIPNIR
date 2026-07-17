import type { ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: ReactNode;
  /** Hide the tab entirely (e.g. role-gated tabs). */
  hidden?: boolean;
}

// Controlled tab strip in the existing card idiom (M21). The caller owns the
// active id and renders the matching panel itself.
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`tab ${t.id === active ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
