'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

// One off-chain receipt for ev-1: the CoC event plus its Merkle witness.
const RECEIPT = {
  eventId: 'evt-1', evidenceId: 'ev-1',
  event: { eventId: 'evt-1', evidenceId: 'ev-1', caseId: 'shared', op: 'CREATE', actor: 'alice', detail: { storage: { protocol: 'file' } }, ts: 't1' },
  leafHash: 'leaf-0', siblingPath: [], batchId: 'shared-e1-b000000', leafIndex: 0,
  rootRef: { scopeId: 'shared', batchId: 'shared-e1-b000000', txId: 'tx-root' },
};

function fakeDeps(overrides) {
  const submits = [];
  const evaluates = [];
  return {
    submits,
    evaluates,
    deps: {
      fabric: {
        async submit(channel, fn, args) { submits.push({ channel, fn, args }); return 'tx-abc'; },
        async evaluate(channel, fn, args) {
          evaluates.push({ channel, fn, args });
          if (fn === 'ReadAnchorRoot') return JSON.stringify({ scopeId: args[0], batchId: args[1], merkleRoot: 'root-hex' });
          return JSON.stringify({ id: args[0], status: 'ACTIVE' });
        },
      },
      batcher: { async enqueue() { return { batchId: 'shared-b000000', leafIndex: 0 }; } },
      receipts: { async listByEvidence(id) { return id === 'ev-1' ? [RECEIPT] : []; } },
      config: { variant: 'standard', token: 'secret-token', defaultChannel: 'coc-main', ...overrides },
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('healthz is unauthenticated', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());
  const r = await fetch(`${url}/healthz`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('gateway origin sets security headers on every response (incl. healthz)', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());
  const r = await fetch(`${url}/healthz`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/);
});

test('malformed JSON body -> generic 400, no stack/paths leaked', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());
  const r = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json',
  });
  assert.equal(r.status, 400);
  const text = await r.text();
  assert.equal(r.headers.get('content-type')?.startsWith('application/json'), true);
  assert.deepEqual(JSON.parse(text), { error: 'invalid request body' });
  // no Express default HTML stack page, no container paths, no parser internals
  assert.doesNotMatch(text, /SyntaxError|node_modules|\/app\/|<pre>|at JSON\.parse/);
});

test('missing/invalid bearer token -> 401', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const noAuth = await fetch(`${url}/api/v1/evidence/ev-1/audit`);
  assert.equal(noAuth.status, 401);
  const badAuth = await fetch(`${url}/api/v1/evidence/ev-1/audit`, { headers: { authorization: 'Bearer wrong' } });
  assert.equal(badAuth.status, 401);
});

test('POST /api/v1/evidence (standard) submits CreateEvidence on coc-main and hashes payload to ni-URI', async (t) => {
  const { deps, submits } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const resp = await fetch(`${url}/api/v1/evidence`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      evidenceId: 'ev-9',
      version: '1.0',
      identity: { org: 'Org1MSP', subject: 'alice' },
      storage: { protocol: 'file', location: 'blob://x' },
      payloadBase64: Buffer.from('hello').toString('base64'),
    }),
  });
  assert.equal(resp.status, 201);
  assert.equal((await resp.json()).txId, 'tx-abc');

  assert.equal(submits.length, 1);
  assert.equal(submits[0].channel, 'coc-main');
  assert.equal(submits[0].fn, 'CreateEvidence');
  const head = JSON.parse(submits[0].args[1]);
  assert.equal(head.id, 'ev-9');
  assert.match(head.storage.integrity_proof, /^ni:\/\/\/sha-256;/); // payload hashed, not stored
});

test('POST /api/v1/evidence (anchoring) enqueues instead of submitting -> 202', async (t) => {
  const { deps, submits } = fakeDeps({ variant: 'anchoring' });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const resp = await fetch(`${url}/api/v1/evidence`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
    body: JSON.stringify({ identity: { subject: 'bob' } }),
  });
  assert.equal(resp.status, 202);
  assert.equal((await resp.json()).batched, true);
  assert.equal(submits.length, 0);
});

// ---- off-chain reads on the batched variants + anchor-root reads ----

const AUTH = { authorization: 'Bearer secret-token' };

test('GET /evidence/:id/audit (anchoring) serves the off-chain trail; ?proofs=1 adds the witness', async (t) => {
  const { deps, evaluates } = fakeDeps({ variant: 'anchoring' });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const plain = await (await fetch(`${url}/api/v1/evidence/ev-1/audit`, { headers: AUTH })).json();
  assert.deepEqual(plain.map((e) => e.op), ['CREATE']);
  assert.equal('proof' in plain[0], false);

  const withProofs = await (await fetch(`${url}/api/v1/evidence/ev-1/audit?proofs=1`, { headers: AUTH })).json();
  assert.equal(withProofs[0].proof.batchId, 'shared-e1-b000000');
  assert.equal(withProofs[0].proof.rootRef.txId, 'tx-root');
  assert.equal(evaluates.length, 0, 'batched variants never evaluate the app channel for reads');
});

test('GET /evidence/:id (anchoring) folds the trail; unknown id -> 404', async (t) => {
  const { deps } = fakeDeps({ variant: 'anchoring' });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const r = await fetch(`${url}/api/v1/evidence/ev-1`, { headers: AUTH });
  assert.equal(r.status, 200);
  const head = await r.json();
  assert.equal(head.offChain, true);
  assert.equal(head.custodian, 'alice');
  assert.equal(head.status, 'ACTIVE');

  assert.equal((await fetch(`${url}/api/v1/evidence/ev-nope`, { headers: AUTH })).status, 404);
});

