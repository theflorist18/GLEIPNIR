import type { ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: ReactNode;
  /** Hide the tab entirely (e.g. role-gated tabs). */
  hidden?: boolean;
}

// Controlled tab strip in the existing card idiom (M21). The caller owns the
// active id and renders the matching panel itself. Keyboard support follows the
// WAI-ARIA tablist pattern: roving tabIndex (only the active tab is a tab stop)
// and Arrow/Home/End move between tabs with activation following focus.
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  const visible = tabs.filter((t) => !t.hidden);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const last = visible.length - 1;
    const next = e.key === 'ArrowRight' ? (idx === last ? 0 : idx + 1)
      : e.key === 'ArrowLeft' ? (idx === 0 ? last : idx - 1)
        : e.key === 'Home' ? 0 : last;
    onChange(visible[next].id);
    // activation follows focus: move focus to the newly-selected tab button
    const strip = e.currentTarget.parentElement;
    (strip?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="tabs" role="tablist">
      {visible.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          tabIndex={t.id === active ? 0 : -1}
          className={`tab ${t.id === active ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
