import type { CoCEvent } from '../types';

// Promoted verbatim from demo.tsx (M14): the on-chain event list. Pure
// presentational.
export function AuditTrail({ events }: { events: CoCEvent[] }) {
  if (events.length === 0) return <div className="card muted">No audit events.</div>;
  return (
    <div className="card">
      <h3>Audit trail ({events.length})</h3>
      <ol className="trail">
        {events.map((e, i) => (
          <li key={e.eventId ?? i}>
            <span className={`op op-${(e.op ?? '').toLowerCase()}`}>{e.op}</span>
            <span className="actor">{e.actor}</span>
            <span className="ts">{e.ts}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
