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

function postEvent(url, ev) {
  return fetch(`${url}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ev),
  });
}

// Stub receipt-store: records the LAST body PUT per eventId.
function receiptStoreStub(receipts) {
  return startServer(async (req, res) => {
    const body = await readBody(req);
    receipts.set(decodeURIComponent(req.url.replace('/receipts/', '')), body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('anchoring boundary: N events -> receipts stored, one root submitted, receipts re-PUT with txId', async (t) => {
  const receipts = new Map();
  const rootCalls = [];

  const rstore = await receiptStoreStub(receipts);
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
    batchSize: 3,
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
    const resp = await postEvent(batcher.url, events[i]);
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

  // Three receipts stored, each carrying the committed txId, a valid path,
  // and (brief 2026-09-22 §6) the evidenceId + the event body as enqueued.
  assert.equal(receipts.size, 3);
  for (let i = 0; i < 3; i += 1) {
    const r = receipts.get(`evt-${i}`);
    assert.ok(r, `receipt evt-${i} present`);
    assert.equal(r.rootRef.txId, 'tx-anchor-1');
    assert.equal(r.rootRef.scopeId, 'shared');
    assert.equal(r.leafIndex, i);
    assert.equal(r.evidenceId, `ev-${i}`);
    assert.deepEqual(r.event, events[i]);
    assert.equal(r.leafHash, leafHash(r.event), 'leafHash == SHA-256(canonical event)');
    assert.equal(
      verifyPath(r.leafHash, r.siblingPath, expectedRoot),
      true,
      `receipt evt-${i} path verifies against root`
    );
  }

  const status = await (await fetch(`${batcher.url}/status`)).json();
  assert.equal(status.batchSize, 3);
  assert.equal(status.flushTimeoutMs, 0);
  assert.equal(status.counters.committed, 1);
  assert.equal(status.counters.forced, 0);
  assert.equal(status.counters.degraded, 0);
  assert.equal(status.degraded, false);

  // Size-closed batch: timestamps + delay fields for the anchoring-delay metric.
  const b = status.batches[0];
  assert.equal(b.forced, false);
  for (const k of ['openedAt', 'closedAt', 'committedAt']) {
    assert.match(b[k], ISO_RE, `${k} is ISO-8601`);
  }
  assert.ok(b.openedAt <= b.closedAt && b.closedAt <= b.committedAt);
  assert.ok(b.delayMs.min >= 0 && b.delayMs.min <= b.delayMs.mean && b.delayMs.mean <= b.delayMs.max);
});

test('flush timer closes a partial batch (forced:true); /flush also forces', async (t) => {
  const rootCalls = [];
  const rstore = await receiptStoreStub(new Map());
  const gw = await startServer(async (req, res) => {
    rootCalls.push(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ txId: 'tx-1' }));
  });
  const flushMs = 50;
  const app = createApp({
    variant: 'anchoring',
    batchSize: 100, // never reached by size
    flushMs,
    receiptStoreUrl: rstore.url,
    gatewayUrl: gw.url,
    logLevel: 'silent',
  });
  const batcher = await listen(app);
  t.after(() => { batcher.server.close(); rstore.server.close(); gw.server.close(); });

  const t0 = Date.now();
  await postEvent(batcher.url, makeEvent(0));
  // Wait for the TIMER (not /flush) to close the batch.
  let status;
  while (Date.now() - t0 < 2000) {
    status = await (await fetch(`${batcher.url}/status`)).json();
    if (status.counters.closedBatches === 1) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(status.counters.closedBatches, 1, 'timer closed the batch');
  assert.ok(Date.now() - t0 >= flushMs, 'closed no earlier than the timeout');
  await app.locals.settle();

  assert.equal(rootCalls.length, 1);
  assert.equal(rootCalls[0].meta.leafCount, 1);
  status = await (await fetch(`${batcher.url}/status`)).json();
  assert.equal(status.flushTimeoutMs, flushMs);
  const b = status.batches[0];
  assert.equal(b.forced, true);
  assert.equal(b.rootStatus, 'committed');
  assert.ok(b.delayMs.min >= flushMs - 5, `delay ${b.delayMs.min} spans the timeout`);
  assert.ok(b.delayMs.min <= b.delayMs.max);

  // A second partial batch closed by POST /flush is forced too and starts a
  // fresh window (new openedAt, new sequence).
  await postEvent(batcher.url, makeEvent(1));
  status = await (await fetch(`${batcher.url}/flush`, { method: 'POST' })).json();
  assert.equal(rootCalls.length, 2);
  assert.equal(status.counters.forced, 2);
  assert.equal(status.batches[1].forced, true);
  assert.ok(status.batches[1].openedAt >= status.batches[0].closedAt);
});

test('duplicate eventId in the open batch is rejected with 409', async (t) => {
  const app = createApp({
    variant: 'anchoring',
    batchSize: 100,
    receiptStoreUrl: 'http://127.0.0.1:1', // unused (no boundary reached)
    gatewayUrl: 'http://127.0.0.1:1',
    logLevel: 'silent',
  });
  const batcher = await listen(app);
  t.after(() => batcher.server.close());

  const ev = makeEvent(7);
  const first = await postEvent(batcher.url, ev);
  assert.equal(first.status, 202);
  const dup = await postEvent(batcher.url, ev);
  assert.equal(dup.status, 409);
});

test('root submit failure keeps receipts and marks the batch degraded', async (t) => {
  const receipts = new Map();
  const rstore = await receiptStoreStub(receipts);
  const gw = await startServer((_req, res) => {
    res.writeHead(500);
    res.end('boom');
  });

  const app = createApp({
    variant: 'anchoring',
    batchSize: 2,
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

  for (let i = 0; i < 2; i += 1) await postEvent(batcher.url, makeEvent(i));
  await fetch(`${batcher.url}/flush`, { method: 'POST' });

  // Receipts were persisted (without txId) even though the root failed.
  assert.equal(receipts.size, 2);
  assert.equal(receipts.get('evt-0').rootRef.txId, null);

  const status = await (await fetch(`${batcher.url}/status`)).json();
  assert.equal(status.counters.failed, 1);
  assert.equal(status.degraded, true);
  assert.equal(status.batches[0].rootStatus, 'failed');
  // Never committed -> no commit timestamp, no delay.
  assert.equal(status.batches[0].committedAt, null);
  assert.equal(status.batches[0].delayMs, null);
});

test('parallel-anchored routes per-case queues to the anchor-client', async (t) => {
  const rootCalls = [];
  const rstore = await receiptStoreStub(new Map());
  const anchor = await startServer(async (req, res) => {
    rootCalls.push(await readBody(req));
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ txId: 'tx-case-1' }));
  });

  const app = createApp({
    variant: 'parallel-anchored',
    batchSize: 2,
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
    const resp = await postEvent(batcher.url, ev);
    const j = await resp.json();
    assert.equal(j.batchId, 'case-001-e0-b000000');
  }
  await fetch(`${batcher.url}/flush`, { method: 'POST' });

  assert.equal(rootCalls.length, 1);
  assert.equal(rootCalls[0].caseId, 'case-001');
  assert.equal(rootCalls[0].meta.leafCount, 2);
});
