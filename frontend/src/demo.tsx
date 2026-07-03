import { useState } from 'react';
import { useSettings } from './settings';
import { GatewayError } from './api';
import type { CoCEvent, EvidenceRecord, VerifyResult } from './types';

// ---- Scope B: chain-of-custody demo (lockb0x Codex-Entry presentation idiom:
// a signed "evidence card" + a Merkle verification badge). ARCHITECTURE §5.

function useErr() {
  const [msg, setMsg] = useState<string>('');
  const run = async (fn: () => Promise<void>) => {
    setMsg('');
    try {
      await fn();
    } catch (e) {
      if (e instanceof GatewayError) setMsg(`${e.status}: ${e.body || e.message}`);
      else setMsg(String(e));
    }
  };
  return { msg, run };
}

function CreateEvidenceForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { client } = useSettings();
  const { msg, run } = useErr();
  const [subject, setSubject] = useState('alice');
  const [location, setLocation] = useState('blob://exhibit-001');
  const [caseId, setCaseId] = useState('');

  const submit = () =>
    run(async () => {
      const res = await client.createEvidence({
        actor: subject,
        identity: { org: 'Org1MSP', subject },
        storage: { protocol: 'file', location },
        ...(caseId ? { caseId } : {}),
      });
      if (res.evidenceId) onCreated(res.evidenceId);
    });

  return (
    <div className="card form">
      <h3>Create evidence</h3>
      <p className="hint">The binary is never uploaded for storage — only a hash (ni-URI) is recorded.</p>
      <label>custodian<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label>storage location<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label>caseId (parallel)<input value={caseId} placeholder="case-001 (optional)" onChange={(e) => setCaseId(e.target.value)} /></label>
      <button onClick={submit}>Create</button>
      {msg && <div className="err">{msg}</div>}
    </div>
  );
}

function TransferCustodyForm({ id }: { id: string }) {
  const { client } = useSettings();
  const { msg, run } = useErr();
  const [newCustodian, setNewCustodian] = useState('bob');
  const [reason, setReason] = useState('handoff');
  return (
    <div className="card form">
      <h3>Transfer custody</h3>
      <label>new custodian<input value={newCustodian} onChange={(e) => setNewCustodian(e.target.value)} /></label>
      <label>reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button disabled={!id} onClick={() => run(() => client.transferCustody(id, { newCustodian, reason }).then(() => undefined))}>
        Transfer
      </button>
      {msg && <div className="err">{msg}</div>}
    </div>
  );
}

function AccessLogForm({ id }: { id: string }) {
  const { client } = useSettings();
  const { msg, run } = useErr();
  const [actor, setActor] = useState('auditor');
  const [action, setAction] = useState('view');
  return (
    <div className="card form">
      <h3>Log access</h3>
      <label>actor<input value={actor} onChange={(e) => setActor(e.target.value)} /></label>
      <label>action<input value={action} onChange={(e) => setAction(e.target.value)} /></label>
      <button disabled={!id} onClick={() => run(() => client.accessLog(id, { actor, action }).then(() => undefined))}>
        Log access
      </button>
      {msg && <div className="err">{msg}</div>}
    </div>
  );
}

function EvidenceCard({ record }: { record: EvidenceRecord | null }) {
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

function AuditTrail({ events }: { events: CoCEvent[] }) {
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

function MerkleBadge({ state }: { state: 'na' | 'pending' | VerifyResult }) {
  if (state === 'na') return <span className="badge na" title="Verification applies to Anchoring variants">Merkle: N/A</span>;
  if (state === 'pending') return <span className="badge pending">Merkle: …</span>;
  const cls = state.ok ? 'ok' : 'bad';
  const label = state.ok ? 'VERIFIED' : 'MISMATCH';
  return (
    <span className={`badge ${cls}`} title={state.latencyMs ? `${state.latencyMs.toFixed(2)} ms` : ''}>
      Merkle: {label}
      {state.latencyMs != null && <em> ({state.latencyMs.toFixed(1)} ms)</em>}
    </span>
  );
}

export function Demo() {
  const { client, variant } = useSettings();
  const { msg, run } = useErr();
  const [id, setId] = useState('');
  const [record, setRecord] = useState<EvidenceRecord | null>(null);
  const [events, setEvents] = useState<CoCEvent[]>([]);
  const [verify, setVerify] = useState<'na' | 'pending' | VerifyResult>('na');

  const anchoring = variant === 'anchoring' || variant === 'parallel-anchored';

  const refresh = (eid: string) =>
    run(async () => {
      setId(eid);
      const [rec, ev] = await Promise.all([client.getEvidence(eid), client.getAudit(eid)]);
      setRecord(rec);
      setEvents(ev);
    });

  const doVerify = () =>
    run(async () => {
      if (!anchoring) { setVerify('na'); return; }
      setVerify('pending');
      const res = await client.verifyEvidence(id);
      setVerify(res);
    });

  return (
    <div className="demo">
      <section className="col">
        <CreateEvidenceForm onCreated={refresh} />
        <div className="card form">
          <h3>Load evidence</h3>
          <label>evidenceId<input value={id} onChange={(e) => setId(e.target.value)} /></label>
          <button disabled={!id} onClick={() => refresh(id)}>Load</button>
          {msg && <div className="err">{msg}</div>}
        </div>
        <TransferCustodyForm id={id} />
        <AccessLogForm id={id} />
      </section>
      <section className="col">
        <div className="card row-between">
          <h3>Evidence</h3>
          <div>
            <MerkleBadge state={anchoring ? verify : 'na'} />
            <button className="small" disabled={!id || !anchoring} onClick={doVerify}>Verify</button>
          </div>
        </div>
        <EvidenceCard record={record} />
        <AuditTrail events={events} />
      </section>
    </div>
  );
}
