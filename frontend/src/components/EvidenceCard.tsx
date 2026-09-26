import type { EvidenceRecord } from '../types';
import { StatusPill } from './ui/Chips';

// Promoted verbatim from demo.tsx (M14): the lockb0x Codex-Entry presentation
// idiom — a signed "evidence card". Pure presentational.
export function EvidenceCard({ record }: { record: EvidenceRecord | null }) {
  if (!record) return <p className="muted">No evidence loaded.</p>;
  return (
    <div className="subcard evidence">
      <div className="evidence-head">
        <span className="mono small">{record.id ?? '—'}</span>
        <StatusPill status={record.status} />
      </div>
      <dl className="kv">
        <dt>version</dt><dd>{record.version ?? '—'}</dd>
        <dt>custodian</dt><dd>{record.custodian ?? record.identity?.subject ?? '—'}</dd>
        <dt>org</dt><dd>{record.identity?.org ?? '—'}</dd>
        <dt>storage</dt><dd className="mono small">{record.storage?.location ?? '—'}</dd>
        <dt>integrity_proof</dt><dd className="mono small">{record.storage?.integrity_proof ?? '—'}</dd>
        <dt>anchor</dt><dd className="mono small">{record.anchor?.tx_hash ?? '—'}</dd>
        <dt>previous_id</dt><dd className="mono small">{record.previous_id ?? '—'}</dd>
      </dl>
    </div>
  );
}
