import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import type { CaseDetail, CaseRole, CaseStatus, CaseSummary } from '../../types';
import { StatusPill } from '../../components/ui/Chips';

// Case administration (M14, admin-only route): create cases, manage the
// participant roster, categorize/uncategorize evidence, change status.
export function CasesAdminPage() {
  const { client } = useAuth();
  const listErr = useErr();
  const detailErr = useErr();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [pUser, setPUser] = useState('');
  const [pRole, setPRole] = useState<CaseRole>('viewer');
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

  const create = () =>
    listErr.run(async () => {
      const c = await client.createCase({ name, description: description || undefined });
      setName(''); setDescription('');
      await refresh();
      await open(c.id);
    });

  const setStatus = (status: CaseStatus) =>
    detailErr.run(async () => {
      if (!detail) return;
      await client.updateCase(detail.id, { status });
      await reopen();
      await refresh();
    });

  const addParticipant = () =>
    detailErr.run(async () => {
      if (!detail) return;
      await client.addParticipant(detail.id, pUser, pRole);
      setPUser('');
      await reopen();
    });

  const removeParticipant = (userId: string) =>
    detailErr.run(async () => {
      if (!detail) return;
      await client.removeParticipant(detail.id, userId);
      await reopen();
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
        <div className="card form">
          <h3>Create case</h3>
          <label>name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <button disabled={!name} onClick={create}>Create</button>
          {listErr.msg && <div className="err">{listErr.msg}</div>}
        </div>
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
        </div>
      </section>
      <section className="col wide">
        {!detail ? (
          <div className="card muted">Select a case to manage its roster and evidence.</div>
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
              <h3>Participants ({detail.participants.length})</h3>
              <ul className="plain-list">
                {detail.participants.map((p) => (
                  <li key={p.userId}>
                    <span>{p.userId} · {p.roleInCase}</span>
                    <button className="small" onClick={() => removeParticipant(p.userId)}>Remove</button>
                  </li>
                ))}
              </ul>
              <div className="filter-row">
                <label>username<input value={pUser} onChange={(e) => setPUser(e.target.value)} /></label>
                <label>role
                  <select value={pRole} onChange={(e) => setPRole(e.target.value as CaseRole)}>
                    <option value="viewer">viewer</option>
                    <option value="contributor">contributor</option>
                    <option value="lead">case lead</option>
                  </select>
                </label>
                <button disabled={!pUser} onClick={addParticipant}>Grant</button>
              </div>
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
