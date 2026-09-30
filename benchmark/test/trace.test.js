'use strict';

// trace/generate.js — the determinism contract (brief §3): same params →
// byte-identical file; different seed → different sequence; lifecycle order
// per evidence; exact per-worker lengths and op counts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateTrace, writeTrace, HEAD_GAP } = require('../trace/generate');
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

test('rule (e): a head read sits >= HEAD_GAP after its evidence\'s head write within a round (sequence tail excepted); gap is in params', () => {
  // campaign-like shape: 100 evidence per worker, S = 1120, two rounds
  const Q = { ...P, cases: 20, channels: 20, evidencePerCase: 20, eventsPerCasePerRound: 224, rounds: 2 };
  const t = generateTrace(Q);
  assert.equal(t.params.headGap, HEAD_GAP);
  const S = t.sliceSize;
  const L = S * Q.rounds;
  let pairs = 0;
  for (const seq of t.workers) {
    const last = new Map(); // evidenceId -> index of its last CREATE/TRANSFER in this round
    seq.forEach((it, i) => {
      if (i % S === 0) last.clear(); // rounds run one after another
      if ((it.op === 'TRANSFER' || it.op === 'DISPOSE') && last.has(it.evidenceId)) {
        pairs += 1;
        // the last HEAD_GAP items may be forced (every remaining lifecycle cooling down)
        if (i < L - HEAD_GAP) assert.ok(i - last.get(it.evidenceId) >= HEAD_GAP, `${it.evidenceId} ${it.op} at ${i}`);
      }
      if (it.op === 'CREATE' || it.op === 'TRANSFER') last.set(it.evidenceId, i);
    });
  }
  assert.ok(pairs > 100); // the check really ran
});

test('rule (e) on a round shorter than HEAD_GAP (E0 smoke shape, S = 60): headGap = S/8 and it holds everywhere', () => {
  const t = generateTrace({ ...P, cases: 10, channels: 10, evidencePerCase: 2, eventsPerCasePerRound: 24, rounds: 1 });
  assert.equal(t.sliceSize, 60);
  assert.equal(t.params.headGap, 7);
  for (const seq of t.workers) {
    const last = new Map();
    seq.forEach((it, i) => {
      if ((it.op === 'TRANSFER' || it.op === 'DISPOSE') && last.has(it.evidenceId)) {
        assert.ok(i - last.get(it.evidenceId) >= t.params.headGap, `${it.evidenceId} ${it.op} at ${i}`);
      }
      if (it.op === 'CREATE' || it.op === 'TRANSFER') last.set(it.evidenceId, i);
    });
  }
});

test('non-integer per-worker share throws; too few events per round throws', () => {
  assert.throws(() => generateTrace({ ...P, workers: 7 }), /not an integer/);
  assert.throws(() => generateTrace({ ...P, eventsPerCasePerRound: 1, rounds: 1 }), /needs/);
});
