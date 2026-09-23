'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

// One off-chain receipt (M26) for ev-1: the CoC event plus its Merkle witness.
const RECEIPT = {
  eventId: 'evt-1', evidenceId: 'ev-1',
  event: { eventId: 'evt-1', evidenceId: 'ev-1', caseId: 'shared', op: 'CREATE', actor: 'alice', detail: { storage: { protocol: 'file' } }, ts: 't1' },
  leafHash: 'leaf-0', siblingPath: [], batchId: 'shared-e1-b000000', leafIndex: 0,
  rootRef: { scopeId: 'shared', batchId: 'shared-e1-b000000', txId: 'tx-root' },
};

function fakeDeps(overrides, extra) {
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
      runsStore: { async create(r) { return { runId: 'req-1', status: 'requested', request: r }; }, async list() { return []; }, async get() { return null; } },
      config: { variant: 'standard', token: 'secret-token', defaultChannel: 'coc-main', ...overrides },
      ...extra,
    },
  };
}

// Minimal anchor-client stand-in: GET /roots/:scopeId/:batchId, 404 for an
// unknown batch (the same {error,...} JSON shape the real service sends).
function fakeAnchorClient() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const m = /^\/roots\/([^/]+)\/([^/]+)$/.exec(req.url);
    res.setHeader('content-type', 'application/json');
    if (!m || m[2] === 'missing') { res.statusCode = 404; return res.end(JSON.stringify({ error: 'root-not-found' })); }
    return res.end(JSON.stringify({ scopeId: decodeURIComponent(m[1]), batchId: decodeURIComponent(m[2]), merkleRoot: 'anchor-root-hex' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}` }));
  });
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

test('N2: gateway origin sets security headers on every response (incl. healthz)', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());
  const r = await fetch(`${url}/healthz`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/);
});

test('N6: malformed JSON body -> generic 400, no stack/paths leaked', async (t) => {
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

  const noAuth = await fetch(`${url}/api/v1/runs`);
  assert.equal(noAuth.status, 401);
  const badAuth = await fetch(`${url}/api/v1/runs`, { headers: { authorization: 'Bearer wrong' } });
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

// ---- M26: off-chain reads on the batched variants + anchor-root reads ----

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

test('GET /anchor-roots (parallel-anchored) proxies the anchor-client, status included', async (t) => {
  const ac = await fakeAnchorClient();
  t.after(() => ac.server.close());
  const { deps, evaluates } = fakeDeps({ variant: 'parallel-anchored' }, { anchorClientUrl: ac.url });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const ok = await fetch(`${url}/api/v1/anchor-roots/case-001/case-001-e1-b000002`, { headers: AUTH });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { scopeId: 'case-001', batchId: 'case-001-e1-b000002', merkleRoot: 'anchor-root-hex' });
  assert.deepEqual(ac.hits, ['/roots/case-001/case-001-e1-b000002']);
  assert.equal(evaluates.length, 0, 'the app-channel session is never used for anchor-channel roots');

  const missing = await fetch(`${url}/api/v1/anchor-roots/case-001/missing`, { headers: AUTH });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'root-not-found');
});
