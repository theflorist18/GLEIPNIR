import type { VerifyResult } from '../types';

// Badge state: 'na' (variant without receipts), 'pending' (request in flight),
// 'notyet' (receipt/root not anchored yet — NOT a tamper signal), or a result.
export type VerifyState = 'na' | 'pending' | 'notyet' | VerifyResult;

// Promoted verbatim from demo.tsx (M14).
export function MerkleBadge({ state }: { state: VerifyState }) {
  if (state === 'na') return <span className="badge na" title="Verification applies to Anchoring variants">Merkle: N/A</span>;
  if (state === 'pending') return <span className="badge pending">Merkle: …</span>;
  if (state === 'notyet') {
    return (
      <span className="badge pending" title="Receipt or root not anchored yet — the batch may not have closed. Not a tamper signal. Run demos with a small BATCH_SIZE.">
        Merkle: not yet anchored
      </span>
    );
  }
  const cls = state.ok ? 'ok' : 'bad';
  const label = state.ok ? 'VERIFIED' : 'MISMATCH';
  return (
    <span className={`badge ${cls}`} title={state.latencyMs ? `${state.latencyMs.toFixed(2)} ms` : ''}>
      Merkle: {label}
      {state.latencyMs != null && <em> ({state.latencyMs.toFixed(1)} ms)</em>}
    </span>
  );
}
