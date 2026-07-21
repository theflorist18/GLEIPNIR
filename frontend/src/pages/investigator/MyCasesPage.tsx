import { useCallback, useEffect, useState } from 'react';
import { formatTs } from '../../lib/format';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import { CASE_ROLE_LABELS } from '../../roles';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import type { CaseStatus, CaseSummary } from '../../types';

const STATUSES: Array<CaseStatus | ''> = ['', 'OPEN', 'CLOSED', 'ARCHIVED'];

// Cases the signed-in user participates in (admins see all — same endpoint,
// scoped server-side). Since M18 leads and admins create cases from here.
export function MyCasesPage() {
  const { client, user } = useAuth();
  const { msg, run } = useErr();
  const createErr = useErr();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CaseStatus | ''>('');

  const canCreate = user?.role === 'admin' || user?.role === 'lead';
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [leadUserId, setLeadUserId] = useState('');

  const refresh = useCallback(
    () => run(async () => {
      setCases(await client.listCases({ q: q || undefined, status: status || undefined }));
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, q, status],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  const create = () =>
    createErr.run(async () => {
      await client.createCase({
        name,
        description: description || undefined,
        // Admins may hand the case to a lead at creation; leads own their own.
        leadUserId: user?.role === 'admin' && leadUserId ? leadUserId : undefined,
      });
      setCreating(false);
      setName(''); setDescription(''); setLeadUserId('');
      await refresh();
    });

  return (
    <div>
      <div className="card form filters">
        <div className="evidence-head">
          <h3>My cases</h3>
          {canCreate && <button onClick={() => setCreating(true)}>New case</button>}
        </div>
        <div className="filter-row">
          <label>search<input value={q} placeholder="name / description" onChange={(e) => setQ(e.target.value)} /></label>
          <label>status
            <select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | '')}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || 'any'}</option>)}
            </select>
          </label>
          <button onClick={() => void refresh()}>Filter</button>
        </div>
        {msg && <div className="err">{msg}</div>}
      </div>
      {cases.length === 0 ? (
        <div className="card muted">No cases yet. A lead or admin grants case access.</div>
      ) : (
        <div className="card">
          <table className="runs">
            <thead><tr><th>name</th><th>status</th><th>my role</th><th>created by</th><th>updated</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="clickable">
                  <td><Link to={`/cases/${encodeURIComponent(c.id)}`}>{c.name}</Link></td>
                  <td><span className={`pill ${c.status === 'OPEN' ? 'active' : ''}`}>{c.status}</span></td>
                  <td>{c.myRoleInCase
                    ? <Badge tone={c.myRoleInCase === 'lead' ? 'warn' : 'muted'}>{CASE_ROLE_LABELS[c.myRoleInCase]}</Badge>
                    : <span className="muted small">—</span>}
                  </td>
                  <td>{c.createdBy}</td>
                  <td className="small muted" title={c.updatedAt}>{formatTs(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title="New case" onClose={() => setCreating(false)}>
          <div className="form">
            <label>name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            {user?.role === 'admin' && (
              <label>lead (username, optional)
                <input value={leadUserId} placeholder="hand the case to a lead" onChange={(e) => setLeadUserId(e.target.value)} />
              </label>
            )}
            {user?.role === 'lead' && <p className="hint">You will be added to the roster as the case lead.</p>}
            <div className="btn-row">
              <button disabled={!name} onClick={create}>Create case</button>
              <button className="small" onClick={() => setCreating(false)}>Cancel</button>
            </div>
            {createErr.msg && <div className="err">{createErr.msg}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
