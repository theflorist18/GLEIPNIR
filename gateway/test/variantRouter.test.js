'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routeWrite, routeRead, channelFor, RequestError, foldHead } = require('../src/variantRouter');

// Off-chain trail fixture (M26): three receipts for ev-1 in enqueue order, each
// carrying the CoC event it witnesses; plus one pre-M26 receipt without an
// event copy, which must contribute no trail entry.
const receiptFor = (i, event) => ({
  eventId: event.eventId, evidenceId: 'ev-1', event,
  leafHash: `leaf-${i}`, siblingPath: [{ pos: 'right', hash: `sib-${i}` }],
  batchId: 'shared-e1-b000000', leafIndex: i,
  rootRef: { scopeId: 'shared', batchId: 'shared-e1-b000000', txId: 'tx-root' },
});
const TRAIL = [
  receiptFor(0, { eventId: 'evt-1', evidenceId: 'ev-1', caseId: 'shared', op: 'CREATE', actor: 'alice', detail: { storage: { protocol: 'file', location: 'blob://x', integrity_proof: 'ni:///sha-256;abc' } }, ts: 't1' }),
  receiptFor(1, { eventId: 'evt-2', evidenceId: 'ev-1', caseId: 'shared', op: 'TRANSFER', actor: 'bob', detail: { newCustodian: 'bob', reason: 'lab' }, ts: 't2' }),
  receiptFor(2, { eventId: 'evt-3', evidenceId: 'ev-1', caseId: 'shared', op: 'ACCESS', actor: 'bob', detail: { action: 'view' }, ts: 't3' }),
  { eventId: 'evt-legacy', leafHash: 'leaf-x', siblingPath: [], batchId: 'shared-e0-b000000', leafIndex: 0, rootRef: {} },
];

function fakes() {
  const submits = [];
  const enqueues = [];
  const evaluates = [];
  const listed = [];
  return {
    submits,
    enqueues,
    evaluates,
    listed,
    deps: {
      defaultChannel: 'coc-main',
      fabric: {
        async submit(channel, fn, args) { submits.push({ channel, fn, args }); return 'tx-123'; },
        async evaluate(channel, fn, args) { evaluates.push({ channel, fn, args }); return JSON.stringify({ channel, fn, args }); },
      },
      batcher: {
        async enqueue(event) { enqueues.push(event); return { batchId: 'shared-b000000', leafIndex: 0 }; },
      },
      receipts: {
        async listByEvidence(evidenceId) { listed.push(evidenceId); return evidenceId === 'ev-1' ? TRAIL : []; },
      },
    },
  };
}

const evt = (caseId) => ({ eventId: 'evt-1', evidenceId: 'ev-1', caseId: caseId || 'shared', op: 'CREATE' });

test('standard: submit on coc-main, 201', async () => {
  const f = fakes();
  const r = await routeWrite({ variant: 'standard', fn: 'CreateEvidence', ccArgs: ['ev-1', '{}'], event: evt() }, f.deps);
  assert.equal(r.status, 201);
  assert.equal(r.body.txId, 'tx-123');
  assert.equal(f.submits[0].channel, 'coc-main');
  assert.equal(f.enqueues.length, 0);
});

test('anchoring: enqueue to batcher, 202', async () => {
  const f = fakes();
  const r = await routeWrite({ variant: 'anchoring', fn: 'CreateEvidence', ccArgs: ['ev-1', '{}'], event: evt() }, f.deps);
  assert.equal(r.status, 202);
  assert.equal(r.body.batched, true);
  assert.equal(f.enqueues.length, 1);
  assert.equal(f.submits.length, 0);
});

test('parallel: submit on the case channel, 201', async () => {
  const f = fakes();
  const r = await routeWrite({ variant: 'parallel', fn: 'CreateEvidence', ccArgs: ['ev-1', '{}'], event: evt('case-002'), caseId: 'case-002' }, f.deps);
  assert.equal(r.status, 201);
  assert.equal(f.submits[0].channel, 'case-002');
});

test('parallel-anchored: enqueue to batcher (per-case), 202', async () => {
  const f = fakes();
  const r = await routeWrite({ variant: 'parallel-anchored', fn: 'CreateEvidence', ccArgs: ['ev-1', '{}'], event: evt('case-003'), caseId: 'case-003' }, f.deps);
  assert.equal(r.status, 202);
  assert.equal(r.body.evidenceId, 'ev-1'); // batched response carries evidenceId too (F68)
  assert.equal(f.enqueues[0].caseId, 'case-003');
  assert.equal(f.submits.length, 0);
});

// F57: the batched path must be as strict as the direct path — a missing or
// invalid caseId in a per-case variant is a 400, never a silent pool into the
// "shared" scope.
test('parallel-anchored: missing/invalid caseId rejected 400 BEFORE enqueue', async () => {
  const f = fakes();
  for (const caseId of [undefined, 'x']) {
    await assert.rejects(
      routeWrite({ variant: 'parallel-anchored', fn: 'AccessLog', ccArgs: ['ev-1', 'a', 'read'], event: evt(caseId), caseId }, f.deps),
      (err) => err instanceof RequestError && err.status === 400,
    );
  }
  assert.equal(f.enqueues.length, 0, 'nothing may reach the batcher');
});

test('parallel without a valid caseId is a 400 RequestError', async () => {
  const f = fakes();
  await assert.rejects(
    routeWrite({ variant: 'parallel', fn: 'CreateEvidence', ccArgs: ['ev-1', '{}'], event: evt(), caseId: 'nope' }, f.deps),
    (err) => err instanceof RequestError && err.status === 400,
  );
});

