import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings';
import { GatewayError } from '../../api';
import type { Checkpoint, RunDetail, Variant } from '../../types';

// ---- Operator dashboard (variant/sweep config, run control, charts, run
// history + comparison). ARCHITECTURE §5. Execution is host-side (sweep.py);
// the UI creates a run REQUEST and polls the manifest — surfaced honestly
// below. Relocated from dashboard.tsx in M14: now an admin-gated route
// (starting a run requires an admin session server-side too), with the client
// coming from AuthContext instead of the old token setting.

const VARIANTS: Variant[] = ['standard', 'anchoring', 'parallel', 'parallel-anchored'];

function VariantSelector() {
  const { variant, setVariant } = useSettings();
  return (
    <div className="card form">
      <h3>Variant</h3>
      <div className="chips">
        {VARIANTS.map((v) => (
          <button key={v} className={v === variant ? 'chip active' : 'chip'} onClick={() => setVariant(v)}>{v}</button>
        ))}
      </div>
    </div>
  );
}

function SweepConfigForm({ onSubmitted }: { onSubmitted: (runId: string) => void }) {
  const { client } = useAuth();
  const { variant } = useSettings();
  const [n, setN] = useState(100);
  const [k, setK] = useState(25);
  const [channels, setChannels] = useState(1);
  const [load, setLoad] = useState(50);
  const [reps, setReps] = useState(3);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    try {
      const res = await client.startRun({
        variant,
        regime: 'steady',
        cell: { N: n, K: k, channels, offeredLoadTps: load },
        repetitions: reps,
      });
      onSubmitted(res.runId);
    } catch (e) {
      setErr(e instanceof GatewayError ? `${e.status}: ${e.body}` : String(e));
    }
  };

  return (
    <div className="card form">
      <h3>Sweep configuration</h3>
      <p className="hint">Values mirror benchmark/sweeps.yaml. This creates a run <em>request</em>; the sweep runs host-side.</p>
      <label>N (anchoring batch)<input type="number" value={n} onChange={(e) => setN(+e.target.value)} /></label>
      <label>K (parallel-anchored batch)<input type="number" value={k} onChange={(e) => setK(+e.target.value)} /></label>
      <label>channels<input type="number" value={channels} onChange={(e) => setChannels(+e.target.value)} /></label>
      <label>offered load (tps)<input type="number" value={load} onChange={(e) => setLoad(+e.target.value)} /></label>
      <label>repetitions<input type="number" value={reps} onChange={(e) => setReps(+e.target.value)} /></label>
      <button onClick={submit}>Request run</button>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function RunControl({ runId }: { runId: string }) {
  const { client } = useAuth();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await client.getRun(runId);
        if (alive) setDetail(d);
      } catch (e) {
        if (alive) setErr(e instanceof GatewayError ? `${e.status}: ${e.body}` : String(e));
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [runId, client]);

  if (!runId) return <div className="card muted">No run selected. Request one to see live status.</div>;
  return (
    <div className="card">
      <div className="row-between"><h3>Run {runId}</h3><span className="pill">{detail?.status ?? 'requested'}</span></div>
      <p className="hint">Benchmark execution is host-side (orchestration/sweep.py). Status reflects the results manifest.</p>
      {err && <div className="err">{err}</div>}
      {detail && (
        <>
          <ThroughputChart run={detail} />
          <LatencyChart run={detail} />
          <StorageChart checkpoints={detail.checkpoints ?? []} />
        </>
      )}
    </div>
  );
}

function ThroughputChart({ run }: { run: RunDetail }) {
  const data = (run.metrics?.throughput?.perChannel ?? []).map((c) => ({ channel: c.channel, tps: c.tps }));
  if (run.metrics?.throughput?.aggregateTps != null) data.push({ channel: 'aggregate', tps: run.metrics.throughput.aggregateTps });
  if (data.length === 0) return <Empty label="throughput" />;
  return (
    <ChartFrame title="Throughput (successful-only TPS)">
      <BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="channel" /><YAxis /><Tooltip /><Bar dataKey="tps" fill="#4f86c6" /></BarChart>
    </ChartFrame>
  );
}

