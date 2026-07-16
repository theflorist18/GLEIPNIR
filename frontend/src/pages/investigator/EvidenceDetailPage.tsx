import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings';
import { GatewayError } from '../../api';
import { useErr } from '../../hooks/useErr';
import { EvidenceCard } from '../../components/EvidenceCard';
import { AuditTrail } from '../../components/AuditTrail';
import { MerkleBadge, type VerifyState } from '../../components/MerkleBadge';
import { SessionTrail, type SessionEvent } from '../../components/SessionTrail';
import type { CoCEvent, EvidenceIndexRow, EvidenceRecord, Op } from '../../types';

// Evidence detail (M14): EvidenceCard + AuditTrail + MerkleBadge + download /
// export + the Transfer/AccessLog forms relocated from demo.tsx. Opening this
// page performs an on-chain read, which the gateway auto-logs as
// ACCESS(view) under the signed-in username — the trail below includes it.

function reasonOf(body: string): string {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? '';
  } catch {
    return '';
  }
}

function TransferCustodyForm({ id, onEvent }: { id: string; onEvent: (ev: SessionEvent) => void }) {
  const { client } = useAuth();
  const { msg, run } = useErr();
  const [newCustodian, setNewCustodian] = useState('');
  const [reason, setReason] = useState('handoff');
  const submit = () =>
    run(async () => {
      const res = await client.transferCustody(id, { newCustodian, reason });
      if (typeof res.eventId === 'string') {
        onEvent({ eventId: res.eventId, op: 'TRANSFER' as Op, ts: new Date().toISOString(), batched: res.batched === true });
      }
    });
  return (
    <div className="card form">
      <h3>Transfer custody</h3>
      <label>new custodian<input value={newCustodian} onChange={(e) => setNewCustodian(e.target.value)} /></label>
      <label>reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button disabled={!newCustodian} onClick={submit}>Transfer</button>
      {msg && <div className="err">{msg}</div>}
    </div>
  );
}

function AccessLogForm({ id, onEvent }: { id: string; onEvent: (ev: SessionEvent) => void }) {
  const { client, user } = useAuth();
  const { msg, run } = useErr();
  const [action, setAction] = useState('inspect');
  const submit = () =>
    run(async () => {
      // actor is server-attributed to the signed-in user; the field is kept in
      // the request shape for the service-token path only.
      const res = await client.accessLog(id, { actor: user?.username ?? '', action });
      if (typeof res.eventId === 'string') {
        onEvent({ eventId: res.eventId, op: 'ACCESS' as Op, ts: new Date().toISOString(), batched: res.batched === true });
      }
    });
  return (
    <div className="card form">
      <h3>Log manual access</h3>
      <p className="hint">Actor is always your username (server-attributed). Views, downloads, and exports are logged automatically.</p>
      <label>action<input value={action} onChange={(e) => setAction(e.target.value)} /></label>
      <button onClick={submit}>Log access</button>
      {msg && <div className="err">{msg}</div>}
    </div>
  );
}

export function EvidenceDetailPage() {
  const { evidenceId = '' } = useParams();
  const { client } = useAuth();
  const { variant } = useSettings();
  const { msg, run } = useErr();
  const [record, setRecord] = useState<EvidenceRecord | null>(null);
  const [events, setEvents] = useState<CoCEvent[]>([]);
  const [indexRow, setIndexRow] = useState<EvidenceIndexRow | null>(null);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [verify, setVerify] = useState<VerifyState>('na');
  const [notFound, setNotFound] = useState('');

  const anchoring = variant === 'anchoring' || variant === 'parallel-anchored';
  const addSessionEvent = (ev: SessionEvent) => setSessionEvents((prev) => [...prev, ev]);

  const refresh = useCallback(
    () => run(async () => {
      setNotFound('');
      try {
        // Sequential on purpose: the record read auto-logs ACCESS(view), and
        // the trail fetched afterwards includes that fresh event.
        setRecord(await client.getEvidence(evidenceId));
        setEvents(await client.getAudit(evidenceId));
      } catch (e) {
        if (e instanceof GatewayError && (e.status === 404 || e.status === 403)) {
          setRecord(null);
          setEvents([]);
          setNotFound(e.status === 403
            ? 'You do not have access to this evidence (not a participant of its case).'
            : 'No on-chain record (unknown id, no access, or an anchoring-variant write whose batch has not closed yet).');
          return;
        }
        throw e;
      }
      try {
        const rows = await client.searchEvidence({ q: evidenceId });
        setIndexRow(rows.find((r) => r.evidenceId === evidenceId) ?? null);
      } catch {
        setIndexRow(null); // read-model is best-effort display data
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, evidenceId],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  // Pending-vs-tamper must never be conflated (F49): a 404 missing-receipt /
  // missing-anchor-root means "batch not closed yet"; only a 200 ok:false
  // root-mismatch is the red badge.
  const doVerify = (eventId: string) =>
    run(async () => {
      if (!anchoring) { setVerify('na'); return; }
      setVerify('pending');
      try {
        setVerify(await client.verifyEvidence(evidenceId, eventId));
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

  const doDownload = () =>
    run(async () => {
      const { blob, filename } = await client.downloadEvidence(evidenceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      await refresh(); // the download was auto-logged; show it
    });

  const doExport = () =>
    run(async () => {
      const bundle = await client.exportEvidence(evidenceId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${evidenceId}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      await refresh(); // the export was auto-logged; show it
    });

  return (
    <div className="demo">
      <section className="col">
        <div className="card">
          <h3 className="mono">{evidenceId}</h3>
          {indexRow && (
            <dl className="kv">
              <dt>file</dt><dd>{indexRow.originalFilename ?? '—'}</dd>
              <dt>type</dt><dd className="small">{indexRow.mimeType ?? '—'}</dd>
              <dt>uploaded by</dt><dd>{indexRow.uploadedBy ?? '—'}</dd>
              <dt>case</dt>
              <dd>
                {indexRow.caseId
                  ? <Link className="mono small" to={`/cases/${encodeURIComponent(indexRow.caseId)}`}>{indexRow.caseId}</Link>
                  : <span className="muted">uncategorized</span>}
              </dd>
            </dl>
          )}
          <div className="btn-row">
            <button onClick={doDownload}>Download</button>
            <button onClick={doExport}>Export (record + trail)</button>
          </div>
          <p className="hint">Downloads and exports append an ACCESS event to the trail before they complete.</p>
          {msg && <div className="err">{msg}</div>}
        </div>
        <TransferCustodyForm id={evidenceId} onEvent={addSessionEvent} />
        <AccessLogForm id={evidenceId} onEvent={addSessionEvent} />
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
        {notFound && <div className="card muted">{notFound}</div>}
        <EvidenceCard record={record} />
        <AuditTrail events={events} />
        <SessionTrail events={sessionEvents} anchoring={anchoring} onVerify={doVerify} />
      </section>
    </div>
  );
}