test('GET /anchor-roots (standard/parallel) -> 404 "no anchor roots in this variant"', async (t) => {
  for (const variant of ['standard', 'parallel']) {
    const { deps, evaluates } = fakeDeps({ variant });
    const { server, url } = await listen(createApp(deps));
    t.after(() => server.close());
    const r = await fetch(`${url}/api/v1/anchor-roots/shared/b1`, { headers: AUTH });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'no anchor roots in this variant' });
    assert.equal(evaluates.length, 0);
  }
});

test('GET /anchor-roots (anchoring) evaluates ReadAnchorRoot on the default channel; unauthenticated -> 401', async (t) => {
  const { deps, evaluates } = fakeDeps({ variant: 'anchoring' });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  assert.equal((await fetch(`${url}/api/v1/anchor-roots/shared/shared-e1-b000000`)).status, 401);
  const r = await fetch(`${url}/api/v1/anchor-roots/shared/shared-e1-b000000`, { headers: AUTH });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { scopeId: 'shared', batchId: 'shared-e1-b000000', merkleRoot: 'root-hex' });
  assert.deepEqual(evaluates, [{ channel: 'coc-main', fn: 'ReadAnchorRoot', args: ['shared', 'shared-e1-b000000'] }]);
});

test('GET /anchor-roots (parallel-anchored) evaluates ReadAnchorRoot on the case\'s own channel', async (t) => {
  const { deps, evaluates } = fakeDeps({ variant: 'parallel-anchored' });
  deps.fabric.evaluate = async (channel, fn, args) => {
    evaluates.push({ channel, fn, args });
    if (args[1] === 'missing') throw new Error(`anchor root for scope "${args[0]}" batch "${args[1]}" not found`);
    return JSON.stringify({ scopeId: args[0], batchId: args[1], merkleRoot: 'case-root-hex' });
  };
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const ok = await fetch(`${url}/api/v1/anchor-roots/case-007/case-007-e1-b000002`, { headers: AUTH });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { scopeId: 'case-007', batchId: 'case-007-e1-b000002', merkleRoot: 'case-root-hex' });
  assert.deepEqual(evaluates, [{ channel: 'case-007', fn: 'ReadAnchorRoot', args: ['case-007', 'case-007-e1-b000002'] }]);

  // chaincode not-found -> 404 (a batch not yet anchored); a scope that is no case channel -> 400, no read
  assert.equal((await fetch(`${url}/api/v1/anchor-roots/case-007/missing`, { headers: AUTH })).status, 404);
  assert.equal((await fetch(`${url}/api/v1/anchor-roots/shared/b1`, { headers: AUTH })).status, 400);
  assert.equal((await fetch(`${url}/api/v1/anchor-roots/CASE-3f2a/b1`, { headers: AUTH })).status, 400);
  assert.equal(evaluates.length, 2);
});

test('POST /internal/anchor-root commits the root on coc-main (anchoring) or the case channel (parallel-anchored)', async (t) => {
  const post = (url, body) => fetch(`${url}/internal/anchor-root`, {
    method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const root = 'a'.repeat(64);

  const anchoring = fakeDeps({ variant: 'anchoring' });
  const a = await listen(createApp(anchoring.deps));
  t.after(() => a.server.close());
  const ra = await post(a.url, { batchId: 'shared-e1-b000000', merkleRoot: root, meta: { scopeId: 'shared', leafCount: 50 } });
  assert.equal(ra.status, 201);
  assert.deepEqual(await ra.json(), { txId: 'tx-abc' });
  assert.deepEqual(anchoring.submits, [{ channel: 'coc-main', fn: 'CommitAnchorRoot',
    args: ['shared-e1-b000000', root, '{"scopeId":"shared","leafCount":50}'] }]);

  const pa = fakeDeps({ variant: 'parallel-anchored' });
  const p = await listen(createApp(pa.deps));
  t.after(() => p.server.close());
  const meta = { scopeId: 'case-012', leafCount: 50, caseId: 'case-012' };
  assert.equal((await post(p.url, { batchId: 'case-012-e1-b000003', merkleRoot: root, meta })).status, 201);
  assert.deepEqual(pa.submits, [{ channel: 'case-012', fn: 'CommitAnchorRoot',
    args: ['case-012-e1-b000003', root, JSON.stringify(meta)] }]);
  // a root without a case-NNN caseId never falls through to another channel
  assert.equal((await post(p.url, { batchId: 'b1', merkleRoot: root, meta: { scopeId: 'shared', leafCount: 1 } })).status, 400);
  assert.equal((await post(p.url, { batchId: 'b1', merkleRoot: root, meta: { caseId: 'CASE-3f2a', leafCount: 1 } })).status, 400);
  assert.equal(pa.submits.length, 1);

  // the direct variants anchor nothing
  const std = fakeDeps({ variant: 'standard' });
  const s = await listen(createApp(std.deps));
  t.after(() => s.server.close());
  assert.equal((await post(s.url, { batchId: 'b1', merkleRoot: root, meta: {} })).status, 404);
  assert.equal(std.submits.length, 0);
});

test('GET /internal/anchor-root (parallel-anchored) reads the root from the case channel', async (t) => {
  const { deps, evaluates } = fakeDeps({ variant: 'parallel-anchored' });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());
  const r = await fetch(`${url}/internal/anchor-root/case-003/case-003-e1-b000000`, { headers: AUTH });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).merkleRoot, 'root-hex');
  assert.deepEqual(evaluates, [{ channel: 'case-003', fn: 'ReadAnchorRoot', args: ['case-003', 'case-003-e1-b000000'] }]);
});
