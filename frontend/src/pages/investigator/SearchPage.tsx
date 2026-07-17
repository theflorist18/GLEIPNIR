import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import type { CaseSummary, EvidenceIndexRow } from '../../types';

// Search (M15 surface, M14 page): evidence-index and case search, both scoped
// server-side to the caller's participant cases (admins see everything).
export function SearchPage() {
  const { client } = useAuth();
  const evErr = useErr();
  const caseErr = useErr();

  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [uploadedBy, setUploadedBy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<EvidenceIndexRow[] | null>(null);

  const [caseQ, setCaseQ] = useState('');
  const [cases, setCases] = useState<CaseSummary[] | null>(null);

  const searchEvidence = () =>
    evErr.run(async () => {
      setRows(await client.searchEvidence({
        q: q || undefined,
        type: type || undefined,
        uploadedBy: uploadedBy || undefined,
        from: from || undefined,
        to: to || undefined,
      }));
    });

  const searchCases = () =>
    caseErr.run(async () => {
      setCases(await client.searchCases(caseQ));
    });

  return (
    <div>
      <div className="card form filters">
        <h3>Evidence search</h3>
        <div className="filter-row">
          <label>text<input value={q} placeholder="id / filename" onChange={(e) => setQ(e.target.value)} /></label>
          <label>type<input value={type} placeholder="image/" onChange={(e) => setType(e.target.value)} /></label>
          <label>uploader<input value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} /></label>
          <label>from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button onClick={searchEvidence}>Search</button>
        </div>
        {evErr.msg && <div className="err">{evErr.msg}</div>}
      </div>
      {rows && (rows.length === 0 ? (
        <div className="card muted">No evidence matched.</div>
      ) : (
        <div className="card">
          <table className="runs">
            <thead><tr><th>item</th><th>evidence</th><th>file</th><th>type</th><th>case</th><th>uploaded by</th><th>status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.evidenceId} className="clickable">
                  <td className="small">{r.label ?? '—'}</td>
                  <td><Link className="mono small" to={`/evidence/${encodeURIComponent(r.evidenceId)}`}>{r.evidenceId}</Link></td>
                  <td>{r.originalFilename ?? '—'}</td>
                  <td className="small">{r.mimeType ?? '—'}</td>
                  <td>{r.caseId ? <Link className="mono small" to={`/cases/${encodeURIComponent(r.caseId)}`}>{r.caseId.slice(0, 13)}…</Link> : <span className="muted">uncategorized</span>}</td>
                  <td>{r.uploadedBy ?? '—'}</td>
                  <td><span className={`pill ${r.status === 'REMOVED' ? 'removed' : 'active'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="card form filters">
        <h3>Case search</h3>
        <div className="filter-row">
          <label>text<input value={caseQ} placeholder="name / description" onChange={(e) => setCaseQ(e.target.value)} /></label>
          <button onClick={searchCases}>Search</button>
        </div>
        {caseErr.msg && <div className="err">{caseErr.msg}</div>}
      </div>
      {cases && (cases.length === 0 ? (
        <div className="card muted">No cases matched.</div>
      ) : (
        <div className="card">
          <table className="runs">
            <thead><tr><th>name</th><th>status</th><th>created by</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="clickable">
                  <td><Link to={`/cases/${encodeURIComponent(c.id)}`}>{c.name}</Link></td>
                  <td>{c.status}</td>
                  <td>{c.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
