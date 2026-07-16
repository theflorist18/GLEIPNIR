import type { Op } from '../types';

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
// verify buttons for the Anchoring variants.
export function SessionTrail({ events, anchoring, onVerify }: {
  events: SessionEvent[];
  anchoring: boolean;
  onVerify: (eventId: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="card">
      <h3>Events this session ({events.length})</h3>
      <p className="hint">Write responses captured client-side; in batched variants these live off-chain (receipts + anchored roots), not in the on-chain trail.</p>
      <ol className="trail">
        {events.map((e) => (
          <li key={e.eventId}>
            <span className={`op op-${e.op.toLowerCase()}`}>{e.op}</span>
            <span className="mono small">{e.eventId}</span>
            <span className="ts">{e.ts}</span>
            {anchoring && (
              <button className="small" onClick={() => onVerify(e.eventId)}>Verify</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
