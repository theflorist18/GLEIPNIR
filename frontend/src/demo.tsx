import { useState } from 'react';
import { useSettings } from './settings';
import { GatewayError } from './api';
import type { CoCEvent, EvidenceRecord, Op, VerifyResult } from './types';

// ---- Scope B: chain-of-custody demo (lockb0x Codex-Entry presentation idiom:
// a signed "evidence card" + a Merkle verification badge). ARCHITECTURE §5.
//
// caseId is held in Demo state and threaded into EVERY call (audit F68) — the
// gateway requires it for reads and writes in the parallel variants. Write
// responses carry eventId in every variant; the demo keeps a session-event log
// so Merkle verification (keyed by eventId, audit F33/F49) has real targets —
// this list is also the honest client-side trail for the batched variants,
// where CoC events live off-chain and the on-chain trail is empty by design.

// One write this session, as returned by the gateway.
export interface SessionEvent {
  eventId: string;
  op: Op;
  ts: string;
  batched?: boolean;
}

// Badge state: 'na' (variant without receipts), 'pending' (request in flight),
// 'notyet' (receipt/root not anchored yet — NOT a tamper signal), or a result.
type VerifyState = 'na' | 'pending' | 'notyet' | VerifyResult;

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

function reasonOf(body: string): string {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? '';
  } catch {
    return '';
  }
}

