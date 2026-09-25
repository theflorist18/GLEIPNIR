import { useEffect, useState } from 'react';
import { formatTs } from '../../lib/format';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { GatewayError } from '../../api';
import { useErr } from '../../hooks/useErr';
import { CASE_ROLE_LABELS } from '../../roles';
import { AuditTrailTimeline } from '../../components/AuditTrailTimeline';
import type { CocReport } from '../../types';

// M24: the court-presentation Chain-of-Custody report. Rendered OUTSIDE the
// app shell (no nav chrome) and print-optimized — the browser's print-to-PDF
// is the PDF path (no pdfkit dependency, per the approved plan). Fetching
// the report auto-logs one ACCESS('coc-report') per exhibit server-side, so
// generating it is itself part of the trail.
export function CoCReportPage() {
  const { caseId = '' } = useParams();
  const { client } = useAuth();
  const { msg, run } = useErr();
  const [report, setReport] = useState<CocReport | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    client.getCocReport(caseId).then(setReport, (e) => {
      setErr(e instanceof GatewayError && e.status === 404
        ? 'Case not found — or you are not a participant.'
        : String(e));
    });
  }, [client, caseId]);

  const downloadCsv = () =>
    run(async () => {
      const { blob, filename } = await client.downloadCocReportCsv(caseId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });

  if (err) return <div className="report-page"><div className="card err">{err}</div></div>;
  if (!report) return <div className="report-page"><div className="card muted">Assembling report…</div></div>;

  return (
    <div className="report-page">
      <div className="card no-print">
        <div className="btn-row">
          <button onClick={() => window.print()}>Print / save as PDF</button>
          <button onClick={downloadCsv}>Download CSV</button>
          <Link className="small" to={`/cases/${encodeURIComponent(caseId)}`}>← back to case</Link>
        </div>
        {msg && <div className="err">{msg}</div>}
      </div>

      <div className="card">
        <h2>Chain-of-Custody Report</h2>
        <dl className="kv">
          <dt>case</dt><dd>{report.name} <span className="mono small">({report.caseId})</span></dd>
          <dt>status</dt><dd>{report.status}</dd>
          {report.description && (<><dt>description</dt><dd>{report.description}</dd></>)}
          <dt>generated</dt><dd title={report.generatedAt}>{formatTs(report.generatedAt)}</dd>
          <dt>participants</dt>
          <dd>{report.participants.map((p) => `${p.userId} (${CASE_ROLE_LABELS[p.roleInCase]})`).join(', ') || '—'}</dd>
        </dl>
        <p className="hint">
          Trails reflect the ledger at the moment of assembly; generating this
          report appended one ACCESS(coc-report) event per exhibit, which will
          appear in subsequent reports.
        </p>
      </div>

      {report.evidence.map((ev) => (
        <div key={ev.evidenceId} className="card">
          <h3>{ev.label ?? ev.evidenceId}</h3>
          <dl className="kv">
            <dt>evidence id</dt><dd className="mono small">{ev.evidenceId}</dd>
            <dt>file</dt><dd>{ev.originalFilename ?? '—'} <span className="small muted">{ev.mimeType ?? ''}</span></dd>
            <dt>category</dt><dd>{ev.category ?? '—'}</dd>
            <dt>integrity proof</dt><dd className="mono small">{ev.integrityProof ?? '—'}</dd>
            <dt>seized</dt><dd className="small">{ev.seizedAt ?? '—'}</dd>
            <dt>location</dt><dd>{ev.acquisitionLocation ?? '—'}</dd>
            <dt>handed over by</dt><dd>{ev.handedOverBy ?? '—'}</dd>
            <dt>uploaded</dt><dd className="small">{ev.uploadedAt ?? '—'} by {ev.uploadedBy ?? '—'}</dd>
            <dt>status</dt><dd>{ev.status}</dd>
          </dl>
          <h4>Chain of custody ({ev.auditTrail.length})</h4>
          <AuditTrailTimeline events={ev.auditTrail} />
        </div>
      ))}
      {report.evidence.length === 0 && <div className="card muted">No evidence in this case.</div>}
    </div>
  );
}
