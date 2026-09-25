import type { VerifyResult } from '../types';
import { Icon } from './ui/Icon';

// Badge state: 'na' (variant without receipts), 'pending' (request in flight),
// 'notyet' (receipt/root not anchored yet — NOT a tamper signal), or a result.
export type VerifyState = 'na' | 'pending' | 'notyet' | VerifyResult;

// Promoted from demo.tsx (M14); Claude Design states: VERIFIED (success),
// MISMATCH (the only red), not yet anchored (warning clock), N/A (dashed).
export function MerkleBadge({ state }: { state: VerifyState }) {
  if (state === 'na') {
    return <span className="merkle na" title="Verification applies to the Anchoring variants"><Icon name="dash-circle" />Merkle: N/A</span>;
  }
  if (state === 'pending') return <span className="merkle pending"><Icon name="spinner" />Merkle: …</span>;
  if (state === 'notyet') {
    return (
      <span className="merkle notyet" title="Receipt or root not anchored yet — the batch may not have closed. Not a tamper signal. Run demos with a small BATCH_SIZE.">
        <Icon name="clock" />Merkle: not yet anchored
      </span>
    );
  }
  return (
    <span className={`merkle ${state.ok ? 'ok' : 'bad'}`} title={state.latencyMs ? `${state.latencyMs.toFixed(2)} ms` : ''}>
      <Icon name={state.ok ? 'check-circle' : 'x-circle'} />
      Merkle: {state.ok ? 'VERIFIED' : 'MISMATCH'}
      {state.latencyMs != null && <em>({state.latencyMs.toFixed(1)} ms)</em>}
    </span>
  );
}

// Inline verify-steps breakdown (web-popover-verify-steps): fetch event →
// recompute Merkle branch → compare root, when the verifier reports them.
export function VerifySteps({ steps }: { steps: NonNullable<VerifyResult['steps']> }) {
  const parts = [steps.fetchMs, steps.recomputeMs, steps.compareRootMs].map((v) => v ?? 0);
  if (parts.every((v) => v === 0)) return null;
  return (
    <div className="verify-steps">
      <span>time (ms) · fetch / recompute / compare root</span>
      <div className="verify-bar" aria-hidden="true">
        {parts.map((v, i) => <span key={i} style={{ flex: Math.max(v, 0.05) }} />)}
      </div>
      <div className="verify-nums">{parts.map((v, i) => <span key={i}>{v.toFixed(1)}</span>)}</div>
    </div>
  );
}
