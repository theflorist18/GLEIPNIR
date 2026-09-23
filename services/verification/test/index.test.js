'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('../src/index');

// V2 vector (docs/CONTRACTS.md §4): a receipt whose leaf is L1 with the L1
// sibling path folds to V2.ROOT.
const V2 = {
  L0: 'e9f74e715a1806aa651489dcf176e77013b3c851dbc114cc9c24f2fe9d411d65',
  L1: '0b549edd218c251f511934cc2f3bc5c7f4780e27af6b8ab4ae8d92cd94121b4a',
  L2: '38f38fbef725fffb9fa39683d9e50f05ca8c61130c2da2322f9e9021007a2abf',
  ROOT: 'c859dbaf0c89a0c3d8acd14558d491171dd4381073d79935182301300d296d2f',
};

function goodReceipt(scopeId) {
  return {
    eventId: 'evt-1',
    leafHash: V2.L1,
    siblingPath: [{ pos: 'L', hash: V2.L0 }, { pos: 'R', hash: V2.L2 }],
    batchId: `${scopeId}-b000000`,
    leafIndex: 1,
    rootRef: { scopeId, batchId: `${scopeId}-b000000`, txId: 'tx-1' },
  };
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// receipt-store stub serving a fixed receipt map; 404 for unknown ids.
function receiptStore(receipts) {
  return startServer((req, res) => {
    const id = decodeURIComponent(req.url.replace('/receipts/', ''));
    if (!receipts.has(id)) { res.writeHead(404); return res.end('{"error":"not found"}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(receipts.get(id)));
  });
}

test('anchoring happy path: recomputed root == anchored root -> ok:true with timed steps', async (t) => {
  const rstore = await receiptStore(new Map([['evt-1', goodReceipt('shared')]]));
  let gatewayHits = 0;
  const gw = await startServer((req, res) => {
    gatewayHits += 1;
    assert.match(req.url, /^\/internal\/anchor-root\/shared\/shared-b000000$/);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });

  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  const resp = await fetch(`${v.url}/verify/evt-1`);
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(body.leafSource, 'receipt', 'no event copy -> stored leafHash used');
  assert.equal(gatewayHits, 1);
  assert.ok(typeof body.steps.fetchMs === 'number');
  assert.ok(typeof body.steps.recomputeMs === 'number');
  assert.ok(typeof body.steps.compareRootMs === 'number');
  assert.ok(body.latencyMs >= 0);
});

test('tampered receipt: recomputed root != anchored root -> 200 ok:false root-mismatch', async (t) => {
  const tampered = goodReceipt('shared');
  tampered.leafHash = '00'.repeat(32); // wrong leaf
  const rstore = await receiptStore(new Map([['evt-1', tampered]]));
  const gw = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  const resp = await fetch(`${v.url}/verify/evt-1`);
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'root-mismatch');
});

test('missing receipt -> 404 missing-receipt', async (t) => {
  const rstore = await receiptStore(new Map());
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: 'http://127.0.0.1:1', logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); });

  const resp = await fetch(`${v.url}/verify/evt-missing`);
  assert.equal(resp.status, 404);
  assert.equal((await resp.json()).reason, 'missing-receipt');
});

test('anchor read error -> 502 anchor-read-error', async (t) => {
  const rstore = await receiptStore(new Map([['evt-1', goodReceipt('shared')]]));
  const gw = await startServer((_req, res) => { res.writeHead(500); res.end('boom'); });
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  const resp = await fetch(`${v.url}/verify/evt-1`);
  assert.equal(resp.status, 502);
  assert.equal((await resp.json()).reason, 'anchor-read-error');
});

// The receipt-store is deliberately un-hardened and stores ANY JSON, so a
// corrupt witness must produce a graceful verdict — never an unhandled throw
// that kills the metric service mid-run (audit F54).
test('malformed receipt -> 422 malformed-receipt, service stays up', async (t) => {
  const badPath = goodReceipt('shared');
  badPath.siblingPath = [{ pos: 'X', hash: 'not-hex' }];
  const rstore = await receiptStore(new Map([
    ['evt-empty', {}],
    ['evt-badpath', badPath],
  ]));
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: 'http://127.0.0.1:1', logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); });

  for (const id of ['evt-empty', 'evt-badpath']) {
    const resp = await fetch(`${v.url}/verify/${id}`);
    assert.equal(resp.status, 422, `${id} must be rejected as malformed`);
    assert.equal((await resp.json()).reason, 'malformed-receipt');
  }
  // Process survived both: the handler is still serving.
  const health = await fetch(`${v.url}/healthz`);
  assert.equal((await health.json()).ok, true);
});

