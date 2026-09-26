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

async function start(t, dataDir = tmpDataDir()) {
  const { server, url } = await listen(createApp({ dataDir, logLevel: 'silent' }));
  t.after(() => server.close());
  return url;
}

function put(url, id, body) {
  return fetch(`${url}/receipts/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('put then get returns the exact receipt', async (t) => {
  const url = await start(t);

  assert.equal((await put(url, 'evt-abc', sampleReceipt)).status, 200);

  const get = await fetch(`${url}/receipts/evt-abc`);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), sampleReceipt);
});

test('upsert overwrites (re-PUT with txId)', async (t) => {
  const url = await start(t);

  await put(url, 'evt-abc', sampleReceipt);
  const withTx = { ...sampleReceipt, rootRef: { ...sampleReceipt.rootRef, txId: 'tx-1' } };
  await put(url, 'evt-abc', withTx);
  const got = await (await fetch(`${url}/receipts/evt-abc`)).json();
  assert.equal(got.rootRef.txId, 'tx-1');
});

test('missing receipt returns 404', async (t) => {
  const url = await start(t);

  const get = await fetch(`${url}/receipts/does-not-exist`);
  assert.equal(get.status, 404);
});

test('invalid eventId is rejected 400 (path-traversal guard)', async (t) => {
  const url = await start(t);

  // '..%2F' decodes to '../' — the charset guard must reject it.
  const bad = await fetch(`${url}/receipts/..%2Fescape`);
  assert.equal(bad.status, 400);
});

test('healthz', async (t) => {
  const url = await start(t);
  assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { ok: true });
});

// ---- per-evidence index + listing (supervisor brief 2026-09-22 §6) ----
// The receipt now carries `evidenceId` + `event`; the store indexes eventIds
// under DATA_DIR/idx/<evidenceId>.txt and lists them back in index order.
// This is an index and an event copy, nothing more — still un-hardened.

function receiptFor(eventId, evidenceId, seq) {
  return {
    ...sampleReceipt,
    eventId,
    evidenceId,
    event: { eventId, evidenceId, caseId: 'shared', op: 'ACCESS', actor: 'a', detail: { seq }, ts: `2026-09-22T00:00:0${seq}Z` },
  };
}

test('GET /receipts?evidenceId lists receipts in first-PUT order; re-PUT is idempotent', async (t) => {
  const dataDir = tmpDataDir();
  const url = await start(t, dataDir);

  assert.equal((await put(url, 'evt-b', receiptFor('evt-b', 'ev-1', 0))).status, 200);
  assert.equal((await put(url, 'evt-a', receiptFor('evt-a', 'ev-1', 1))).status, 200);
  assert.equal((await put(url, 'evt-x', receiptFor('evt-x', 'ev-2', 2))).status, 200);
  // Re-PUT (the txId fill-in) must not duplicate the index entry.
  const withTx = receiptFor('evt-b', 'ev-1', 0);
  withTx.rootRef = { ...withTx.rootRef, txId: 'tx-9' };
  assert.equal((await put(url, 'evt-b', withTx)).status, 200);

  const resp = await fetch(`${url}/receipts?evidenceId=ev-1`);
  assert.equal(resp.status, 200);
  const list = await resp.json();
  assert.deepEqual(list.map((r) => r.eventId), ['evt-b', 'evt-a']);
  assert.equal(list[0].rootRef.txId, 'tx-9', 'listing returns the latest receipt body');
  assert.deepEqual(list[1].event.detail, { seq: 1 });

  // The index file is exactly one line per eventId, in PUT order.
  const idx = fs.readFileSync(path.join(dataDir, 'idx', 'ev-1.txt'), 'utf8');
  assert.equal(idx, 'evt-b\nevt-a\n');
  assert.deepEqual((await (await fetch(`${url}/receipts?evidenceId=ev-2`)).json()).map((r) => r.eventId), ['evt-x']);
});

test('GET /receipts?evidenceId -> [] when unknown; 400 when missing/invalid', async (t) => {
  const url = await start(t);

  assert.deepEqual(await (await fetch(`${url}/receipts?evidenceId=nobody`)).json(), []);
  assert.equal((await fetch(`${url}/receipts`)).status, 400);
  assert.equal((await fetch(`${url}/receipts?evidenceId=..%2Fescape`)).status, 400);
});

test('receipt without evidenceId is stored but not indexed; bad evidenceId is 400', async (t) => {
  const url = await start(t);

  assert.equal((await put(url, 'evt-abc', sampleReceipt)).status, 200); // legacy shape
  assert.equal((await fetch(`${url}/receipts/evt-abc`)).status, 200);
  assert.equal((await put(url, 'evt-bad', { ...sampleReceipt, evidenceId: '../x' })).status, 400);
  assert.equal((await fetch(`${url}/receipts/evt-bad`)).status, 404, 'rejected PUT writes nothing');
});
