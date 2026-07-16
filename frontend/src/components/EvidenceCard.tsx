import type { EvidenceRecord } from '../types';

// Promoted verbatim from demo.tsx (M14): the lockb0x Codex-Entry presentation
// idiom — a signed "evidence card". Pure presentational.
export function EvidenceCard({ record }: { record: EvidenceRecord | null }) {
  if (!record) return <div className="card muted">No evidence loaded.</div>;
  return (
    <div className="card evidence">
      <div className="evidence-head">
        <span className="mono">{record.id ?? '—'}</span>
        <span className={`pill ${record.status === 'REMOVED' ? 'removed' : 'active'}`}>{record.status ?? '—'}</span>
      </div>
      <dl>
        <dt>version</dt><dd>{record.version ?? '—'}</dd>
        <dt>custodian</dt><dd>{record.custodian ?? record.identity?.subject ?? '—'}</dd>
        <dt>org</dt><dd>{record.identity?.org ?? '—'}</dd>
        <dt>storage</dt><dd className="mono">{record.storage?.location ?? '—'}</dd>
        <dt>integrity_proof</dt><dd className="mono small">{record.storage?.integrity_proof ?? '—'}</dd>
        <dt>anchor</dt><dd className="mono small">{record.anchor?.tx_hash ?? '—'}</dd>
        <dt>previous_id</dt><dd className="mono small">{record.previous_id ?? '—'}</dd>
      </dl>
    </div>
  );
}
