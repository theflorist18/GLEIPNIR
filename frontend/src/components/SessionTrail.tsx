import { useState } from 'react';
import type { Op } from '../types';
import { formatTs } from '../lib/format';
import type { VerifyState } from './MerkleBadge';
import { Icon } from './ui/Icon';

// One write this session, as returned by the gateway. Merkle verification is
// keyed by these eventIds (F33/F49): in batched variants CoC events live
// off-chain (receipts + anchored roots), so write responses captured
// client-side are the only honest verify targets.
export interface SessionEvent {
  eventId: string;
  op: Op;
  ts: string;
  batched?: boolean;
}

// Ported from demo.tsx (M14): the this-session event list with per-event
// verify buttons for the Anchoring variants. A dashed sub-card, because these
// rows are not ledger rows; each Verify goes default → busy → result.
export function SessionTrail({ events, anchoring, onVerify }: {
  events: SessionEvent[];
  anchoring: boolean;
  onVerify: (eventId: string) => Promise<VerifyState>;
}) {
  const [results, setResults] = useState<Record<string, VerifyState | 'busy'>>({});
  if (events.length === 0) return null;

  const verify = async (id: string) => {
    setResults((r) => ({ ...r, [id]: 'busy' }));
    const res = await onVerify(id);
    setResults((r) => ({ ...r, [id]: res }));
  };

  const outcome = (id: string) => {
    const r = results[id];
    if (r === 'busy') return <button className="small" disabled><Icon name="spinner" />Verify</button>;
    if (r === 'notyet') return <span className="verify-result notyet" title="Receipt or root not anchored yet — not a tamper signal"><Icon name="clock" size={14} />pending</span>;
    if (r && typeof r === 'object') {
      return r.ok
        ? <span className="verify-result ok"><Icon name="check-circle" size={14} />ok</span>
        : <span className="verify-result bad"><Icon name="x-circle" size={14} />mismatch</span>;
    }
    return <button className="small" onClick={() => void verify(id)}>Verify</button>;
  };

  return (
    <div className="session-card">
      <strong>Events this session ({events.length})</strong>
      {events.map((e) => (
        <div key={e.eventId} className="session-row">
          <span className={`op op-${e.op.toLowerCase()}`}>{e.op}</span>
          <span className="mono">{e.eventId}</span>
          <span className="ts" title={e.ts}>{formatTs(e.ts)}</span>
          {anchoring ? outcome(e.eventId) : <span />}
        </div>
      ))}
      <span className="hint">Write responses captured client-side; in batched variants these live off-chain (receipts + anchored roots), not in the on-chain trail.</span>
    </div>
  );
}
