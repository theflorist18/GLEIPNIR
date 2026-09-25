import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatTs } from '../../lib/format';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import { CASE_ROLE_LABELS } from '../../roles';
import { Modal } from '../../components/ui/Modal';
import { Icon } from '../../components/ui/Icon';
import { Avatar, StatusPill } from '../../components/ui/Chips';
import type { CaseStatus, CaseSummary } from '../../types';

const STATUSES: Array<CaseStatus | ''> = ['', 'OPEN', 'CLOSED', 'ARCHIVED'];

// Cases the signed-in user participates in (admins see all — same endpoint,
// scoped server-side). Since M18 leads and admins create cases from here.
export function MyCasesPage() {
  const { client, user } = useAuth();
  const { msg, run } = useErr();
  const createErr = useErr();
  const nav = useNavigate();
  const [cases, setCases] = useState<CaseSummary[] | null>(null); // null = first load
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CaseStatus | ''>('');

  const canCreate = user?.role === 'admin' || user?.role === 'lead';
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [leadUserId, setLeadUserId] = useState('');

  const refresh = useCallback(
    () => run(async () => {
      try {
        setCases(await client.listCases({ q: q || undefined, status: status || undefined }));
      } catch (e) {
        setCases((prev) => prev ?? []);
        throw e;
      }
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

  // Newest activity first ("Updated (UTC) ↓").
  const sorted = useMemo(
    () => (cases ? [...cases].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')) : null),
    [cases],
  );
  const filtered = Boolean(q || status);
  const newCase = canCreate && <button onClick={() => setCreating(true)}><Icon name="add" />New case</button>;

  return (
    <div className="page">
      <div className="page-head">
        <h1>My cases</h1>
        {newCase}
      </div>
      <div className="filter-pills">
        <label className="pill-field search">
          <Icon name="nav-search" />
          <input value={q} placeholder="name / description" aria-label="Search cases by name or description" onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="pill-field">
          status
          <select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | '')}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'any'}</option>)}
          </select>
        </label>
        <button className="btn-secondary" onClick={() => void refresh()}><Icon name="filter" />Filter</button>
      </div>
      {msg && <div className="alert alert-error" role="alert"><Icon name="x-circle" />{msg}</div>}

      {sorted && sorted.length === 0 ? (
        <div className="card empty-state">
          {filtered ? (
            <>
              <span>No cases match the filters.</span>
              <button className="btn-secondary" onClick={() => { setQ(''); setStatus(''); }}>Clear filters</button>
            </>
          ) : (
            <>
              <span>No cases yet. A lead or admin grants case access.</span>
              {newCase}
            </>
          )}
        </div>
      ) : (
        <div className="card table-card">
          <table className="runs">
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>My role</th><th>Created by</th>
                <th className="num sorted" aria-sort="descending">Updated (UTC) ↓</th>
                <th className="cell-chevron"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted === null
                ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} aria-hidden="true">
                    {[160, 60, 80, 90, 130, 0].map((w, j) => <td key={j}>{w > 0 && <span className="skeleton" style={{ width: w }} />}</td>)}
                  </tr>
                ))
                : sorted.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/cases/${encodeURIComponent(c.id)}`)}>
                    <td>
                      <div className="cell-name">
                        <Link to={`/cases/${encodeURIComponent(c.id)}`} onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                        <span className="cell-id" title={c.id}>{c.id.length > 18 ? `${c.id.slice(0, 18)}…` : c.id}</span>
                      </div>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td>{c.myRoleInCase
                      ? <span className={`case-role case-role-${c.myRoleInCase}`}>{CASE_ROLE_LABELS[c.myRoleInCase]}</span>
                      : <span className="muted small">—</span>}
                    </td>
                    <td><span className="cell-person"><Avatar name={c.createdBy} />{c.createdBy}</span></td>
                    <td className="cell-ts" title={c.updatedAt}>{formatTs(c.updatedAt)}</td>
                    <td className="cell-chevron"><Icon name="chevron-right" /></td>
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
