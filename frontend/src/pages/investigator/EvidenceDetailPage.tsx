import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings';
import { GatewayError } from '../../api';
import { useErr } from '../../hooks/useErr';
import { EvidenceCard } from '../../components/EvidenceCard';
import { AuditTrailTimeline } from '../../components/AuditTrailTimeline';
import { MerkleBadge, type VerifyState } from '../../components/MerkleBadge';
import { SessionTrail, type SessionEvent } from '../../components/SessionTrail';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import type { CaseDetail, CoCEvent, EvidenceFlag, EvidenceIndexRow, EvidenceNote, EvidenceRecord, Op } from '../../types';

// Evidence detail (M14; M23 tabbed refresh): Overview / Chain of Custody /
// Examiner Notes. Opening this page performs an on-chain read, which the
// gateway auto-logs as ACCESS(view) under the signed-in username — the trail
// includes it. Blob download is participant-only since M18: the button is
// hidden for admins outside the case (the server enforces it regardless).

const FLAGS: Array<Exclude<EvidenceFlag, null>> = ['HIGH_PRIORITY', 'PROCESSED', 'NEEDS_LEAD_REVIEW'];
const FLAG_LABEL: Record<Exclude<EvidenceFlag, null>, string> = {
  HIGH_PRIORITY: 'High priority',
  PROCESSED: 'Processed',
  NEEDS_LEAD_REVIEW: 'Needs lead review',
};

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

