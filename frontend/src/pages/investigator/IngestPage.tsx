import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import type { CaseSummary, UploadResult } from '../../types';

// Real file ingest (M14) — the successor of demo.tsx's CreateEvidenceForm.
// Bytes go to the off-chain evidence-store; the ledger records only the
// ni-URI integrity proof. Assigning a case at ingest requires a contributor
// role there (server-enforced); leaving it uncategorized keeps the item
// visible only to the uploader and admins until an admin assigns it.
export function IngestPage() {
  const { client } = useAuth();
  const { msg, run } = useErr();
  const [file, setFile] = useState<File | null>(null);
  const [evidenceId, setEvidenceId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  useEffect(() => {
    client.listCases().then(setCases).catch(() => setCases([]));
  }, [client]);

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
        setResult(await client.uploadEvidence(form));
      } finally {
        setBusy(false);
      }
    });

  return (
    <div className="page-narrow">
      <div className="card form">
        <h3>Ingest evidence</h3>
        <p className="hint">
          The file is stored off-chain in the evidence store; the ledger records its
          SHA-256 ni-URI integrity proof. Every later view, download, and export of
          this item is automatically written to the audit trail under your username.
        </p>
        <label>
          file
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          evidence id (optional — generated if blank)
          <input value={evidenceId} placeholder="ev-exhibit-001" onChange={(e) => setEvidenceId(e.target.value)} />
        </label>
        <label>
          case (optional — requires a contributor role)
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">— uncategorized —</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
            ))}
          </select>
        </label>
        <button disabled={!file || busy} onClick={submit}>{busy ? 'Ingesting…' : 'Ingest'}</button>
        {msg && <div className="err">{msg}</div>}
      </div>

      {result && (
        <div className="card">
          <h3>Ingested ✓</h3>
          <dl className="kv">
            <dt>evidenceId</dt>
            <dd className="mono">{result.evidenceId}</dd>
            <dt>integrity proof</dt>
            <dd className="mono small">{result.integrityProof}</dd>
            {result.txId && (<><dt>txId</dt><dd className="mono small">{result.txId}</dd></>)}
            {result.batched && (<><dt>write path</dt><dd>batched (anchoring) — commits at the batch boundary</dd></>)}
          </dl>
          <p>
            <Link to={`/evidence/${encodeURIComponent(result.evidenceId)}`}>Open evidence detail →</Link>
          </p>
        </div>
      )}
    </div>
  );
}
