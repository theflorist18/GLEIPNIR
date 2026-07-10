'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routeWrite, routeRead, channelFor, RequestError } = require('../src/variantRouter');

function fakes() {
  const submits = [];
  const enqueues = [];
  return {
    submits,
    enqueues,
    deps: {
      defaultChannel: 'coc-main',
      fabric: {
        async submit(channel, fn, args) { submits.push({ channel, fn, args }); return 'tx-123'; },
        async evaluate(channel, fn, args) { return JSON.stringify({ channel, fn, args }); },
      },
      batcher: {
        async enqueue(event) { enqueues.push(event); return { batchId: 'shared-b000000', leafIndex: 0 }; },
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