function LatencyChart({ run }: { run: RunDetail }) {
  const w = run.metrics?.latency?.writeMs;
  const v = run.metrics?.latency?.verificationMs;
  const data = [
    { stat: 'min', write: w?.min ?? null, verify: v?.min ?? null },
    { stat: 'avg', write: w?.avg ?? null, verify: v?.avg ?? null },
    { stat: 'max', write: w?.max ?? null, verify: v?.max ?? null },
  ];
  if (!w && !v) return <Empty label="latency" />;
  return (
    <ChartFrame title="Latency (write vs verification)">
      <LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="stat" /><YAxis /><Tooltip /><Legend />
        <Line dataKey="write" stroke="#4f86c6" /><Line dataKey="verify" stroke="#c65f4f" />
      </LineChart>
    </ChartFrame>
  );
}

function StorageChart({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const data = checkpoints.map((c) => ({
    label: c.label ?? c.tsUtc ?? c.ts ?? '',
    state: c.stateBytes ?? 0,
    ledger: c.ledgerBytes ? Object.values(c.ledgerBytes).reduce((a, b) => a + b, 0) : 0,
  }));
  if (data.length === 0) return <Empty label="storage" />;
  return (
    <ChartFrame title="Storage growth (bytes)">
      <LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Legend />
        <Line dataKey="ledger" stroke="#4f86c6" /><Line dataKey="state" stroke="#6cae75" />
      </LineChart>
    </ChartFrame>
  );
}

function ChartFrame({ title, children }: { title: string; children: ReactElement }) {
  return (
    <div className="chart">
      <h4>{title}</h4>
      <ResponsiveContainer width="100%" height={220}>{children}</ResponsiveContainer>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="chart muted">No {label} data yet (run not executed).</div>;
}

function RunHistory({ onSelect, refreshKey }: { onSelect: (id: string) => void; refreshKey: number }) {
  const { client } = useAuth();
  const [runs, setRuns] = useState<RunDetail[]>([]);
  useEffect(() => { client.listRuns().then(setRuns).catch(() => setRuns([])); }, [client, refreshKey]);
  if (runs.length === 0) return <div className="card muted">No runs yet.</div>;
  return (
    <div className="card">
      <h3>Run history</h3>
      <table className="runs">
        <thead><tr><th>runId</th><th>variant</th><th>status</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId} onClick={() => onSelect(r.runId)} className="clickable">
              <td className="mono small">{r.runId}</td><td>{r.variant ?? '—'}</td><td>{r.status ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunCompare({ runs }: { runs: RunDetail[] }) {
  const rows = useMemo(() => runs.map((r) => ({
    runId: r.runId,
    variant: r.variant ?? '—',
    tps: r.metrics?.throughput?.aggregateTps ?? null,
    writeAvg: r.metrics?.latency?.writeMs?.avg ?? null,
    verifyAvg: r.metrics?.latency?.verificationMs?.avg ?? null,
    bytePerLog: r.metrics?.bytePerLog ?? null,
  })), [runs]);
  if (rows.length < 2) return <div className="card muted">Select 2+ completed runs to compare.</div>;
  return (
    <div className="card">
      <h3>Compare</h3>
      <table className="runs">
        <thead><tr><th>run</th><th>variant</th><th>agg TPS</th><th>write avg</th><th>verify avg</th><th>byte/log</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.runId}><td className="mono small">{r.runId}</td><td>{r.variant}</td>
              <td>{r.tps ?? '—'}</td><td>{r.writeAvg ?? '—'}</td><td>{r.verifyAvg ?? '—'}</td><td>{r.bytePerLog ?? '—'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardPage() {
  const { client } = useAuth();
  const [selected, setSelected] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [compare, setCompare] = useState<RunDetail[]>([]);

  const onSelect = async (id: string) => {
    setSelected(id);
    try {
      const d = await client.getRun(id);
      setCompare((prev) => (prev.find((r) => r.runId === id) ? prev : [...prev, d].slice(-4)));
    } catch { /* ignore */ }
  };

  return (
    <div className="dashboard">
      <section className="col">
        <VariantSelector />
        <SweepConfigForm onSubmitted={(id) => { setSelected(id); setRefreshKey((k) => k + 1); }} />
        <RunHistory onSelect={onSelect} refreshKey={refreshKey} />
      </section>
      <section className="col wide">
        <RunControl runId={selected} />
        <RunCompare runs={compare} />
      </section>
    </div>
  );
}
