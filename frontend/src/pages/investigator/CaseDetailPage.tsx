import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { GatewayError } from '../../api';
import { useErr } from '../../hooks/useErr';
import { ALL_CASE_ROLES, CASE_ROLE_LABELS } from '../../roles';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Tabs } from '../../components/ui/Tabs';
import { Timeline } from '../../components/ui/Timeline';
import type { TimelineItem } from '../../components/ui/Timeline';
import type { CaseActivityEvent, CaseDetail, CaseRole, EvidenceFlag } from '../../types';

const fmtBytes = (n: number | null) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);

const FLAG_TONE: Record<Exclude<EvidenceFlag, null>, 'danger' | 'ok' | 'warn'> = {
  HIGH_PRIORITY: 'danger',
  PROCESSED: 'ok',
  NEEDS_LEAD_REVIEW: 'warn',
};
const FLAG_LABEL: Record<Exclude<EvidenceFlag, null>, string> = {
  HIGH_PRIORITY: 'High priority',
  PROCESSED: 'Processed',
  NEEDS_LEAD_REVIEW: 'Needs lead review',
};

const ACTIVITY_TONE: Record<CaseActivityEvent['type'], TimelineItem['tone']> = {
  CASE_CREATED: 'ok',
  CASE_UPDATED: 'accent',
  PARTICIPANT_ADDED: 'accent',
  EVIDENCE_ADDED: 'ok',
  NOTE_ADDED: 'muted',
};

function activityLine(e: CaseActivityEvent): string {
  switch (e.type) {
    case 'CASE_CREATED': return `${e.actor ?? '?'} created the case`;
    case 'CASE_UPDATED': return `case updated (status ${String(e.detail?.status ?? '?')})`;
    case 'PARTICIPANT_ADDED': return `${e.actor || 'someone'} added ${String(e.detail?.userId ?? '?')} as ${String(e.detail?.roleInCase ?? '?')}`;
    case 'EVIDENCE_ADDED': return `${e.actor ?? '?'} added evidence${e.detail?.label ? ` ${String(e.detail.label)}` : ''}`;
    case 'NOTE_ADDED': return `${e.actor ?? '?'} added an examiner note`;
    default: return e.type;
  }
}

