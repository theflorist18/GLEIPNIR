import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import { niUri } from '../../lib/ni';
import { Badge } from '../../components/ui/Badge';
import { Stepper } from '../../components/ui/Stepper';
import { Icon, type IconName } from '../../components/ui/Icon';
import type { CaseSummary, EvidenceCategory, UploadResult } from '../../types';

const STEPS = ['Case & category', 'Metadata', 'File & hash', 'Review & submit'];
const STEP_ICONS: IconName[] = ['nav-cases', 'note', 'fingerprint', 'verify'];

// Byte counts grouped with thin spaces ("184 336 912"), never rounded: the
// exact size is part of the exhibit's description.
const groupDigits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');

// web-upload-dropzone: idle → drag-over → hashing (determinate bar) → hashed
// (local SHA-256) or error. The file input stays the real control; Browse and
// "Choose another file" open it.
function Dropzone({ file, pct, proof, err, onPick }: {
  file: File | null;
  pct: number | null;
  proof: string;
  err: string;
  onPick: (f: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const state = err ? 'error' : proof ? 'hashed' : file ? 'hashing' : 'idle';
  const browse = () => input.current?.click();
  return (
    <div
      className={`dropzone dz-${state}${over ? ' dz-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onPick(e.dataTransfer.files?.[0] ?? null); }}
    >
      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="file" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      {!file ? (
        <div className="dz-idle">
          <Icon name="upload" size={28} />
          <span>Drop a file here or browse</span>
          <button type="button" className="small" onClick={browse}>Browse</button>
        </div>
      ) : (
        <>
          <div className="dz-file">
            <span className="dz-tile"><Icon name={file.type.startsWith('image/') ? 'file-image' : 'file'} size={22} /></span>
            <div className="dz-name">
              <strong>{file.name}</strong>
              <span className="tabular">Size (bytes) {groupDigits(file.size)}</span>
            </div>
            <button type="button" className="link-btn" onClick={browse}>Choose another file</button>
          </div>
          {state === 'hashing' && (
            <div className="dz-progress">
              <div className="row-between">
                <span><Icon name="spinner" size={14} /> Hashing locally…</span>
                <strong className="tabular">{pct ?? 0}%</strong>
              </div>
              <div className="progress" role="progressbar" aria-label="Hashing locally" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                <span style={{ width: `${pct ?? 0}%` }} />
              </div>
            </div>
          )}
          {state === 'hashed' && (
            <div className="dz-proof">
              <span><Icon name="fingerprint" size={14} className="tone-ok" /> local SHA-256</span>
              <span className="mono">{proof}</span>
            </div>
          )}
          {state === 'error' && (
            <div className="dz-error-msg" role="alert"><Icon name="x-circle" size={14} />local hashing failed: {err}</div>
          )}
        </>
      )}
    </div>
  );
}

// Suggest the next ITEM-NNN label from the labels already in the case.
export function suggestLabel(labels: Array<string | null | undefined>): string {
  let max = 0;
  for (const l of labels) {
    const m = /^ITEM-(\d+)$/.exec(l ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ITEM-${String(max + 1).padStart(3, '0')}`;
}

// M22: the ingest wizard — the forensic successor of the M14 single form.
// Bytes are hashed locally (WebCrypto, same RFC 6920 ni-URI as the gateway)
// BEFORE upload, and the server's integrityProof is compared against the
// local hash after: an end-to-end integrity check the examiner can see.
export function IngestPage() {
  const { client, user } = useAuth();
  const { msg, run } = useErr();
  const [step, setStep] = useState(0);

  // Step 1 — case & category
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseId, setCaseId] = useState('');
  const [categories, setCategories] = useState<EvidenceCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');

  // Step 2 — metadata
  const [label, setLabel] = useState('');
  const [seizedAt, setSeizedAt] = useState('');
  const [acquisitionLocation, setAcquisitionLocation] = useState('');
  const [handedOverBy, setHandedOverBy] = useState('');
  const [evidenceId, setEvidenceId] = useState('');

  // Step 3 — file & local hash
  const [file, setFile] = useState<File | null>(null);
  const [hashPct, setHashPct] = useState<number | null>(null);
  const [localProof, setLocalProof] = useState('');
  const [hashErr, setHashErr] = useState('');

  // Step 4 — submit
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  useEffect(() => {
    client.listCases().then(setCases).catch(() => setCases([]));
  }, [client]);

  // Only cases the user can actually write into (admins write anywhere).
  const writableCases = useMemo(
    () => cases.filter((c) => user?.role === 'admin' || c.myRoleInCase === 'contributor' || c.myRoleInCase === 'lead'),
    [cases, user],
  );

  const pickCase = async (id: string) => {
    setCaseId(id);
    setCategoryId('');
    setCategories([]);
    if (id) {
      try {
        const [cats, detail] = await Promise.all([client.listCategories(id), client.getCase(id)]);
        setCategories(cats);
        setLabel((prev) => prev || suggestLabel((detail.evidence || []).map((e) => e.label)));
      } catch { /* categories stay empty; label stays manual */ }
    }
  };

  const pickFile = async (f: File | null) => {
    setFile(f);
    setLocalProof('');
    setHashErr('');
    setHashPct(null);
    if (!f) return;
    // Read with progress, then hash. The FileReader progress drives the bar;
    // the digest itself is a single WebCrypto call over the buffer.
    try {
      const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
        const r = new FileReader();
        r.onprogress = (e) => { if (e.lengthComputable) setHashPct(Math.round((e.loaded / e.total) * 100)); };
        r.onload = () => resolve(r.result as ArrayBuffer);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(f);
      });
      setHashPct(100);
      setLocalProof(await niUri(buf));
    } catch (e) {
      setHashErr(String((e as Error).message || e));
    }
  };

  const submit = () =>
    run(async () => {
      if (!file) return;
      setBusy(true);
      setResult(null);
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        if (evidenceId) form.append('evidenceId', evidenceId);
        if (caseId) form.append('caseId', caseId);
        if (categoryId) form.append('categoryId', categoryId);
        if (label) form.append('label', label);
        if (seizedAt) form.append('seizedAt', new Date(seizedAt).toISOString());
        if (acquisitionLocation) form.append('acquisitionLocation', acquisitionLocation);
        if (handedOverBy) form.append('handedOverBy', handedOverBy);
        setResult(await client.uploadEvidence(form));
      } finally {
        setBusy(false);
      }
    });

  const caseName = cases.find((c) => c.id === caseId)?.name;
  const categoryName = categories.find((c) => c.id === categoryId)?.name;
  const proofMatch = result && localProof ? result.integrityProof === localProof : null;

  if (result) {
    return (
      <div className="page">
        <div className="card wizard">
          <h1>Ingested</h1>
          {proofMatch === true && (
            <p><Badge tone="ok">integrity verified end-to-end</Badge>{' '}
              <span className="small muted">local SHA-256 matches the server-computed proof</span></p>
          )}
          {proofMatch === false && (
            <p><Badge tone="danger">INTEGRITY MISMATCH</Badge>{' '}
              <span className="small">the server-computed proof differs from the local hash — do not rely on this exhibit until investigated</span></p>
          )}
          <dl className="kv">
            <dt>evidenceId</dt><dd className="mono">{result.evidenceId}</dd>
            {label && (<><dt>item</dt><dd>{label}</dd></>)}
            <dt>server proof</dt><dd className="mono small">{result.integrityProof}</dd>
            {localProof && (<><dt>local proof</dt><dd className="mono small">{localProof}</dd></>)}
            {result.txId && (<><dt>txId</dt><dd className="mono small">{result.txId}</dd></>)}
            {result.batched && (<><dt>write path</dt><dd>batched (anchoring) — commits at the batch boundary</dd></>)}
          </dl>
          <p><Link to={`/evidence/${encodeURIComponent(result.evidenceId)}`}>Open evidence detail →</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card form wizard">
        <h1>Ingest evidence</h1>
        <Stepper steps={STEPS} current={step} icons={STEP_ICONS} error={step === 2 && Boolean(hashErr)} />

        {step === 0 && (
          <>
            <label>case
              <select value={caseId} onChange={(e) => void pickCase(e.target.value)}>
                <option value="">— uncategorized (visible to you and admins only) —</option>
                {writableCases.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
              </select>
            </label>
            {caseId && (
              <label>category
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">— none —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            {caseId && categories.length === 0 && (
              <p className="hint">This case has no categories yet — the case lead defines them.</p>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <label>item label
              <input value={label} placeholder="ITEM-001" onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label>seizure date &amp; time
              <input type="datetime-local" value={seizedAt} onChange={(e) => setSeizedAt(e.target.value)} />
            </label>
            <label>acquisition location / source
              <input value={acquisitionLocation} placeholder={'e.g. "Suspect’s bedroom, desk"'} onChange={(e) => setAcquisitionLocation(e.target.value)} />
            </label>
            <label>handed over by (optional)
              <input value={handedOverBy} placeholder="who passed this to you" onChange={(e) => setHandedOverBy(e.target.value)} />
            </label>
            <label>evidence id (optional — generated if blank)
              <input value={evidenceId} placeholder="ev-exhibit-001" onChange={(e) => setEvidenceId(e.target.value)} />
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <div className="field">
              <span className="field-label">file</span>
              <Dropzone file={file} pct={hashPct} proof={localProof} err={hashErr} onPick={(f) => void pickFile(f)} />
            </div>
            <p className="info-hint">
              <Icon name="info" />
              The hash is computed in your browser before upload; after the server
              stores the bytes, its proof is compared against this value.
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <dl className="kv">
              <dt>case</dt><dd>{caseName ?? 'uncategorized'}</dd>
              <dt>category</dt><dd>{categoryName ?? '—'}</dd>
              <dt>item</dt><dd>{label || '—'}</dd>
              <dt>seized</dt><dd>{seizedAt || '—'}</dd>
              <dt>location</dt><dd>{acquisitionLocation || '—'}</dd>
              <dt>handed over by</dt><dd>{handedOverBy || '—'}</dd>
              <dt>file</dt><dd>{file ? `${file.name} (${file.size} bytes)` : '—'}</dd>
              <dt>local proof</dt><dd className="mono small">{localProof || '—'}</dd>
            </dl>
            <p className="hint">
              Submitting stores the bytes off-chain and writes the CREATE event to
              the ledger; every later view/download/export is auto-logged under
              your username.
            </p>
          </>
        )}

        <div className="wizard-actions">
          {step > 0 ? <button className="btn-secondary" onClick={() => setStep(step - 1)}>Back</button> : <span />}
          {step < 3 && (
            <button
              disabled={step === 2 && (!file || (!localProof && !hashErr))}
              onClick={() => setStep(step + 1)}
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button disabled={!file || busy} onClick={submit}>{busy ? 'Ingesting…' : 'Submit'}</button>
          )}
        </div>
        {msg && <div className="alert alert-error" role="alert"><Icon name="x-circle" />{msg}</div>}
      </div>
    </div>
  );
}