test('channelFor: parallel requires case-NNN; others use default', () => {
  assert.equal(channelFor('standard', undefined, 'coc-main'), 'coc-main');
  assert.equal(channelFor('anchoring', undefined, 'coc-main'), 'coc-main');
  assert.equal(channelFor('parallel', 'case-005', 'coc-main'), 'case-005');
  assert.throws(() => channelFor('parallel-anchored', 'x', 'coc-main'), RequestError);
});

test('routeRead evaluates on the resolved channel', async () => {
  const f = fakes();
  const out = await routeRead({ variant: 'parallel', fn: 'ReadEvidence', args: ['ev-1'], caseId: 'case-001' }, f.deps);
  assert.match(out, /case-001/);
});

// ---- M26: batched variants read the OFF-CHAIN trail, never the app channel ----

test('anchoring GetAuditTrail: CoC events in receipt order, no proof by default, fabric untouched', async () => {
  const f = fakes();
  const out = JSON.parse(await routeRead({ variant: 'anchoring', fn: 'GetAuditTrail', args: ['ev-1'] }, f.deps));
  assert.deepEqual(out.map((e) => e.op), ['CREATE', 'TRANSFER', 'ACCESS']); // legacy receipt (no event) skipped
  assert.equal(out[0].eventId, 'evt-1');
  assert.equal('proof' in out[0], false);
  assert.deepEqual(f.listed, ['ev-1']);
  assert.equal(f.evaluates.length, 0);
});

test('anchoring GetAuditTrail withProofs: each event carries its Merkle witness', async () => {
  const f = fakes();
  const out = JSON.parse(await routeRead({ variant: 'anchoring', fn: 'GetAuditTrail', args: ['ev-1'], withProofs: true }, f.deps));
  assert.equal(out.length, 3);
  assert.deepEqual(out[1].proof, {
    leafHash: 'leaf-1', siblingPath: [{ pos: 'right', hash: 'sib-1' }], batchId: 'shared-e1-b000000', leafIndex: 1,
    rootRef: { scopeId: 'shared', batchId: 'shared-e1-b000000', txId: 'tx-root' },
  });
  assert.equal(out[1].op, 'TRANSFER'); // event fields preserved beside the proof
});

test('anchoring ReadEvidence: folds the trail into a head-like record flagged offChain', async () => {
  const f = fakes();
  const head = JSON.parse(await routeRead({ variant: 'anchoring', fn: 'ReadEvidence', args: ['ev-1'] }, f.deps));
  assert.deepEqual(head, {
    id: 'ev-1',
    version: '1.0',
    storage: { protocol: 'file', location: 'blob://x', integrity_proof: 'ni:///sha-256;abc' },
    identity: { subject: 'alice' },
    custodian: 'bob', // last TRANSFER wins over the CREATE actor
    status: 'ACTIVE',
    offChain: true,
  });
  assert.equal(f.evaluates.length, 0);
});

test('foldHead: DISPOSE (or a pre-rename REMOVE row) makes the status DISPOSED; no TRANSFER keeps the creator', () => {
  const create = { op: 'CREATE', actor: 'alice', detail: { storage: { protocol: 'file' } } };
  assert.equal(foldHead('ev-1', [create]).custodian, 'alice');
  assert.equal(foldHead('ev-1', [create, { op: 'DISPOSE', actor: 'alice', detail: { reason: 'x' } }]).status, 'DISPOSED');
  assert.equal(foldHead('ev-1', [create, { op: 'REMOVE', actor: 'alice', detail: {} }]).status, 'DISPOSED');
  assert.deepEqual(foldHead('ev-1', [{ op: 'ACCESS', actor: 'bob', detail: {} }]).storage, {}); // no CREATE copy: still a record
});

test('anchoring ReadEvidence with no off-chain events is a 404 RequestError; GetAuditTrail is []', async () => {
  const f = fakes();
  await assert.rejects(
    routeRead({ variant: 'anchoring', fn: 'ReadEvidence', args: ['ev-none'] }, f.deps),
    (err) => err instanceof RequestError && err.status === 404,
  );
  assert.equal(await routeRead({ variant: 'anchoring', fn: 'GetAuditTrail', args: ['ev-none'] }, f.deps), '[]');
});

test('parallel-anchored reads: caseId validation unchanged (400 before any receipt lookup), then off-chain', async () => {
  const f = fakes();
  await assert.rejects(
    routeRead({ variant: 'parallel-anchored', fn: 'GetAuditTrail', args: ['ev-1'] }, f.deps),
    (err) => err instanceof RequestError && err.status === 400,
  );
  assert.equal(f.listed.length, 0);
  const out = JSON.parse(await routeRead({ variant: 'parallel-anchored', fn: 'GetAuditTrail', args: ['ev-1'], caseId: 'case-001' }, f.deps));
  assert.equal(out.length, 3);
  assert.equal(f.evaluates.length, 0);
});

test('direct variants still evaluate the chaincode and never touch the receipt store', async () => {
  const f = fakes();
  const out = JSON.parse(await routeRead({ variant: 'standard', fn: 'GetAuditTrail', args: ['ev-1'] }, f.deps));
  assert.equal(out.channel, 'coc-main');
  assert.equal(out.fn, 'GetAuditTrail');
  assert.equal(f.listed.length, 0);
});