// Case detail (M14; M23 tabbed refresh): Overview / Evidence / Activity /
// Team. Server-side scoping means a non-participant gets a 404 here; the
// Team tab is manageable only by admins and the case lead (server-enforced,
// mirrored in the UI).
export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const { client, user } = useAuth();
  const teamErr = useErr();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [activity, setActivity] = useState<CaseActivityEvent[] | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('overview');

  const [adding, setAdding] = useState(false);
  const [pUser, setPUser] = useState('');
  const [pRole, setPRole] = useState<CaseRole>('viewer');

  const refresh = useCallback(() => {
    setErr('');
    return client.getCase(caseId).then(
      (d) => setDetail(d),
      (e) => {
        if (e instanceof GatewayError && e.status === 404) setErr('Case not found — or you are not a participant.');
        else setErr(String(e));
      },
    );
  }, [client, caseId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (tab === 'activity' && activity === null) {
      client.getCaseActivity(caseId).then(setActivity).catch(() => setActivity([]));
    }
  }, [tab, activity, client, caseId]);

  if (err) return <div className="card err">{err}</div>;
  if (!detail) return <div className="card muted">Loading case…</div>;

  const myRole = detail.participants.find((p) => p.userId === user?.username)?.roleInCase;
  const canManageTeam = user?.role === 'admin' || myRole === 'lead';

  const addParticipant = () =>
    teamErr.run(async () => {
      await client.addParticipant(caseId, pUser, pRole);
      setAdding(false);
      setPUser('');
      setActivity(null); // stale
      await refresh();
    });

  const removeParticipant = (userId: string) =>
    teamErr.run(async () => {
      await client.removeParticipant(caseId, userId);
      setActivity(null);
      await refresh();
    });

  return (
    <div>
      <div className="card">
        <div className="row-between">
          <h3>{detail.name}</h3>
          <span className={`pill ${detail.status === 'OPEN' ? 'active' : ''}`}>{detail.status}</span>
        </div>
        <p className="hint">
          <span className="mono small">{detail.id}</span> · created by {detail.createdBy} · {detail.createdAt}
        </p>
        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'evidence', label: `Evidence (${detail.evidence.length})` },
            { id: 'activity', label: 'Activity' },
            { id: 'team', label: `Team (${detail.participants.length})`, hidden: !canManageTeam },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'overview' && (
          <div>
            {detail.description ? <p>{detail.description}</p> : <p className="muted">No description.</p>}
            <h4>Categories</h4>
            <div className="chips">
              {(detail.categories ?? []).map((c) => <span key={c.id} className="chip">{c.name}</span>)}
              {(detail.categories ?? []).length === 0 && <span className="muted small">None yet — the case lead defines the taxonomy.</span>}
            </div>
            <h4>Participants</h4>
            <div className="chips">
              {detail.participants.map((p) => (
                <span key={p.userId} className="chip">
                  {p.userId} · {CASE_ROLE_LABELS[p.roleInCase]}
                </span>
              ))}
              {detail.participants.length === 0 && <span className="muted">No participants yet.</span>}
            </div>
          </div>
        )}

        {tab === 'evidence' && (
          detail.evidence.length === 0 ? (
            <p className="muted">Nothing assigned to this case yet.</p>
          ) : (
            <table className="runs">
              <thead><tr><th>item</th><th>evidence</th><th>file</th><th>category</th><th>flag</th><th>size</th><th>uploaded by</th><th>status</th></tr></thead>
              <tbody>
                {detail.evidence.map((e) => {
                  const cat = (detail.categories ?? []).find((c) => c.id === e.categoryId)?.name;
                  return (
                    <tr key={e.evidenceId} className="clickable">
                      <td className="small">{e.label ?? '—'}</td>
                      <td><Link className="mono small" to={`/evidence/${encodeURIComponent(e.evidenceId)}`}>{e.evidenceId}</Link></td>
                      <td>{e.originalFilename ?? '—'}</td>
                      <td className="small">{cat ?? '—'}</td>
                      <td>{e.flag ? <Badge tone={FLAG_TONE[e.flag]}>{FLAG_LABEL[e.flag]}</Badge> : <span className="muted small">—</span>}</td>
                      <td className="small">{fmtBytes(e.sizeBytes)}</td>
                      <td>{e.uploadedBy ?? '—'}</td>
                      <td><span className={`pill ${e.status === 'REMOVED' ? 'removed' : 'active'}`}>{e.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === 'activity' && (
          activity === null ? <p className="muted">Loading activity…</p>
          : activity.length === 0 ? <p className="muted">No activity yet.</p>
          : (
            <Timeline
              items={activity.map((e, i) => ({
                key: `${e.type}-${e.ts}-${i}`,
                tone: ACTIVITY_TONE[e.type],
                content: (
                  <div className="tl-event">
                    <div className="tl-row">
                      <span>{activityLine(e)}</span>
                      {e.evidenceId && <Link className="mono small" to={`/evidence/${encodeURIComponent(e.evidenceId)}`}>{e.evidenceId}</Link>}
                      <span className="ts small muted">{e.ts}</span>
                    </div>
                  </div>
                ),
              }))}
            />
          )
        )}

        {tab === 'team' && canManageTeam && (
          <div>
            <div className="btn-row">
              <button onClick={() => setAdding(true)}>Add participant</button>
            </div>
            <ul className="plain-list">
              {detail.participants.map((p) => (
                <li key={p.userId}>
                  <span>
                    {p.userId}{' '}
                    <Badge tone={p.roleInCase === 'lead' ? 'warn' : 'muted'}>{CASE_ROLE_LABELS[p.roleInCase]}</Badge>
                  </span>
                  <button className="small" onClick={() => removeParticipant(p.userId)}>Remove</button>
                </li>
              ))}
            </ul>
            <p className="hint">A case keeps at least one lead; the case-lead role needs a user with the global lead role.</p>
            {teamErr.msg && <div className="err">{teamErr.msg}</div>}
          </div>
        )}
      </div>

      {adding && (
        <Modal title="Add participant" onClose={() => setAdding(false)}>
          <div className="form">
            <label>username<input value={pUser} onChange={(e) => setPUser(e.target.value)} /></label>
            <label>role in case
              <select value={pRole} onChange={(e) => setPRole(e.target.value as CaseRole)}>
                {ALL_CASE_ROLES.map((r) => <option key={r} value={r}>{CASE_ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <div className="btn-row">
              <button disabled={!pUser} onClick={addParticipant}>Grant access</button>
              <button className="small" onClick={() => setAdding(false)}>Cancel</button>
            </div>
            {teamErr.msg && <div className="err">{teamErr.msg}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