// RQ2: when VERIFY_METRICS_PATH is set, each COMPLETED (3-step, 200) verify
// appends one JSON line with the fetch/recompute/compare breakdown; error paths
// (partial steps) do not. This is the per-request source collect.py summarises.
test('RQ2: a completed verify appends a step-breakdown metric line; errors do not', async (t) => {
  const metricsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-metrics-')), 'verify.jsonl');
  const rstore = await receiptStore(new Map([['evt-1', goodReceipt('shared')]])); // evt-missing absent
  const gw = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent', metricsPath });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  assert.equal((await fetch(`${v.url}/verify/evt-1`)).status, 200);       // records
  assert.equal((await fetch(`${v.url}/verify/evt-missing`)).status, 404); // must NOT record

  // The append is fire-and-forget; give the event loop a couple of ticks.
  await new Promise((r) => setTimeout(r, 50));

  const lines = fs.readFileSync(metricsPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'exactly one completed verify should be recorded');
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.eventId, 'evt-1');
  assert.equal(rec.ok, true);
  assert.equal(rec.leafSource, 'receipt');
  for (const k of ['fetchMs', 'recomputeMs', 'compareRootMs', 'latencyMs']) {
    assert.ok(typeof rec[k] === 'number', `${k} should be a number`);
  }
});

test('RQ2: with no metricsPath (default) nothing is written and verify still works', async (t) => {
  const rstore = await receiptStore(new Map([['evt-1', goodReceipt('shared')]]));
  const gw = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  assert.equal((await fetch(`${v.url}/verify/evt-1`)).status, 200); // no throw despite no metrics sink
});

test('parallel-anchored path reads the anchor-client, not the gateway', async (t) => {
  const rstore = await receiptStore(new Map([['evt-1', goodReceipt('case-001')]]));
  let anchorHits = 0;
  const anchor = await startServer((req, res) => {
    anchorHits += 1;
    assert.match(req.url, /^\/roots\/case-001\/case-001-b000000$/);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });
  const app = createApp({ variant: 'parallel-anchored', receiptStoreUrl: rstore.url, anchorClientUrl: anchor.url, logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); anchor.server.close(); });

  const resp = await fetch(`${v.url}/verify/evt-1`);
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).ok, true);
  assert.equal(anchorHits, 1);
});

// ---- leaf recomputed from the event copy (supervisor brief 2026-09-22 §6) ----
// Receipts written since the brief carry `event` (the CoC event as enqueued).
// The leaf is then SHA-256(canonical event) recomputed HERE, inside
// recomputeMs, and the stored leafHash is not trusted for the fold.

test('receipt with event copy: leaf recomputed from the event -> ok:true, leafSource:"event"', async (t) => {
  const r = { ...goodReceipt('shared'), evidenceId: 'ev-1', event: { i: 1 } }; // leafHash({i:1}) == V2.L1
  const rstore = await receiptStore(new Map([['evt-1', r]]));
  const gw = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  const resp = await fetch(`${v.url}/verify/evt-1`);
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(body.leafSource, 'event');
});

test('tampered event copy with an untouched stored leafHash -> root-mismatch (leaf comes from the event, not the receipt)', async (t) => {
  const r = { ...goodReceipt('shared'), evidenceId: 'ev-1', event: { i: 1, tampered: true } };
  const rstore = await receiptStore(new Map([['evt-1', r]]));
  const gw = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent' });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  const resp = await fetch(`${v.url}/verify/evt-1`);
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'root-mismatch');
  assert.equal(body.leafSource, 'event');
});

test('metrics line records leafSource:"event" for an event-copy receipt', async (t) => {
  const metricsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-metrics-')), 'verify.jsonl');
  const r = { ...goodReceipt('shared'), evidenceId: 'ev-1', event: { i: 1 } };
  const rstore = await receiptStore(new Map([['evt-1', r]]));
  const gw = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ merkleRoot: V2.ROOT }));
  });
  const app = createApp({ variant: 'anchoring', receiptStoreUrl: rstore.url, gatewayUrl: gw.url, logLevel: 'silent', metricsPath });
  const v = await listen(app);
  t.after(() => { v.server.close(); rstore.server.close(); gw.server.close(); });

  assert.equal((await fetch(`${v.url}/verify/evt-1`)).status, 200);
  await new Promise((res) => setTimeout(res, 50));
  const rec = JSON.parse(fs.readFileSync(metricsPath, 'utf8').trim());
  assert.equal(rec.leafSource, 'event');
  assert.ok(rec.recomputeMs >= 0);
});
