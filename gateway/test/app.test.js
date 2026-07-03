'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function fakeDeps(overrides) {
  const submits = [];
  return {
    submits,
    deps: {
      fabric: {
        async submit(channel, fn, args) { submits.push({ channel, fn, args }); return 'tx-abc'; },
        async evaluate(_channel, _fn, args) { return JSON.stringify({ id: args[0], status: 'ACTIVE' }); },
      },
      batcher: { async enqueue() { return { batchId: 'shared-b000000', leafIndex: 0 }; } },
      runsStore: { async create(r) { return { runId: 'req-1', status: 'requested', request: r }; }, async list() { return []; }, async get() { return null; } },
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
