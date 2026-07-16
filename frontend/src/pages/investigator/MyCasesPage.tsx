import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import type { CaseStatus, CaseSummary } from '../../types';

const STATUSES: Array<CaseStatus | ''> = ['', 'OPEN', 'CLOSED', 'ARCHIVED'];

// Cases the signed-in user participates in (admins see all — same endpoint,
// scoped server-side).
export function MyCasesPage() {
  const { client } = useAuth();
  const { msg, run } = useErr();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CaseStatus | ''>('');

  const refresh = useCallback(
    () => run(async () => {
      setCases(await client.listCases({ q: q || undefined, status: status || undefined }));
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, q, status],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div>
      <div className="card form filters">
        <h3>My cases</h3>
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
        <div className="card muted">No cases. An admin grants case access.</div>
      ) : (
        <div className="card">
          <table className="runs">
            <thead><tr><th>name</th><th>status</th><th>created by</th><th>updated</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="clickable">
                  <td><Link to={`/cases/${encodeURIComponent(c.id)}`}>{c.name}</Link></td>
                  <td><span className={`pill ${c.status === 'OPEN' ? 'active' : ''}`}>{c.status}</span></td>
                  <td>{c.createdBy}</td>
                  <td className="small muted">{c.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
