'use strict';

// Per-transaction JSONL capture (brief §4) — the source of p95 latency, success/
// failure counts and failure classes (orchestration/collect.py).
//
// Env GLEIPNIR_TXLOG_DIR (set by the orchestrator per round); absent → every
// call is a no-op. Each worker appends to `${dir}/tx-w${workerIndex}.jsonl`:
//   {"round":label,"op":..,"caseId":..,"evidenceId":..,"tCreate":ms,"tFinal":ms,
//    "latencyMs":n,"ok":bool,"err":string|null,"timed":bool}
// taken from Caliper's own TxStatus (GetTimeCreate/GetTimeFinal/IsCommitted/
// GetErrMsg) — the same timestamps behind Caliper's min/avg/max.
//
// `timed: false` marks a write the round performed but did NOT measure — the
// untimed pool seeding of the pool workloads and verify.js. Those writes still
// land in the block store, so collect.py counts them in the storage
// bytes-per-event denominator while excluding them from every latency /
// throughput / failure statistic. Without them an `ops` run divides the bytes
// of ~10x more ledger events by the timed count alone (finding: storage
// inflated 5-10x).
//
// Never on the timed path: log() only pushes a string; a short unref'd timer
// flushes with fs.appendFile (threadpool, off the event loop). Whatever is
// still pending at exit is written synchronously from the 'exit' hook.
// ponytail: a chunk in flight during a hard process.exit() may be lost; the
// worker normally exits naturally (pending fs ops keep the loop alive).

const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.GLEIPNIR_TXLOG_DIR || null;
const files = new Map(); // workerIndex -> { file, pending: [], inflight: false, timer }

function fileState(workerIndex) {
  let st = files.get(workerIndex);
  if (!st) {
    st = { file: path.join(dir, `tx-w${workerIndex}.jsonl`), pending: [], inflight: false, timer: null };
    files.set(workerIndex, st);
    if (files.size === 1) process.on('exit', flushAllSync);
  }
  return st;
}

function flush(st) {
  st.timer = null;
  if (st.inflight || st.pending.length === 0) return;
  const chunk = st.pending.join('');
  st.pending = [];
  st.inflight = true;
  fs.appendFile(st.file, chunk, (err) => {
    st.inflight = false;
    if (err) process.stderr.write(`[txlog] append failed: ${err.message}\n`);
    if (st.pending.length && !st.timer) st.timer = setTimeout(() => flush(st), 200).unref();
  });
}

function flushAllSync() {
  for (const st of files.values()) {
    if (st.pending.length === 0) continue;
    try { fs.appendFileSync(st.file, st.pending.join('')); } catch (err) { process.stderr.write(`[txlog] final append failed: ${err.message}\n`); }
    st.pending = [];
  }
}

function errText(status) {
  const msgs = status.GetErrMsg ? status.GetErrMsg() : null;
  if (!Array.isArray(msgs)) return null;
  const m = msgs.find((x) => x !== undefined && x !== null && String(x) !== '');
  return m === undefined ? null : String(m);
}

function write(workerIndex, line) {
  const st = fileState(workerIndex);
  st.pending.push(`${JSON.stringify(line)}\n`);
  if (!st.timer && !st.inflight) st.timer = setTimeout(() => flush(st), 200).unref();
}

// One line, in the key order of the header's schema.
const entry = (round, op, caseId, evidenceId, tCreate, tFinal, ok, err, timed) => ({
  round,
  op,
  caseId: caseId || null,
  evidenceId: evidenceId || null,
  tCreate,
  tFinal,
  latencyMs: tFinal && tCreate ? tFinal - tCreate : null,
  ok: Boolean(ok),
  err: err || null,
  timed,
});

// status: the Caliper TxStatus returned by sutAdapter.sendRequests(single request).
// timed=false for untimed pool seeding (still a ledger write; see the header).
function log(workerIndex, round, op, caseId, evidenceId, status, timed = true) {
  if (!dir || !status) return;
  write(workerIndex, entry(round, op, caseId, evidenceId, status.GetTimeCreate(), status.GetTimeFinal(),
    status.IsCommitted(), errText(status), Boolean(timed)));
}

// An untimed ledger write performed OUTSIDE the connector (verify.js seeds over
// plain fetch, so there is no TxStatus). Same storage accounting, no timings.
function logUntimed(workerIndex, round, op, caseId, evidenceId, ok, err) {
  if (dir) write(workerIndex, entry(round, op, caseId, evidenceId, null, null, ok, err, false));
}

module.exports = { log, logUntimed };
