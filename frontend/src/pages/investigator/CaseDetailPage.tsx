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
import { activityLine, activityTone } from '../../lib/activity';
import type { CaseActivityEvent, CaseDetail, CaseRole, EvidenceFlag, EvidenceIndexRow, User } from '../../types';

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
const FLAGS: Array<Exclude<EvidenceFlag, null>> = ['HIGH_PRIORITY', 'PROCESSED', 'NEEDS_LEAD_REVIEW'];

// M25: the same general file-type presets case-registry seeds into new cases
// (and backfills into zero-category ones). Shown as one-click adds for
// partially-curated cases where the lead wants one back.
const PRESET_CATEGORIES = ['Image', 'Video', 'Audio', 'Text', 'Document', 'PDF', 'Spreadsheet', 'Archive', 'Other'];

// M25: the evidence-tab export is CLIENT-side CSV over exactly the filtered
// rows — library metadata only (no blob fetch, no trail), so it is not an
// evidence access and is deliberately not auto-logged (mirrors /details).
const csvCell = (v: unknown): string => {
  const raw = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection (S10): a value starting = + - @
  // TAB or CR runs as a formula when this export is opened in Excel/Sheets.
  // Prefix with a single quote so it renders literally. File names, labels and
  // free-text metadata are user-controlled and reach these cells.
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function evidenceCsv(rows: EvidenceIndexRow[], categoryName: (id: string | null | undefined) => string | null): string {
  const header = ['item', 'evidenceId', 'file', 'category', 'flag', 'sizeBytes', 'uploadedBy', 'uploadedAt', 'status', 'integrityProof'];
  const lines = [header.join(',')];
  for (const e of rows) {
    lines.push([
      e.label, e.evidenceId, e.originalFilename, categoryName(e.categoryId), e.flag,
      e.sizeBytes, e.uploadedBy, e.uploadedAt, e.status, e.integrityProof,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
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
  const [directory, setDirectory] = useState<User[]>([]);

  const catErr = useErr();
  const [newCat, setNewCat] = useState('');

  // M25: Overview folds Categories and Team into press-to-expand sections.
  const [openCats, setOpenCats] = useState(false);
  const [openTeam, setOpenTeam] = useState(false);

  // M25: evidence-tab filters; the CSV export covers exactly the filtered rows.
  const [fq, setFq] = useState('');
  const [fCat, setFCat] = useState('');
  const [fFlag, setFFlag] = useState('');
  const [fStatus, setFStatus] = useState('');

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

  const catNameOf = (id: string | null | undefined) => (detail.categories ?? []).find((c) => c.id === id)?.name ?? null;
  const filteredEvidence = detail.evidence.filter((e) => {
    if (fq && !`${e.evidenceId} ${e.label ?? ''} ${e.originalFilename ?? ''}`.toLowerCase().includes(fq.toLowerCase())) return false;
    if (fCat && e.categoryId !== fCat) return false;
    if (fFlag && e.flag !== fFlag) return false;
    if (fStatus && e.status !== fStatus) return false;
    return true;
  });

  const exportFilteredCsv = () => {
    const blob = new Blob([evidenceCsv(filteredEvidence, catNameOf)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${detail.name.replace(/[^A-Za-z0-9._-]+/g, '_')}-evidence.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const addCategory = (name: string) =>
    catErr.run(async () => {
      await client.createCategory(caseId, name);
      setNewCat('');
      await refresh();
    });

  const deleteCategory = (categoryId: string) =>
    catErr.run(async () => {
      await client.deleteCategory(caseId, categoryId);
      await refresh();
    });

  const changeRole = (userId: string, roleInCase: CaseRole) =>
    teamErr.run(async () => {
      await client.updateParticipantRole(caseId, userId, roleInCase);
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
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'overview' && (
          <div>
            {detail.description ? <p>{detail.description}</p> : <p className="muted">No description.</p>}
            <div className="btn-row">
              <Link to={`/cases/${encodeURIComponent(caseId)}/report`}><button>CoC report (print / CSV)</button></Link>
            </div>
            <h4>
              <button className="section-toggle" aria-expanded={openCats} onClick={() => setOpenCats(!openCats)}>
                {openCats ? '▾' : '▸'} Categories ({(detail.categories ?? []).length})
              </button>
            </h4>
            {openCats && (
              <div>
                <div className="chips">
                  {(detail.categories ?? []).map((c) => (
                    <span key={c.id} className="chip">
                      {c.name}
                      {canManageTeam && (
                        <button className="chip-x" title="Delete category (refused while evidence references it)" onClick={() => deleteCategory(c.id)}>×</button>
                      )}
                    </span>
                  ))}
                  {(detail.categories ?? []).length === 0 && <span className="muted small">None yet — the case lead defines the taxonomy.</span>}
                </div>
                {canManageTeam && (
                  <div>
                    {PRESET_CATEGORIES.some((p) => !(detail.categories ?? []).some((c) => c.name === p)) && (
                      <div className="chips">
                        <span className="muted small">add preset:</span>
                        {PRESET_CATEGORIES.filter((p) => !(detail.categories ?? []).some((c) => c.name === p)).map((p) => (
                          <button key={p} className="chip" onClick={() => addCategory(p)}>+ {p}</button>
                        ))}
                      </div>
                    )}
                    <div className="btn-row">
                      <input
                        value={newCat}
                        placeholder="new category name"
                        onChange={(e) => setNewCat(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newCat.trim()) void addCategory(newCat.trim()); }}
                      />
                      <button className="small" disabled={!newCat.trim()} onClick={() => addCategory(newCat.trim())}>Add category</button>
                    </div>
                    {catErr.msg && <div className="err">{catErr.msg}</div>}
                  </div>
                )}
              </div>
            )}
            <h4>
              <button className="section-toggle" aria-expanded={openTeam} onClick={() => setOpenTeam(!openTeam)}>
                {openTeam ? '▾' : '▸'} Team ({detail.participants.length})
              </button>
            </h4>
            {openTeam && (
              <div>
                {canManageTeam && (
                  <div className="btn-row">
                    <button className="small" onClick={() => {
                      setAdding(true);
                      client.listUserDirectory().then(setDirectory).catch(() => setDirectory([]));
                    }}>Add participant</button>
                  </div>
                )}
                <ul className="plain-list">
                  {detail.participants.map((p) => (
                    <li key={p.userId}>
                      <span>
                        {p.userId}{' '}
                        <Badge tone={p.roleInCase === 'lead' ? 'warn' : 'muted'}>{CASE_ROLE_LABELS[p.roleInCase]}</Badge>
                      </span>
                      {canManageTeam && (
                        <span className="btn-row">
                          <select
                            value={p.roleInCase}
                            aria-label={`role of ${p.userId}`}
                            onChange={(e) => changeRole(p.userId, e.target.value as CaseRole)}
                          >
                            {ALL_CASE_ROLES.map((r) => <option key={r} value={r}>{CASE_ROLE_LABELS[r]}</option>)}
                          </select>
                          <button className="small" onClick={() => removeParticipant(p.userId)}>Remove</button>
                        </span>
                      )}
                    </li>
                  ))}
                  {detail.participants.length === 0 && <li className="muted small">No participants yet.</li>}
                </ul>
                {canManageTeam && <p className="hint">Viewer = view/export · Contributor = + add evidence &amp; annotations · Case Lead = everything incl. removal &amp; this roster. A case keeps at least one lead.</p>}
                {teamErr.msg && <div className="err">{teamErr.msg}</div>}
              </div>
            )}
          </div>
        )}

        {tab === 'evidence' && (
          detail.evidence.length === 0 ? (
            <p className="muted">Nothing assigned to this case yet.</p>
          ) : (
            <div>
              <div className="btn-row filter-bar">
                <input value={fq} placeholder="filter: id, item, filename" onChange={(e) => setFq(e.target.value)} />
                <select value={fCat} aria-label="filter by category" onChange={(e) => setFCat(e.target.value)}>
                  <option value="">any category</option>
                  {(detail.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={fFlag} aria-label="filter by flag" onChange={(e) => setFFlag(e.target.value)}>
                  <option value="">any flag</option>
                  {FLAGS.map((f) => <option key={f} value={f}>{FLAG_LABEL[f]}</option>)}
                </select>
                <select value={fStatus} aria-label="filter by status" onChange={(e) => setFStatus(e.target.value)}>
                  <option value="">any status</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="REMOVED">REMOVED</option>
                </select>
                <button className="small" disabled={filteredEvidence.length === 0} onClick={exportFilteredCsv}>
                  Export CSV ({filteredEvidence.length})
                </button>
              </div>
              {filteredEvidence.length === 0 ? (
                <p className="muted">No evidence matches the filters.</p>
              ) : (
                <table className="runs">
                  <thead><tr><th>item</th><th>evidence</th><th>file</th><th>category</th><th>flag</th><th>size</th><th>uploaded by</th><th>status</th></tr></thead>
                  <tbody>
                    {filteredEvidence.map((e) => (
                      <tr key={e.evidenceId} className="clickable">
                        <td className="small">{e.label ?? '—'}</td>
                        <td><Link className="mono small" to={`/evidence/${encodeURIComponent(e.evidenceId)}`}>{e.evidenceId}</Link></td>
                        <td>{e.originalFilename ?? '—'}</td>
                        <td className="small">{catNameOf(e.categoryId) ?? '—'}</td>
                        <td>{e.flag ? <Badge tone={FLAG_TONE[e.flag]}>{FLAG_LABEL[e.flag]}</Badge> : <span className="muted small">—</span>}</td>
                        <td className="small">{fmtBytes(e.sizeBytes)}</td>
                        <td>{e.uploadedBy ?? '—'}</td>
                        <td><span className={`pill ${e.status === 'REMOVED' ? 'removed' : 'active'}`}>{e.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        )}

        {tab === 'activity' && (
          activity === null ? <p className="muted">Loading activity…</p>
          : activity.length === 0 ? <p className="muted">No activity yet.</p>
          : (
            <Timeline
              items={activity.map((e, i) => ({
                key: `${e.type}-${e.ts}-${i}`,
                tone: activityTone(e),
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

      </div>

      {adding && (
        <Modal title="Add participant" onClose={() => setAdding(false)}>
          <div className="form">
            {(() => {
              // Candidates: active users not yet on the roster; case-lead
              // grants need a global-lead target (server-enforced — the
              // picker just avoids offering a guaranteed 400).
              const candidates = directory.filter((u) =>
                !detail.participants.some((p) => p.userId === u.username)
                && (pRole !== 'lead' || u.role === 'lead'));
              return (
                <>
                  <label>user
                    <select value={pUser} onChange={(e) => setPUser(e.target.value)}>
                      <option value="">— pick a user —</option>
                      {candidates.map((u) => (
                        <option key={u.id} value={u.username}>{u.username}{u.name && u.name !== u.username ? ` — ${u.name}` : ''} ({u.role})</option>
                      ))}
                    </select>
                  </label>
                  {candidates.length === 0 && <p className="hint">{pRole === 'lead' ? 'No global-lead users are available to add.' : 'Every active user is already on this roster.'}</p>}
                </>
              );
            })()}
            <label>role in case
              <select value={pRole} onChange={(e) => { const r = e.target.value as CaseRole; setPRole(r); if (r === 'lead' && !directory.some((u) => u.username === pUser && u.role === 'lead')) setPUser(''); }}>
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
