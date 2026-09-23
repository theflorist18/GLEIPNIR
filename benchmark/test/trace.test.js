'use strict';

// trace/generate.js — the determinism contract (brief §3): same params →
// byte-identical file; different seed → different sequence; lifecycle order
// per evidence; exact per-worker lengths and op counts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateTrace, writeTrace } = require('../trace/generate');
const { filler } = require('../workload/lib/payloads');

const P = {
  seed: 7, cases: 4, channels: 2, evidencePerCase: 3, eventsPerCasePerRound: 10, rounds: 3, workers: 4,
  mix: { transfer_weight: 0.15, access_weight: 0.85, dispose_fraction: 0.5 }, payloadBytes: 32,
};
const S = (P.cases * P.eventsPerCasePerRound) / P.workers; // 10
const L = P.rounds * S; // 30

test('same params -> identical object and byte-identical file; hash returned', () => {
  const a = generateTrace(P);
  const b = generateTrace({ ...P, mix: { ...P.mix } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gleipnir-trace-'));
  const f1 = path.join(dir, 'one.json');
  const f2 = path.join(dir, 'two.json');
  const h1 = writeTrace(P, f1);
  const h2 = writeTrace(P, f2);
  assert.equal(h1, a.hash);
  assert.equal(h2, a.hash);
  assert.equal(fs.readFileSync(f1).equals(fs.readFileSync(f2)), true);
  assert.equal(JSON.parse(fs.readFileSync(f1, 'utf8')).hash, a.hash);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('different seed -> different hash and different sequence', () => {
  const a = generateTrace(P);
  const b = generateTrace({ ...P, seed: 8 });
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(JSON.stringify(a.workers), JSON.stringify(b.workers));
});

test('ordering invariant: CREATE first, DISPOSE last, evidence owned by e mod workers, caseId routing', () => {
  const t = generateTrace(P);
  t.workers.forEach((seq, w) => {
    const seen = new Map(); // evidenceId -> ops
    for (const it of seq) {
      assert.match(it.evidenceId, /^ev-c\d{3}-e\d{3}$/);
      const c = Number(it.evidenceId.slice(4, 7));
      const j = Number(it.evidenceId.slice(9, 12));
      assert.equal(it.dataCase, c);
      assert.equal(it.caseId, `case-${String(((c - 1) % P.channels) + 1).padStart(3, '0')}`);
      const e = (c - 1) * P.evidencePerCase + (j - 1);
      assert.equal(e % P.workers, w, `evidence ${it.evidenceId} must be owned by worker ${e % P.workers}`);
      if (!seen.has(it.evidenceId)) seen.set(it.evidenceId, []);
      seen.get(it.evidenceId).push(it.op);
    }
    for (const [id, ops] of seen) {
      assert.equal(ops[0], 'CREATE', `${id}: first op must be CREATE`);
      assert.equal(ops.filter((o) => o === 'CREATE').length, 1, `${id}: exactly one CREATE`);
      const d = ops.indexOf('DISPOSE');
      if (d >= 0) assert.equal(d, ops.length - 1, `${id}: DISPOSE must be last`);
      for (const o of ops.slice(1, d >= 0 ? d : ops.length)) assert.ok(o === 'TRANSFER' || o === 'ACCESS', `${id}: ${o}`);
    }
  });
});

test('counts: exact per-worker length, slice size, CREATE/DISPOSE totals, perRound sums', () => {
  const t = generateTrace(P);
  assert.equal(t.sliceSize, S);
  assert.equal(t.workers.length, P.workers);
  for (const seq of t.workers) assert.equal(seq.length, L);
  const total = t.opCounts.total;
  assert.equal(total.CREATE, P.cases * P.evidencePerCase);
  // each worker owns 3 evidence items -> round(0.5 * 3) = 2 disposed
  assert.equal(total.DISPOSE, P.workers * Math.round(P.mix.dispose_fraction * 3));
  assert.equal(total.CREATE + total.TRANSFER + total.ACCESS + total.DISPOSE, P.workers * L);
  assert.equal(t.opCounts.perRound.length, P.rounds);
  for (const op of Object.keys(total)) {
    assert.equal(t.opCounts.perRound.reduce((a, r) => a + r[op], 0), total[op]);
  }
  // perRound[k] really is the count over slice k of every worker
  t.opCounts.perRound.forEach((r, k) => {
    const n = t.workers.reduce((a, seq) => a + seq.slice(k * S, (k + 1) * S).length, 0);
    assert.equal(r.CREATE + r.TRANSFER + r.ACCESS + r.DISPOSE, n);
  });
});

test('CREATE payload is the deterministic filler of payloadBytes chars; detail shapes per op', () => {
  const t = generateTrace(P);
  for (const seq of t.workers) {
    for (const it of seq) {
      if (it.op === 'CREATE') {
        assert.equal(it.detail.payload.length, P.payloadBytes);
        assert.equal(it.detail.payload, filler(it.evidenceId, P.payloadBytes));
      } else if (it.op === 'TRANSFER') {
        assert.ok(it.detail.newCustodian && it.detail.reason);
      } else if (it.op === 'ACCESS') {
        assert.ok(it.detail.action);
      } else {
        assert.ok(it.detail.reason);
      }
      assert.match(it.actor, /^custodian-\d{2}-\d{2}/);
    }
  }
});

test('non-integer per-worker share throws; too few events per round throws', () => {
  assert.throws(() => generateTrace({ ...P, workers: 7 }), /not an integer/);
  assert.throws(() => generateTrace({ ...P, eventsPerCasePerRound: 1, rounds: 1 }), /needs/);
});
