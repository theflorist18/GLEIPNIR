'use strict';

// Run-request store. The dashboard POSTs a run REQUEST here; the actual
// benchmark EXECUTION is host-side (orchestration/experiment.py), which writes the
// results manifest + checkpoints under RESULTS_DIR/<runId>/. This store just
// records requests and reads back manifests/checkpoints so the UI can poll.
// (Decoupling is intentional — the gateway cannot run Caliper.)

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function makeRunsStore(resultsDir) {
  const requestsDir = path.join(resultsDir, 'requests');
  fs.mkdirSync(requestsDir, { recursive: true });

  async function create(request) {
    const runId = `req-${crypto.randomUUID()}`;
    const record = { runId, status: 'requested', requestedAt: new Date().toISOString(), request };
    await fsp.writeFile(path.join(requestsDir, `${runId}.json`), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async function readJson(file) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
  }

  async function readCheckpoints(runDir) {
    try {
      const raw = await fsp.readFile(path.join(runDir, 'checkpoints.jsonl'), 'utf8');
      return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function get(runId) {
    // A completed run: RESULTS_DIR/<runId>/manifest.json (+ checkpoints.jsonl).
    const runDir = path.join(resultsDir, runId);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    if (manifest) {
      return { runId, status: 'complete', manifest, checkpoints: await readCheckpoints(runDir) };
    }
    // Otherwise it may still be just a request.
    const req = await readJson(path.join(requestsDir, `${runId}.json`));
    return req; // null if unknown
  }

  async function list() {
    const out = [];
    // requested runs
    try {
      for (const f of await fsp.readdir(requestsDir)) {
        if (f.endsWith('.json')) {
          const r = await readJson(path.join(requestsDir, f));
          if (r) out.push({ runId: r.runId, status: r.status, requestedAt: r.requestedAt, variant: r.request && r.request.variant });
        }
      }
    } catch { /* none */ }
    // completed runs (subdirs with a manifest)
    try {
      for (const entry of await fsp.readdir(resultsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'requests') {
          const m = await readJson(path.join(resultsDir, entry.name, 'manifest.json'));
          if (m) out.push({ runId: m.runId || entry.name, status: 'complete', variant: m.variant, regime: m.regime, startedAt: m.startedAt });
        }
      }
    } catch { /* none */ }
    return out;
  }

  return { create, get, list };
}

module.exports = { makeRunsStore };
