import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { GatewayError } from '../../api';
import type { CaseDetail } from '../../types';

const fmtBytes = (n: number | null) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);

// Case metadata + participant roster + evidence roster (M14). Server-side
// scoping means a non-participant gets a 404 here.
export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const { client } = useAuth();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setErr('');
    client.getCase(caseId).then(
      (d) => { if (alive) setDetail(d); },
      (e) => {
        if (!alive) return;
        if (e instanceof GatewayError && e.status === 404) setErr('Case not found — or you are not a participant.');
        else setErr(String(e));
      },
    );
    return () => { alive = false; };
  }, [client, caseId]);

  if (err) return <div className="card err">{err}</div>;
  if (!detail) return <div className="card muted">Loading case…</div>;

  return (
    <div>
      <div className="card">
        <div className="row-between">
          <h3>{detail.name}</h3>
          <span className={`pill ${detail.status === 'OPEN' ? 'active' : ''}`}>{detail.status}</span>
        </div>
        {detail.description && <p>{detail.description}</p>}
        <p className="hint">
          <span className="mono small">{detail.id}</span> · created by {detail.createdBy} · {detail.createdAt}
        </p>
        <div className="chips">
          {detail.participants.map((p) => (
            <span key={p.userId} className="chip">{p.userId} · {p.roleInCase}</span>
          ))}
          {detail.participants.length === 0 && <span className="muted">No participants yet.</span>}
        </div>
      </div>

      <div className="card">
        <h3>Evidence ({detail.evidence.length})</h3>
        {detail.evidence.length === 0 ? (
          <p className="muted">Nothing assigned to this case yet.</p>
        ) : (
          <table className="runs">
            <thead><tr><th>evidence</th><th>file</th><th>type</th><th>size</th><th>uploaded by</th><th>uploaded</th><th>status</th></tr></thead>
            <tbody>
              {detail.evidence.map((e) => (
                <tr key={e.evidenceId} className="clickable">
                  <td><Link className="mono small" to={`/evidence/${encodeURIComponent(e.evidenceId)}`}>{e.evidenceId}</Link></td>
                  <td>{e.originalFilename ?? '—'}</td>
                  <td className="small">{e.mimeType ?? '—'}</td>
                  <td className="small">{fmtBytes(e.sizeBytes)}</td>
                  <td>{e.uploadedBy ?? '—'}</td>
                  <td className="small muted">{e.uploadedAt ?? '—'}</td>
                  <td><span className={`pill ${e.status === 'REMOVED' ? 'removed' : 'active'}`}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
