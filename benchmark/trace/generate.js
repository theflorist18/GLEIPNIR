'use strict';

// Seeded transaction-trace generator — the determinism contract (brief §3).
//
// A trace is a PURE function of (seed, cases, channels, evidencePerCase,
// eventsPerCasePerRound, rounds, workers, mix, payloadBytes): same params →
// byte-identical file; different seed → different file. The four variants
// replay the SAME trace (workload/trace.js); only the write path differs.
//
// Rules: (a) evidence e (global index) is owned by worker e mod workers and ALL
// its ops sit in that worker's sequence in lifecycle order
// CREATE → (TRANSFER|ACCESS)* → [DISPOSE]; (b) each worker's sequence is a
// seeded interleave of its evidence lifecycles; (c) each sequence has exactly
// rounds × S items, S = cases × eventsPerCasePerRound / workers (integer);
// round k replays items [k·S, (k+1)·S); (d) per-evidence further-op counts are
// drawn so totals hit the length exactly.
//
// CLI: node trace/generate.js --cases 25 --channels 25 [--evidence-per-case 20
//   --events-per-case-per-round 200 --rounds 5 --workers 4 --seed 20260922
//   --payload-bytes 256 --transfer-weight .15 --access-weight .85
//   --dispose-fraction .5] [--out <path>] [--dry]
// Defaults come from sweeps.yaml. Prints the hash (or, with --dry, opCounts).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalJSON } = require('../audit/merkle');
const { filler } = require('../workload/lib/payloads');

// mulberry32 — 32-bit seeded PRNG, uniform in [0, 1).
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');
const ACTIONS = ['view', 'download', 'export', 'annotate'];
const DEFAULT_MIX = { transfer_weight: 0.15, access_weight: 0.85, dispose_fraction: 0.5 };

function intParam(v, name, min) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`trace: ${name} must be an integer >= ${min} (got ${v})`);
  return n;
}

function numParam(v, name, dflt) {
  const n = v === undefined || v === null ? dflt : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`trace: ${name} must be a non-negative number (got ${v})`);
  return n;
}

// Fixed key order → stable canonical params → stable hash.
function normalize(p) {
  const mix = p.mix || {};
  return {
    seed: intParam(p.seed, 'seed', 0),
    cases: intParam(p.cases, 'cases', 1),
    channels: intParam(p.channels, 'channels', 1),
    evidencePerCase: intParam(p.evidencePerCase, 'evidencePerCase', 1),
    eventsPerCasePerRound: intParam(p.eventsPerCasePerRound, 'eventsPerCasePerRound', 1),
    rounds: intParam(p.rounds, 'rounds', 1),
    workers: intParam(p.workers, 'workers', 1),
    mix: {
      transfer_weight: numParam(mix.transfer_weight, 'mix.transfer_weight', DEFAULT_MIX.transfer_weight),
      access_weight: numParam(mix.access_weight, 'mix.access_weight', DEFAULT_MIX.access_weight),
      dispose_fraction: numParam(mix.dispose_fraction, 'mix.dispose_fraction', DEFAULT_MIX.dispose_fraction),
    },
    payloadBytes: intParam(p.payloadBytes === undefined ? 0 : p.payloadBytes, 'payloadBytes', 0),
  };
}

