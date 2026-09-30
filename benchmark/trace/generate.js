'use strict';

// Seeded transaction-trace generator — the determinism contract (brief §3).
//
// A trace is a PURE function of (seed, cases, channels, evidencePerCase,
// eventsPerCasePerRound, rounds, workers, mix, payloadBytes, headGap): same params →
// byte-identical file; different seed → different file. The four variants
// replay the SAME trace (workload/trace.js); only the write path differs.
//
// Rules: (a) evidence e (global index) is owned by worker e mod workers and ALL
// its ops sit in that worker's sequence in lifecycle order
// CREATE → (TRANSFER|ACCESS)* → [DISPOSE]; (b) each worker's sequence is a
// seeded interleave of its evidence lifecycles, weighted by remaining ops so
// lifecycles progress evenly (no dense single-evidence tail); (c) each sequence has exactly
// rounds × S items, S = cases × eventsPerCasePerRound / workers (integer);
// round k replays items [k·S, (k+1)·S); (d) per-evidence further-op counts are
// drawn so totals hit the length exactly; (e) within a round, a head read
// (TRANSFER/DISPOSE) sits >= headGap items after the same evidence's previous
// head write (CREATE/TRANSFER): Caliper does not await submissions, so a closer
// pair can be endorsed before its predecessor commits (MVCC / "not found" on the
// direct-write variants — a harness artefact, not a property of the design).
// headGap = HEAD_GAP, or S/8 for a round shorter than that (the E0 smoke trace).
//
// CLI: node trace/generate.js --channels 25 [--cases 25] --evidence-per-case 20
//   --events-per-case-per-round 224 --rounds 5 --workers 4 --seed 20260922
//   --payload-bytes 256 --transfer-weight .15 --access-weight .85
//   --dispose-fraction .5 [--out <path>] [--dry]
// Every param flag is required (--cases defaults to --channels); a missing one
// throws. experiment.py passes them all from sweeps.yaml. Prints the hash (or,
// with --dry, opCounts).

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
// Rule (e): 110 items = 2.2 s at 200 tx/s / 4 workers (the top of sweeps.yaml send_rates_tps and
// workers — raise it if either grows), longer than the slowest commit below saturation (a timer-cut
// block: BatchTimeout 2 s, configtx.yaml). Recorded in params, so it is part of the trace hash.
const HEAD_GAP = 110;
const HEAD_READ = new Set(['TRANSFER', 'DISPOSE']);

function intParam(v, name, min) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`trace: ${name} must be an integer >= ${min} (got ${v})`);
  return n;
}

function numParam(v, name) {
  const n = Number(v);
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
      transfer_weight: numParam(mix.transfer_weight, 'mix.transfer_weight'),
      access_weight: numParam(mix.access_weight, 'mix.access_weight'),
      dispose_fraction: numParam(mix.dispose_fraction, 'mix.dispose_fraction'),
    },
    payloadBytes: intParam(p.payloadBytes, 'payloadBytes', 0),
    headGap: HEAD_GAP,
  };
}

function generateTrace(input) {
  const P = normalize(input);
  const perRoundTotal = P.cases * P.eventsPerCasePerRound;
  const S = perRoundTotal / P.workers;
  if (!Number.isInteger(S)) {
    throw new Error(`trace: cases*eventsPerCasePerRound/workers = ${perRoundTotal}/${P.workers} is not an integer`);
  }
  // A round shorter than the gap (the E0 smoke trace: S = 60) cannot keep it; S/8 stays feasible there
  // (smoke: 7 items = 5.6 s at 5 tx/s). Campaign rounds (S >= 280) keep HEAD_GAP.
  if (S < P.headGap) P.headGap = Math.max(1, Math.floor(S / 8));
  // The hash covers params only: an algorithm change that leaves params identical must add or bump a
  // param, or experiment.py's ensure_trace keeps reusing the stale cached benchmark/traces/<hash>.json.
  const hash = crypto.createHash('sha256').update(canonicalJSON(P), 'utf8').digest('hex');
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

    // Seeded interleave of lifecycles (rules b + e): pick among the lifecycles that are not
    // cooling down, weighted by remaining ops; if all are cooling down, the one whose last head
    // write is oldest goes (the least-close pair).
    const pos = new Array(owned.length).fill(0);
    const lastHead = new Array(owned.length).fill(-Infinity); // seq index of the last CREATE/TRANSFER
    const custodian = owned.map((e) => e.custodian);
    const transfers = new Array(owned.length).fill(0);
    const active = owned.map((_, i) => i);
    const seq = [];
    while (active.length > 0) {
      const n = seq.length;
      const sliceStart = n - (n % S); // rounds run one after another: a pair only races inside one
      const cooling = (i) => HEAD_READ.has(queues[i][pos[i]]) && lastHead[i] >= sliceStart
        && n - lastHead[i] < P.headGap;
      let total = 0;
      for (const i of active) if (!cooling(i)) total += queues[i].length - pos[i];
      let k;
      if (total > 0) {
        let u = rand() * total;
        k = active.findIndex((i) => !cooling(i) && (u -= queues[i].length - pos[i]) < 0);
      } else {
        k = 0;
        for (let a = 1; a < active.length; a += 1) if (lastHead[active[a]] < lastHead[active[k]]) k = a;
      }
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
      if (op === 'CREATE' || op === 'TRANSFER') lastHead[i] = n;
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

const FLAGS = ['seed', 'cases', 'channels', 'evidence-per-case', 'events-per-case-per-round', 'rounds', 'workers',
  'payload-bytes', 'transfer-weight', 'access-weight', 'dispose-fraction', 'out'];

function main() {
  const { values: a } = require('node:util').parseArgs({
    options: { ...Object.fromEntries(FLAGS.map((f) => [f, { type: 'string' }])), dry: { type: 'boolean' } },
  });
  const params = {
    seed: a.seed,
    cases: a.cases ?? a.channels,   // one channel per case on the parallel variants (sweeps.yaml has no separate cases)
    channels: a.channels,
    evidencePerCase: a['evidence-per-case'],
    eventsPerCasePerRound: a['events-per-case-per-round'],
    rounds: a.rounds,
    workers: a.workers,
    mix: {
      transfer_weight: a['transfer-weight'],
      access_weight: a['access-weight'],
      dispose_fraction: a['dispose-fraction'],
    },
    payloadBytes: a['payload-bytes'],
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

module.exports = { generateTrace, writeTrace, HEAD_GAP };
