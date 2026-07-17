import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import { niUri } from '../../lib/ni';
import { Badge } from '../../components/ui/Badge';
import { Stepper } from '../../components/ui/Stepper';
import type { CaseSummary, EvidenceCategory, UploadResult } from '../../types';

const STEPS = ['Case & category', 'Metadata', 'File & hash', 'Review & submit'];

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
      <div className="page-narrow">
        <div className="card">
          <h3>Ingested ✓</h3>
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
    <div className="page-narrow">
      <div className="card form">
        <h3>Ingest evidence</h3>
        <Stepper steps={STEPS} current={step} />

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
            <label>file
              <input type="file" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
            </label>
            {hashPct !== null && !localProof && !hashErr && (
              <p className="hint">Hashing locally… {hashPct}%</p>
            )}
            {localProof && (
              <dl className="kv">
                <dt>local SHA-256</dt>
                <dd className="mono small">{localProof}</dd>
              </dl>
            )}
            {hashErr && <div className="err">local hashing failed: {hashErr}</div>}
            <p className="hint">
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

        <div className="btn-row">
          {step > 0 && <button className="small" onClick={() => setStep(step - 1)}>Back</button>}
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
        {msg && <div className="err">{msg}</div>}
      </div>
    </div>
  );
}