function generateTrace(input) {
  const P = normalize(input);
  const hash = crypto.createHash('sha256').update(canonicalJSON(P), 'utf8').digest('hex');
  const perRoundTotal = P.cases * P.eventsPerCasePerRound;
  const S = perRoundTotal / P.workers;
  if (!Number.isInteger(S)) {
    throw new Error(`trace: cases*eventsPerCasePerRound/workers = ${perRoundTotal}/${P.workers} is not an integer`);
  }
  const L = P.rounds * S;
  const tw = P.mix.transfer_weight + P.mix.access_weight;
  const pTransfer = tw > 0 ? P.mix.transfer_weight / tw : 0;
  const rand = mulberry32(P.seed);

  // Evidence universe: e = (case-1)*evidencePerCase + (j-1), owner = e mod workers.
  const evidence = [];
  for (let c = 1; c <= P.cases; c += 1) {
    for (let j = 1; j <= P.evidencePerCase; j += 1) {
      evidence.push({
        evidenceId: `ev-c${pad3(c)}-e${pad3(j)}`,
        dataCase: c,
        caseId: `case-${pad3(((c - 1) % P.channels) + 1)}`,
        custodian: `custodian-${pad2(c)}-${pad2(j)}`,
        worker: (evidence.length) % P.workers,
      });
    }
  }

  const workers = [];
  for (let w = 0; w < P.workers; w += 1) {
    const owned = evidence.filter((e) => e.worker === w);
    if (owned.length === 0) throw new Error(`trace: worker ${w} owns no evidence (workers > cases*evidencePerCase)`);

    // Which evidence gets disposed: seeded shuffle, first round(fraction*n).
    const nDispose = Math.round(P.mix.dispose_fraction * owned.length);
    const order = owned.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const k = Math.floor(rand() * (i + 1));
      [order[i], order[k]] = [order[k], order[i]];
    }
    const disposed = new Set(order.slice(0, nDispose));

    // Further ops (TRANSFER|ACCESS) distributed so the sequence length is exact.
    const fixed = owned.length + nDispose;
    if (L < fixed) {
      throw new Error(`trace: worker ${w} needs ${fixed} items (CREATE+DISPOSE) but rounds*S = ${L}; raise eventsPerCasePerRound or rounds`);
    }
    const extra = new Array(owned.length).fill(0);
    for (let r = 0; r < L - fixed; r += 1) extra[Math.floor(rand() * owned.length)] += 1;

    const queues = owned.map((_, i) => {
      const q = ['CREATE'];
      for (let k = 0; k < extra[i]; k += 1) q.push(rand() < pTransfer ? 'TRANSFER' : 'ACCESS');
      if (disposed.has(i)) q.push('DISPOSE');
      return q;
    });

    // Seeded interleave of lifecycles.
    const pos = new Array(owned.length).fill(0);
    const custodian = owned.map((e) => e.custodian);
    const transfers = new Array(owned.length).fill(0);
    const active = owned.map((_, i) => i);
    const seq = [];
    while (active.length > 0) {
      const k = Math.floor(rand() * active.length);
      const i = active[k];
      const e = owned[i];
      const op = queues[i][pos[i]];
      pos[i] += 1;
      let detail;
      let actor = custodian[i];
      if (op === 'CREATE') {
        detail = { payload: filler(e.evidenceId, P.payloadBytes) };
      } else if (op === 'TRANSFER') {
        transfers[i] += 1;
        const newCustodian = `${e.custodian}-t${transfers[i]}`;
        detail = { newCustodian, reason: `transfer-${transfers[i]}` };
        custodian[i] = newCustodian;
      } else if (op === 'ACCESS') {
        detail = { action: ACTIONS[Math.floor(rand() * ACTIONS.length)] };
      } else {
        detail = { reason: 'disposition' };
      }
      seq.push({ op, dataCase: e.dataCase, caseId: e.caseId, evidenceId: e.evidenceId, actor, detail });
      if (pos[i] === queues[i].length) {
        active[k] = active[active.length - 1];
        active.pop();
      }
    }
    if (seq.length !== L) throw new Error(`trace: internal length mismatch ${seq.length} != ${L}`);
    workers.push(seq);
  }

  const zero = () => ({ CREATE: 0, TRANSFER: 0, ACCESS: 0, DISPOSE: 0 });
  const total = zero();
  const perRound = [];
  for (let k = 0; k < P.rounds; k += 1) {
    const c = zero();
    for (const seq of workers) {
      for (let i = k * S; i < (k + 1) * S; i += 1) c[seq[i].op] += 1;
    }
    for (const op of Object.keys(c)) total[op] += c[op];
    perRound.push(c);
  }

  return { version: 1, hash, params: P, sliceSize: S, opCounts: { total, perRound }, workers };
}

function defaultTracePath(hash) {
  return path.join(__dirname, '..', 'traces', `${hash}.json`);
}

// Writes the trace (default: benchmark/traces/<hash>.json) and returns its hash.
function writeTrace(params, outPath) {
  const t = generateTrace(params);
  const file = outPath || defaultTracePath(t.hash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(t));
  return t.hash;
}

// ---- CLI ----

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`trace: unexpected argument ${a}`);
    const key = a.slice(2);
    if (key === 'dry') { out.dry = true; continue; }
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

function sweepsDefaults() {
  let yaml;
  try { yaml = require('js-yaml'); } catch (_e) { return {}; }
  try {
    return yaml.load(fs.readFileSync(path.join(__dirname, '..', 'sweeps.yaml'), 'utf8')) || {};
  } catch (_e) {
    return {};
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const sw = sweepsDefaults();
  const wl = sw.workload || {};
  const pick = (flag, dflt) => (a[flag] !== undefined ? a[flag] : dflt);
  const channels = pick('channels', 1);
  const params = {
    seed: pick('seed', sw.seed),
    cases: pick('cases', channels),   // one channel per case on the parallel variants (sweeps.yaml has no separate cases)
    channels,
    evidencePerCase: pick('evidence-per-case', wl.evidence_per_case),
    eventsPerCasePerRound: pick('events-per-case-per-round', wl.events_per_case_per_round),
    rounds: pick('rounds', wl.rounds),
    workers: pick('workers', sw.workers),
    mix: {
      transfer_weight: pick('transfer-weight', (wl.mix || {}).transfer_weight),
      access_weight: pick('access-weight', (wl.mix || {}).access_weight),
      dispose_fraction: pick('dispose-fraction', (wl.mix || {}).dispose_fraction),
    },
    payloadBytes: pick('payload-bytes', wl.payload_bytes),
  };
  if (a.dry) {
    const t = generateTrace(params);
    // Every trace item is a ledger write on its case channel: the least-loaded channel is what
    // the steady floor (>= 10^3 per channel) is judged on — the generator fixes totals per worker.
    const perChannel = {};
    for (const seq of t.workers) for (const it of seq) perChannel[it.caseId] = (perChannel[it.caseId] || 0) + 1;
    const minChannelWriteEvents = Math.min(...Object.values(perChannel));
    process.stdout.write(`${JSON.stringify({ hash: t.hash, sliceSize: t.sliceSize, opCounts: t.opCounts,
      minChannelWriteEvents }, null, 2)}\n`);
    return;
  }
  const hash = writeTrace(params, a.out);
  process.stderr.write(`trace written: ${a.out || defaultTracePath(hash)}\n`);
  process.stdout.write(`${hash}\n`);
}

if (require.main === module) {
  try { main(); } catch (err) { process.stderr.write(`${err.message}\n`); process.exit(1); }
}

module.exports = { generateTrace, writeTrace, mulberry32, defaultTracePath };
