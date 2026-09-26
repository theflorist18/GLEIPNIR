import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import type { CaseDetail, CaseStatus, CaseSummary } from '../../types';
import { StatusPill } from '../../components/ui/Chips';

// Case administration (M14, admin-only route): the all-cases list, status
// change, categorize/uncategorize evidence. Admins create cases from
// MyCasesPage and manage rosters in CaseDetailPage's Team section.
export function CasesAdminPage() {
  const { client } = useAuth();
  const listErr = useErr();
  const detailErr = useErr();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);

  const [evidenceId, setEvidenceId] = useState('');

  const refresh = useCallback(
    () => listErr.run(async () => setCases(await client.listCases())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );
  useEffect(() => { void refresh(); }, [refresh]);

  const open = (id: string) =>
    detailErr.run(async () => setDetail(await client.getCase(id)));

  const reopen = async () => { if (detail) await open(detail.id); };

  const setStatus = (status: CaseStatus) =>
    detailErr.run(async () => {
      if (!detail) return;
      await client.updateCase(detail.id, { status });
      await reopen();
      await refresh();
    });

  const assign = () =>
    detailErr.run(async () => {
      if (!detail) return;
      await client.assignEvidence(detail.id, evidenceId);
      setEvidenceId('');
      await reopen();
    });

  const unassign = (eid: string) =>
    detailErr.run(async () => {
      if (!detail) return;
      await client.unassignEvidence(detail.id, eid);
      await reopen();
    });

  return (
    <div className="demo">
      <section className="col">
        <div className="card">
          <h3>All cases ({cases.length})</h3>
          <table className="runs">
            <thead><tr><th>name</th><th>status</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => void open(c.id)}>
                  <td>{c.name}</td>
                  <td><StatusPill status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {listErr.msg && <div className="err">{listErr.msg}</div>}
        </div>
      </section>
      <section className="col wide">
        {!detail ? (
          <div className="card muted">Select a case to manage its status and evidence.</div>
        ) : (
          <>
            <div className="card">
              <div className="row-between">
                <h3>{detail.name}</h3>
                <StatusPill status={detail.status} />
              </div>
              <p className="hint mono small">{detail.id}</p>
              <div className="btn-row">
                {(['OPEN', 'CLOSED', 'ARCHIVED'] as CaseStatus[]).filter((s) => s !== detail.status).map((s) => (
                  <button key={s} className="small" onClick={() => setStatus(s)}>Mark {s}</button>
                ))}
                <Link to={`/cases/${encodeURIComponent(detail.id)}`}>investigator view →</Link>
              </div>
              {detailErr.msg && <div className="err">{detailErr.msg}</div>}
            </div>

            <div className="card form">
              <h3>Evidence ({detail.evidence.length})</h3>
              <ul className="plain-list">
                {detail.evidence.map((e) => (
                  <li key={e.evidenceId}>
                    <Link className="mono small" to={`/evidence/${encodeURIComponent(e.evidenceId)}`}>
                      {e.evidenceId}
                    </Link>
                    <span className="muted small">{e.originalFilename ?? ''}</span>
                    <button className="small" onClick={() => unassign(e.evidenceId)}>Unassign</button>
                  </li>
                ))}
              </ul>
              <div className="filter-row">
                <label>evidence id<input value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} /></label>
                <button disabled={!evidenceId} onClick={assign}>Assign to case</button>
              </div>
              <p className="hint">One case per evidence item — assigning something already categorized elsewhere is refused.</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
