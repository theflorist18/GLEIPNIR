'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/index');
const { leafHash, buildTree, verifyPath } = require('../src/merkle');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function makeEvent(i) {
  return {
    eventId: `evt-${i}`,
    evidenceId: `ev-${i}`,
    caseId: 'shared',
    op: 'ACCESS',
    actor: 'tester',
    detail: { action: 'read' },
    ts: '2026-07-03T00:00:00Z',
  };
}

test('anchoring boundary: N events -> receipts stored, one root submitted, receipts re-PUT with txId', async (t) => {
  const receipts = new Map();
  const rootCalls = [];

  const rstore = await startServer(async (req, res) => {
    const body = await readBody(req);
    const id = decodeURIComponent(req.url.replace('/receipts/', ''));
    receipts.set(id, body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const authHeaders = [];
  const gw = await startServer(async (req, res) => {
    const body = await readBody(req);
    rootCalls.push(body);
    authHeaders.push(req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ txId: 'tx-anchor-1' }));
  });

  const app = createApp({
    variant: 'anchoring',
    batchN: 3,
    batchEpoch: 'e0',
    receiptStoreUrl: rstore.url,
    gatewayUrl: gw.url,
    token: 'test-token',
    logLevel: 'silent',
  });
  const batcher = await listen(app);

  t.after(() => {
    batcher.server.close();
    rstore.server.close();
    gw.server.close();
  });

  const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
  for (let i = 0; i < events.length; i += 1) {
    const resp = await fetch(`${batcher.url}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(events[i]),
    });
    assert.equal(resp.status, 202);
    const j = await resp.json();
    assert.equal(j.batchId, 'shared-e0-b000000');
    assert.equal(j.leafIndex, i);
  }

  // Boundary was triggered by the 3rd enqueue; flush awaits in-flight work.
  await fetch(`${batcher.url}/flush`, { method: 'POST' });

  // Exactly one root submitted for the batch, bearer-authed (F23).
  assert.equal(rootCalls.length, 1);
  assert.equal(authHeaders[0], 'Bearer test-token');
  const expectedRoot = buildTree(events.map((e) => leafHash(e))).root;
  assert.equal(rootCalls[0].merkleRoot, expectedRoot);
  assert.equal(rootCalls[0].meta.scopeId, 'shared');
  assert.equal(rootCalls[0].meta.leafCount, 3);

  // Three receipts stored, each carrying the committed txId and a valid path.
  assert.equal(receipts.size, 3);
  for (let i = 0; i < 3; i += 1) {
    const r = receipts.get(`evt-${i}`);
    assert.ok(r, `receipt evt-${i} present`);
    assert.equal(r.rootRef.txId, 'tx-anchor-1');
    assert.equal(r.rootRef.scopeId, 'shared');
    assert.equal(r.leafIndex, i);
    assert.equal(
      verifyPath(r.leafHash, r.siblingPath, expectedRoot),
      true,
      `receipt evt-${i} path verifies against root`
    );
  }

  const status = await (await fetch(`${batcher.url}/status`)).json();
  assert.equal(status.counters.committed, 1);
  assert.equal(status.counters.degraded, 0);
  assert.equal(status.degraded, false);
});

test('duplicate eventId in the open batch is rejected with 409', async (t) => {
  const app = createApp({
    variant: 'anchoring',
    batchN: 100,
    receiptStoreUrl: 'http://127.0.0.1:1', // unused (no boundary reached)
    gatewayUrl: 'http://127.0.0.1:1',
    logLevel: 'silent',
  });
  const batcher = await listen(app);
  t.after(() => batcher.server.close());

  const ev = makeEvent(7);
  const first = await fetch(`${batcher.url}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ev),
  });
  assert.equal(first.status, 202);
  const dup = await fetch(`${batcher.url}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ev),
  });
  assert.equal(dup.status, 409);
});

test('root submit failure keeps receipts and marks the batch degraded', async (t) => {
  const receipts = new Map();
  const rstore = await startServer(async (req, res) => {
    const body = await readBody(req);
    receipts.set(decodeURIComponent(req.url.replace('/receipts/', '')), body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const gw = await startServer((_req, res) => {
    res.writeHead(500);
    res.end('boom');
  });

  const app = createApp({
    variant: 'anchoring',
    batchN: 2,
    receiptStoreUrl: rstore.url,
    gatewayUrl: gw.url,
    logLevel: 'silent',
  });
  const batcher = await listen(app);
  t.after(() => {
    batcher.server.close();
    rstore.server.close();
    gw.server.close();
  });

  for (let i = 0; i < 2; i += 1) {
    await fetch(`${batcher.url}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeEvent(i)),
    });
  }
  await fetch(`${batcher.url}/flush`, { method: 'POST' });

  // Receipts were persisted (without txId) even though the root failed.
  assert.equal(receipts.size, 2);
  assert.equal(receipts.get('evt-0').rootRef.txId, null);

  const status = await (await fetch(`${batcher.url}/status`)).json();
  assert.equal(status.counters.failed, 1);
  assert.equal(status.degraded, true);
  assert.equal(status.batches[0].rootStatus, 'failed');
});

test('parallel-anchored routes per-case queues to the anchor-client', async (t) => {
  const rootCalls = [];
  const rstore = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const anchor = await startServer(async (req, res) => {
    rootCalls.push(await readBody(req));
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ txId: 'tx-case-1' }));
  });

  const app = createApp({
    variant: 'parallel-anchored',
    batchK: 2,
    batchEpoch: 'e0',
    receiptStoreUrl: rstore.url,
    anchorClientUrl: anchor.url,
    logLevel: 'silent',
  });
  const batcher = await listen(app);
  t.after(() => {
    batcher.server.close();
    rstore.server.close();
    anchor.server.close();
  });

  for (let i = 0; i < 2; i += 1) {
    const ev = { ...makeEvent(i), caseId: 'case-001' };
    const resp = await fetch(`${batcher.url}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ev),
    });
    const j = await resp.json();
    assert.equal(j.batchId, 'case-001-e0-b000000');
  }
  await fetch(`${batcher.url}/flush`, { method: 'POST' });

  assert.equal(rootCalls.length, 1);
  assert.equal(rootCalls[0].caseId, 'case-001');
  assert.equal(rootCalls[0].meta.leafCount, 2);
});
