import type { CoCEvent, Op } from '../types';
import { Timeline } from './ui/Timeline';
import type { TimelineItem } from './ui/Timeline';
import { formatTs } from '../lib/format';

const OP_TONE: Record<Op, TimelineItem['tone']> = {
  CREATE: 'ok',
  TRANSFER: 'accent',
  ACCESS: 'muted',
  DISPOSE: 'danger',
};
const OP_MARK: Record<Op, string> = { CREATE: '+', TRANSFER: '⇄', ACCESS: '◉', DISPOSE: '×' };

// M21: the chain-of-custody trail as a vertical timeline — one entry per
// on-chain event, op-toned, with the op-specific detail spelled out.
// Presentational only; the data path (GetAuditTrail) is unchanged.
export function AuditTrailTimeline({ events }: { events: CoCEvent[] }) {
  if (events.length === 0) return <div className="card muted">No audit events.</div>;
  return (
    <div className="card">
      <h3>Chain of custody ({events.length})</h3>
      <Timeline
        items={events.map((e, i) => {
          // 'REMOVE' is the pre-M26 tag for the same terminal op on ledgers
          // written before the DisposeEvidence rename; render it as DISPOSE.
          const op = (((e.op as string | undefined) === 'REMOVE' ? 'DISPOSE' : e.op) ?? 'ACCESS') as Op;
          const detail = e.detail ?? {};
          const line =
            op === 'TRANSFER' ? `to ${String(detail.newCustodian ?? '?')}${detail.reason ? ` — ${String(detail.reason)}` : ''}`
            : op === 'ACCESS' ? String(detail.action ?? '')
            : op === 'DISPOSE' ? String(detail.reason ?? '')
            : '';
          return {
            key: e.eventId ?? String(i),
            marker: OP_MARK[op],
            tone: OP_TONE[op],
            content: (
              <div className="tl-event">
                <div className="tl-row">
                  <span className={`op op-${op.toLowerCase()}`}>{op}</span>
                  <span className="actor">{e.actor}</span>
                  <span className="ts small muted" title={e.ts}>{formatTs(e.ts)}</span>
                </div>
                {line && <div className="small muted">{line}</div>}
              </div>
            ),
          };
        })}
      />
    </div>
  );
}
