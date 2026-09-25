import type { CSSProperties } from 'react';
import type { CoCEvent, Op } from '../types';
import { Timeline } from './ui/Timeline';
import { Icon, type IconName } from './ui/Icon';
import { formatTs } from '../lib/format';

const OP_ICON: Record<Op, IconName> = { CREATE: 'op-create', TRANSFER: 'op-transfer', ACCESS: 'op-access', DISPOSE: 'op-dispose' };
// Terminal DISPOSE is ink, never red: disposal is a lawful status, not an error.
const OP_COLOR: Record<Op, string> = {
  CREATE: 'var(--color-op-create)',
  TRANSFER: 'var(--color-op-transfer)',
  ACCESS: 'var(--color-op-access)',
  DISPOSE: 'var(--color-op-dispose)',
};

export interface TrailRow {
  key: string;
  op: Op;
  legacy: boolean; // 'REMOVE' — the pre-M26 tag for DISPOSE on older ledgers
  actor: string;
  detail: string;
  firstTs: string;
  ts: string; // the latest event of a collapsed run
  count: number;
}

// One row per on-chain event; with `collapseViews`, consecutive ACCESS(view)
// events by the same actor fold into one row carrying a ×N count and the
// first → last time range. Presentation only — every event stays on-chain.
export function trailRows(events: CoCEvent[], collapseViews: boolean): TrailRow[] {
  const rows: TrailRow[] = [];
  events.forEach((e, i) => {
    const raw = e.op as string | undefined;
    const op = ((raw === 'REMOVE' ? 'DISPOSE' : raw) ?? 'ACCESS') as Op;
    const d = e.detail ?? {};
    const detail =
      op === 'TRANSFER' ? `to ${String(d.newCustodian ?? '?')}${d.reason ? ` — ${String(d.reason)}` : ''}`
      : op === 'ACCESS' ? String(d.action ?? '')
      : op === 'DISPOSE' ? String(d.reason ?? '')
      : '';
    const actor = e.actor ?? '—';
    const ts = e.ts ?? '';
    const prev = rows[rows.length - 1];
    if (collapseViews && prev && op === 'ACCESS' && prev.op === 'ACCESS' && detail === 'view' && prev.detail === 'view' && prev.actor === actor) {
      prev.count += 1;
      prev.ts = ts;
      return;
    }
    rows.push({ key: e.eventId ?? String(i), op, legacy: raw === 'REMOVE', actor, detail, firstTs: ts, ts, count: 1 });
  });
  return rows;
}

// The chain-of-custody trail as a vertical timeline (M21; Claude Design
// screen 03): op-coloured dots, the op-specific detail spelled out, UTC
// timestamps right-aligned with the exact ISO value in the tooltip.
// Presentational only; the data path (GetAuditTrail) is unchanged.
export function AuditTrailTimeline({ events, collapseViews = false }: { events: CoCEvent[]; collapseViews?: boolean }) {
  if (events.length === 0) return <p className="muted">No audit events.</p>;
  return (
    <Timeline
      items={trailRows(events, collapseViews).map((r) => {
        const range = r.count > 1 ? `${r.firstTs} → ${r.ts}` : r.ts;
        return {
          key: r.key,
          marker: <Icon name={OP_ICON[r.op]} size={14} />,
          style: { '--tl-color': OP_COLOR[r.op] } as CSSProperties,
          content: (
            <div className="tl-event">
              <div className="tl-row">
                <span className={`op op-${r.op.toLowerCase()}`}>{r.op}</span>
                <span className="actor">{r.actor}</span>
                {r.count > 1 && <span className="count-badge" title={`${r.count} consecutive views: ${range}`}>×{r.count}</span>}
                {r.legacy && <span className="badge tone-muted" title="Written before the M26 DisposeEvidence rename">legacy: REMOVE</span>}
                <span className="ts" title={range}>{formatTs(r.ts)}</span>
              </div>
              {r.detail && <div className="tl-detail">{r.detail}</div>}
            </div>
          ),
        };
      })}
    />
  );
}
