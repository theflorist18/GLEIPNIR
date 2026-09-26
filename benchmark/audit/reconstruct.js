'use strict';

// Audit reconstruction harness (brief §5) — AUDIT RECONSTRUCTION TIME, a
// first-class metric: reconstruct and verify the full chain of custody of a
// case, host-side, through the gateway only (never Fabric directly).
//
//   node audit/reconstruct.js --variant V --trace <file> [--cases 5]
//        [--gateway http://localhost:3000] [--out audit.json]       (token: GLEIPNIR_TOKEN)
//
// Picks the first `cases` data-cases of the trace (deterministic) and times
// each case with process.hrtime.bigint():
//   Standard / Parallel: GET /api/v1/evidence/:id/audit[?caseId=case-NNN] per
//     evidence -> assemble the trail; verified = on-chain (no Merkle step).
//   Anchoring / Parallel-Anchored: GET .../audit?proofs=1[&caseId=] -> events
//     with `proof`; per event recompute leafHash(canonical(event)), fold the
//     sibling path (audit/merkle.js — byte-identical to the services' copy),
//     read the root once per (scopeId, batchId) via
//     GET /api/v1/anchor-roots/:scopeId/:batchId (cached), compare.
// Output: { variant, method, traceHash, cases:[{caseId, dataCase, evidence,
//   events, ms, verifiedEvents, failedEvents, rootReads}],
//   summary:{msPerCase:{mean,sd,min,max}, msPerEvent, okRate} }.
// ponytail: evidence items are fetched sequentially — that IS the definition
// of "time to reconstruct one case"; parallelise only if the metric is redefined.

const fs = require('node:fs');
const { leafHash, computeRoot } = require('./merkle');

const BATCHED = new Set(['anchoring', 'parallel-anchored']);
const PARALLEL = new Set(['parallel', 'parallel-anchored']);
const enc = encodeURIComponent;

// First `cases` data-cases with their evidence ids (sorted) and channel key.
function selectCases(trace, cases) {
  const byCase = new Map();
  for (const seq of trace.workers) {
    for (const it of seq) {
      if (it.op !== 'CREATE' || it.dataCase > cases) continue;
      if (!byCase.has(it.dataCase)) byCase.set(it.dataCase, { dataCase: it.dataCase, caseId: it.caseId, evidence: [] });
      byCase.get(it.dataCase).evidence.push(it.evidenceId);
    }
  }
  return [...byCase.values()]
    .sort((a, b) => a.dataCase - b.dataCase)
    .map((c) => ({ ...c, evidence: c.evidence.sort() }));
}

function stats(xs) {
  const n = xs.length;
  if (n === 0) return { mean: null, sd: null, min: null, max: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

async function reconstruct(opts) {
  const variant = opts.variant;
  if (!variant) throw new Error('reconstruct: variant is required');
  const trace = typeof opts.trace === 'string' ? JSON.parse(fs.readFileSync(opts.trace, 'utf8')) : opts.trace;
  const cases = opts.cases === undefined ? 5 : Number(opts.cases);
  const gateway = (opts.gateway || 'http://localhost:3000').replace(/\/$/, '');
  const token = opts.token || process.env.GLEIPNIR_TOKEN || 'dev-token';
  const headers = { authorization: `Bearer ${token}` };
  const batched = BATCHED.has(variant);
  const parallel = PARALLEL.has(variant);
  const rootCache = new Map(); // "scopeId/batchId" -> merkleRoot | null

  async function getJson(url) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}`);
    return r.json();
  }

  async function anchoredRoot(scopeId, batchId, stat) {
    const key = `${scopeId}/${batchId}`;
    if (!rootCache.has(key)) {
      stat.rootReads += 1;
      const r = await fetch(`${gateway}/api/v1/anchor-roots/${enc(scopeId)}/${enc(batchId)}`, { headers });
      rootCache.set(key, r.ok ? ((await r.json()).merkleRoot || null) : null);
    }
    return rootCache.get(key);
  }

  const out = [];
  for (const c of selectCases(trace, cases)) {
    const stat = { caseId: c.caseId, dataCase: c.dataCase, evidence: c.evidence.length, events: 0, ms: 0, verifiedEvents: 0, failedEvents: 0, rootReads: 0 };
    const t0 = process.hrtime.bigint();
    for (const id of c.evidence) {
      const q = [];
      if (batched) q.push('proofs=1');
      if (parallel) q.push(`caseId=${enc(c.caseId)}`);
      const url = `${gateway}/api/v1/evidence/${enc(id)}/audit${q.length ? `?${q.join('&')}` : ''}`;
      const events = await getJson(url);
      if (!Array.isArray(events)) throw new Error(`${url}: expected a JSON array of events`);
      stat.events += events.length;
      if (!batched) {
        stat.verifiedEvents += events.length; // on-chain records: the ledger is the proof
        continue;
      }
      for (const ev of events) {
        const { proof, ...event } = ev;
        let ok = false;
        if (proof && Array.isArray(proof.siblingPath)) {
          const ref = proof.rootRef || {};
          const scopeId = ref.scopeId || (parallel ? c.caseId : 'shared');
          const batchId = ref.batchId || proof.batchId;
          const expected = await anchoredRoot(scopeId, batchId, stat);
          ok = expected !== null && computeRoot(leafHash(event), proof.siblingPath) === expected;
        }
        if (ok) stat.verifiedEvents += 1; else stat.failedEvents += 1;
      }
    }
    stat.ms = Number(process.hrtime.bigint() - t0) / 1e6;
    out.push(stat);
  }

  const totalEvents = out.reduce((a, s) => a + s.events, 0);
  const verified = out.reduce((a, s) => a + s.verifiedEvents, 0);
  const totalMs = out.reduce((a, s) => a + s.ms, 0);
  return {
    variant,
    method: batched ? 'merkle-branch' : 'on-chain-trail',
    traceHash: trace.hash || null,
    cases: out,
    summary: {
      msPerCase: stats(out.map((s) => s.ms)),
      msPerEvent: totalEvents ? totalMs / totalEvents : null,
      okRate: totalEvents ? verified / totalEvents : null,
    },
  };
}

// ---- CLI ----

async function main() {
  const { values: a } = require('node:util').parseArgs({
    options: Object.fromEntries(['variant', 'trace', 'cases', 'gateway', 'out', 'token'].map((f) => [f, { type: 'string' }])),
  });
  if (!a.variant || !a.trace) throw new Error('usage: reconstruct.js --variant V --trace <file> [--cases N] [--gateway URL] [--out FILE]');
  const result = await reconstruct(a);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (a.out) fs.writeFileSync(a.out, json); else process.stdout.write(json);
  const s = result.summary;
  process.stderr.write(`audit ${result.variant}: ${result.cases.length} cases, msPerCase mean ${s.msPerCase.mean === null ? 'n/a' : s.msPerCase.mean.toFixed(1)}, okRate ${s.okRate}\n`);
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });
}

module.exports = { reconstruct };