function CreateEvidenceForm({ onCreated }: { onCreated: (id: string, caseId: string, ev: SessionEvent | null) => void }) {
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
      const ev = typeof res.eventId === 'string'
        ? { eventId: res.eventId, op: 'CREATE' as Op, ts: new Date().toISOString(), batched: res.batched === true }
        : null;
      if (res.evidenceId) onCreated(res.evidenceId, caseId, ev);
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

function TransferCustodyForm({ id, caseId, onEvent }: { id: string; caseId: string; onEvent: (ev: SessionEvent) => void }) {
  const { client } = useSettings();
  const { msg, run } = useErr();
  const [newCustodian, setNewCustodian] = useState('bob');
  const [reason, setReason] = useState('handoff');
  const submit = () =>
    run(async () => {
      const res = await client.transferCustody(id, { newCustodian, reason, ...(caseId ? { caseId } : {}) });
      if (typeof res.eventId === 'string') {
        onEvent({ eventId: res.eventId, op: 'TRANSFER', ts: new Date().toISOString(), batched: res.batched === true });
      }
    });
  return (
    <div className="card form">
      <h3>Transfer custody</h3>
      <label>new custodian<input value={newCustodian} onChange={(e) => setNewCustodian(e.target.value)} /></label>
      <label>reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button disabled={!id} onClick={submit}>Transfer</button>
      {msg && <div className="err">{msg}</div>}
    </div>
  );
}

function AccessLogForm({ id, caseId, onEvent }: { id: string; caseId: string; onEvent: (ev: SessionEvent) => void }) {
  const { client } = useSettings();
  const { msg, run } = useErr();
  const [actor, setActor] = useState('auditor');
  const [action, setAction] = useState('view');
  const submit = () =>
    run(async () => {
      const res = await client.accessLog(id, { actor, action, ...(caseId ? { caseId } : {}) });
      if (typeof res.eventId === 'string') {
        onEvent({ eventId: res.eventId, op: 'ACCESS', ts: new Date().toISOString(), batched: res.batched === true });
      }
    });
  return (
    <div className="card form">
      <h3>Log access</h3>
      <label>actor<input value={actor} onChange={(e) => setActor(e.target.value)} /></label>
      <label>action<input value={action} onChange={(e) => setAction(e.target.value)} /></label>
      <button disabled={!id} onClick={submit}>Log access</button>
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

// This-session events (off-chain view): the verify targets, and the honest
// stand-in trail for batched variants whose on-chain trail is empty by design.
function SessionTrail({ events, anchoring, onVerify }: {
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

function MerkleBadge({ state }: { state: VerifyState }) {
  if (state === 'na') return <span className="badge na" title="Verification applies to Anchoring variants">Merkle: N/A</span>;
  if (state === 'pending') return <span className="badge pending">Merkle: …</span>;
  if (state === 'notyet') {
    return (
      <span className="badge pending" title="Receipt or root not anchored yet — the batch may not have closed. Not a tamper signal. Run demos with a small BATCH_N.">
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

export function Demo() {
  const { client, variant } = useSettings();
  const { msg, run } = useErr();
  const [id, setId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [record, setRecord] = useState<EvidenceRecord | null>(null);
  const [events, setEvents] = useState<CoCEvent[]>([]);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [verify, setVerify] = useState<VerifyState>('na');

  const anchoring = variant === 'anchoring' || variant === 'parallel-anchored';

  const addSessionEvent = (ev: SessionEvent) => setSessionEvents((prev) => [...prev, ev]);

  const refresh = (eid: string, cid: string) =>
    run(async () => {
      setId(eid);
      const [rec, ev] = await Promise.all([
        client.getEvidence(eid, cid || undefined),
        client.getAudit(eid, cid || undefined),
      ]);
      setRecord(rec);
      setEvents(ev);
    });

  const onCreated = (eid: string, cid: string, ev: SessionEvent | null) => {
    setCaseId(cid);
    if (ev) addSessionEvent(ev);
    if (ev?.batched) {
      // Batched variants: the write is off-chain until its batch closes; the
      // on-chain read would 404. Show the session view instead of an error.
      setId(eid);
      setRecord(null);
      setEvents([]);
      return;
    }
    void refresh(eid, cid);
  };

  // Pending-vs-tamper must never be conflated (F49): a 404 missing-receipt /
  // missing-anchor-root means "batch not closed yet", only a 200 ok:false
  // root-mismatch is the red badge; other errors reset the badge.
  const doVerify = (eventId: string) =>
    run(async () => {
      if (!anchoring) { setVerify('na'); return; }
      setVerify('pending');
      try {
        const res = await client.verifyEvidence(id || 'unknown', eventId);
        setVerify(res);
      } catch (e) {
        if (e instanceof GatewayError && e.status === 404) {
          const reason = reasonOf(e.body);
          if (reason === 'missing-receipt' || reason === 'missing-anchor-root') {
            setVerify('notyet');
            return;
          }
        }
        setVerify('na');
        throw e;
      }
    });

  return (
    <div className="demo">
      <section className="col">
        <CreateEvidenceForm onCreated={onCreated} />
        <div className="card form">
          <h3>Load evidence</h3>
          <label>evidenceId<input value={id} onChange={(e) => setId(e.target.value)} /></label>
          <label>caseId (parallel)<input value={caseId} placeholder="case-001 (optional)" onChange={(e) => setCaseId(e.target.value)} /></label>
          <button disabled={!id} onClick={() => refresh(id, caseId)}>Load</button>
          {msg && <div className="err">{msg}</div>}
        </div>
        <TransferCustodyForm id={id} caseId={caseId} onEvent={addSessionEvent} />
        <AccessLogForm id={id} caseId={caseId} onEvent={addSessionEvent} />
      </section>
      <section className="col">
        <div className="card row-between">
          <h3>Evidence</h3>
          <div>
            <MerkleBadge state={anchoring ? verify : 'na'} />
            <button
              className="small"
              disabled={!anchoring || sessionEvents.length === 0}
              title={sessionEvents.length === 0 ? 'Write an event this session first — verification is per event' : 'Verify the latest session event'}
              onClick={() => doVerify(sessionEvents[sessionEvents.length - 1].eventId)}
            >
              Verify latest
            </button>
          </div>
        </div>
        <EvidenceCard record={record} />
        <AuditTrail events={events} />
        <SessionTrail events={sessionEvents} anchoring={anchoring} onVerify={doVerify} />
      </section>
    </div>
  );
}
