'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

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