function NotesTab({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { client } = useAuth();
  const { msg, run } = useErr();
  const [notes, setNotes] = useState<EvidenceNote[] | null>(null);
  const [body, setBody] = useState('');

  const refresh = useCallback(
    () => client.listNotes(id).then(setNotes).catch(() => setNotes([])),
    [client, id],
  );
  useEffect(() => { void refresh(); }, [refresh]);

  const post = () =>
    run(async () => {
      await client.addNote(id, body);
      setBody('');
      await refresh();
    });

  return (
    <div>
      {notes === null ? <p className="muted">Loading notes…</p>
        : notes.length === 0 ? <p className="muted">No examiner notes yet.</p>
        : (
          <ol className="notes">
            {notes.map((n) => (
              <li key={n.id} className="note">
                <div className="tl-row">
                  <strong>{n.author}</strong>
                  <span className="ts small muted">{n.createdAt}</span>
                </div>
                <div>{n.body}</div>
              </li>
            ))}
          </ol>
        )}
      {canWrite && (
        <div className="form">
          <label>add note (immutable once posted)
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <button disabled={!body.trim()} onClick={post}>Post note</button>
          {msg && <div className="err">{msg}</div>}
        </div>
      )}
      {!canWrite && <p className="hint">Notes are read-only for your case role.</p>}
    </div>
  );
}

export function EvidenceDetailPage() {
  const { evidenceId = '' } = useParams();
  const { client, user } = useAuth();
  const { variant } = useSettings();
  const { msg, run } = useErr();
  const [tab, setTab] = useState('overview');
  const [record, setRecord] = useState<EvidenceRecord | null>(null);
  const [events, setEvents] = useState<CoCEvent[]>([]);
  const [indexRow, setIndexRow] = useState<EvidenceIndexRow | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [verify, setVerify] = useState<VerifyState>('na');
  const [notFound, setNotFound] = useState('');
  const flagErr = useErr();

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
        const row = rows.find((r) => r.evidenceId === evidenceId) ?? null;
        setIndexRow(row);
        // The case roster tells us the viewer's case role (flag/notes gating,
        // admin download visibility). Best-effort display data.
        setCaseDetail(row?.caseId ? await client.getCase(row.caseId) : null);
      } catch {
        setIndexRow(null);
        setCaseDetail(null);
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

  const myCaseRole = caseDetail?.participants.find((p) => p.userId === user?.username)?.roleInCase;
  const isUploader = !indexRow?.caseId && indexRow?.uploadedBy === user?.username;
  const canWrite = user?.role === 'admin' || myCaseRole === 'contributor' || myCaseRole === 'lead' || isUploader;
  // M18: blob content is participant-only even for admins — hide the button
  // when an admin is outside the case (the server 403s it anyway).
  const canDownload = user?.role !== 'admin' || Boolean(myCaseRole) || isUploader;
  const category = (caseDetail?.categories ?? []).find((c) => c.id === indexRow?.categoryId)?.name;

  const setFlag = (flag: EvidenceFlag) =>
    flagErr.run(async () => {
      const row = await client.setFlag(evidenceId, flag);
      setIndexRow(row);
    });

  return (
    <div>
      <div className="card">
        <div className="row-between">
          <h3 className="mono">{evidenceId}</h3>
          <div>
            <MerkleBadge state={anchoring ? verify : 'na'} />
            {indexRow?.flag && <Badge tone={indexRow.flag === 'PROCESSED' ? 'ok' : indexRow.flag === 'HIGH_PRIORITY' ? 'danger' : 'warn'}>{FLAG_LABEL[indexRow.flag]}</Badge>}
          </div>
        </div>
        <div className="btn-row">
          {canDownload && <button onClick={doDownload}>Download</button>}
          <button onClick={doExport}>Export (record + trail)</button>
        </div>
        {!canDownload && <p className="hint">Blob content is participant-only — join the case roster to download (metadata and the trail stay visible).</p>}
        {msg && <div className="err">{msg}</div>}
        {notFound && <div className="muted">{notFound}</div>}

        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'coc', label: `Chain of custody (${events.length})` },
            { id: 'notes', label: 'Examiner notes' },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'overview' && (
          <div>
            {indexRow && (
              <dl className="kv">
                <dt>item</dt><dd>{indexRow.label ?? '—'}</dd>
                <dt>file</dt><dd>{indexRow.originalFilename ?? '—'}</dd>
                <dt>type</dt><dd className="small">{indexRow.mimeType ?? '—'}</dd>
                <dt>category</dt><dd>{category ?? '—'}</dd>
                <dt>seized</dt><dd className="small">{indexRow.seizedAt ?? '—'}</dd>
                <dt>location</dt><dd>{indexRow.acquisitionLocation ?? '—'}</dd>
                <dt>handed over by</dt><dd>{indexRow.handedOverBy ?? '—'}</dd>
                <dt>uploaded by</dt><dd>{indexRow.uploadedBy ?? '—'}</dd>
                <dt>case</dt>
                <dd>
                  {indexRow.caseId
                    ? <Link className="mono small" to={`/cases/${encodeURIComponent(indexRow.caseId)}`}>{indexRow.caseId}</Link>
                    : <span className="muted">uncategorized</span>}
                </dd>
              </dl>
            )}
            {canWrite && (
              <div>
                <h4>Flag</h4>
                <div className="chips">
                  {FLAGS.map((f) => (
                    <button
                      key={f}
                      className={`chip ${indexRow?.flag === f ? 'active' : ''}`}
                      onClick={() => setFlag(indexRow?.flag === f ? null : f)}
                    >
                      {FLAG_LABEL[f]}
                    </button>
                  ))}
                </div>
                {flagErr.msg && <div className="err">{flagErr.msg}</div>}
              </div>
            )}
            <EvidenceCard record={record} />
          </div>
        )}

        {tab === 'coc' && (
          <div>
            <div className="btn-row">
              <button
                className="small"
                disabled={!anchoring || sessionEvents.length === 0}
                title={sessionEvents.length === 0 ? 'Write an event this session first — verification is per event' : 'Verify the latest session event'}
                onClick={() => doVerify(sessionEvents[sessionEvents.length - 1].eventId)}
              >
                Verify latest
              </button>
            </div>
            <AuditTrailTimeline events={events} />
            <SessionTrail events={sessionEvents} anchoring={anchoring} onVerify={doVerify} />
            {canWrite && (
              <div className="demo">
                <section className="col"><TransferCustodyForm id={evidenceId} onEvent={addSessionEvent} /></section>
                <section className="col"><AccessLogForm id={evidenceId} onEvent={addSessionEvent} /></section>
              </div>
            )}
          </div>
        )}

        {tab === 'notes' && <NotesTab id={evidenceId} canWrite={canWrite} />}
      </div>
    </div>
  );
}
