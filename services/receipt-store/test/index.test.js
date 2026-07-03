'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('../src/index');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gleipnir-receipts-'));
}

const sampleReceipt = {
  eventId: 'evt-abc',
  leafHash: 'deadbeef',
  siblingPath: [{ pos: 'L', hash: 'aa' }, { pos: 'R', hash: 'bb' }],
  batchId: 'shared-b000000',
  leafIndex: 2,
  rootRef: { scopeId: 'shared', batchId: 'shared-b000000', txId: null },
};

test('put then get returns the exact receipt', async (t) => {
  const app = createApp({ dataDir: tmpDataDir(), logLevel: 'silent' });
  const { server, url } = await listen(app);
  t.after(() => server.close());

  const put = await fetch(`${url}/receipts/evt-abc`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sampleReceipt),
  });
  assert.equal(put.status, 200);

  const get = await fetch(`${url}/receipts/evt-abc`);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), sampleReceipt);
});

test('upsert overwrites (re-PUT with txId)', async (t) => {
  const app = createApp({ dataDir: tmpDataDir(), logLevel: 'silent' });
  const { server, url } = await listen(app);
  t.after(() => server.close());

  await fetch(`${url}/receipts/evt-abc`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sampleReceipt),
  });
  const withTx = { ...sampleReceipt, rootRef: { ...sampleReceipt.rootRef, txId: 'tx-1' } };
  await fetch(`${url}/receipts/evt-abc`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(withTx),
  });
  const got = await (await fetch(`${url}/receipts/evt-abc`)).json();
  assert.equal(got.rootRef.txId, 'tx-1');
});

test('missing receipt returns 404', async (t) => {
  const app = createApp({ dataDir: tmpDataDir(), logLevel: 'silent' });
  const { server, url } = await listen(app);
  t.after(() => server.close());

  const get = await fetch(`${url}/receipts/does-not-exist`);
  assert.equal(get.status, 404);
});

test('invalid eventId is rejected 400 (path-traversal guard)', async (t) => {
  const app = createApp({ dataDir: tmpDataDir(), logLevel: 'silent' });
  const { server, url } = await listen(app);
  t.after(() => server.close());

  // '..%2F' decodes to '../' — the charset guard must reject it.
  const bad = await fetch(`${url}/receipts/..%2Fescape`);
  assert.equal(bad.status, 400);
});

test('healthz', async (t) => {
  const app = createApp({ dataDir: tmpDataDir(), logLevel: 'silent' });
  const { server, url } = await listen(app);
  t.after(() => server.close());
  assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { ok: true });
});
