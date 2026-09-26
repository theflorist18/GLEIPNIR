'use strict';

// audit/reconstruct.js against a tiny fake gateway (node:http) serving the
// CONTRACTS §4 V2 three-leaf vectors: docs {"i":0},{"i":1},{"i":2}.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { reconstruct } = require('../audit/reconstruct');
const { generateTrace } = require('../trace/generate');
const { leafHash, computeRoot } = require('../audit/merkle');

const V2 = {
  L0: 'e9f74e715a1806aa651489dcf176e77013b3c851dbc114cc9c24f2fe9d411d65',
  L1: '0b549edd218c251f511934cc2f3bc5c7f4780e27af6b8ab4ae8d92cd94121b4a',
  L2: '38f38fbef725fffb9fa39683d9e50f05ca8c61130c2da2322f9e9021007a2abf',
  P01: '4a89ef3715145c84282de7016b554021cd5019c03446f069e6061efbac670266',
  ROOT: 'c859dbaf0c89a0c3d8acd14558d491171dd4381073d79935182301300d296d2f',
};
const PATHS = [
  [{ pos: 'R', hash: V2.L1 }, { pos: 'R', hash: V2.L2 }],
  [{ pos: 'L', hash: V2.L0 }, { pos: 'R', hash: V2.L2 }],
  [{ pos: 'L', hash: V2.P01 }], // promoted odd leaf: no sibling at level 0
];
const ROOT_REF = { scopeId: 'shared', batchId: 'shared-1-b0', txId: 'tx1' };

function eventsWithProofs(docs) {
  return docs.map((d, i) => ({ ...d, proof: { leafHash: leafHash(d), siblingPath: PATHS[i], batchId: ROOT_REF.batchId, leafIndex: i, rootRef: ROOT_REF } }));
}

// trace: 2 cases on 2 channels, 1 evidence each -> cases=1 reconstructs ev-c001-e001 on case-001
const TRACE = generateTrace({
  seed: 1, cases: 2, channels: 2, evidencePerCase: 1, eventsPerCasePerRound: 2, rounds: 1, workers: 1,
  mix: { transfer_weight: 0.15, access_weight: 0.85, dispose_fraction: 0.5 }, payloadBytes: 0,
});

function fakeGateway({ audit, root }) {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push({ url: req.url, auth: req.headers.authorization });
    const u = new URL(req.url, 'http://x');
    let m;
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if ((m = u.pathname.match(/^\/api\/v1\/evidence\/([^/]+)\/audit$/))) return send(200, audit(decodeURIComponent(m[1]), u));
    if ((m = u.pathname.match(/^\/api\/v1\/anchor-roots\/([^/]+)\/([^/]+)$/))) {
      const r = root(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      return r ? send(200, r) : send(404, { error: 'not found' });
    }
    return send(404, { error: 'no route' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

test('V2 vectors fold to the root through audit/merkle.js', () => {
  const docs = [{ i: 0 }, { i: 1 }, { i: 2 }];
  docs.forEach((d, i) => assert.equal(computeRoot(leafHash(d), PATHS[i]), V2.ROOT));
});

test('anchoring: every event verified, one cached root read, proofs=1 without caseId, bearer token sent', async () => {
  const g = await fakeGateway({
    audit: () => eventsWithProofs([{ i: 0 }, { i: 1 }, { i: 2 }]),
    root: (scope, batch) => (scope === 'shared' && batch === ROOT_REF.batchId ? { scopeId: scope, batchId: batch, merkleRoot: V2.ROOT, leafCount: 3 } : null),
  });
  try {
    const r = await reconstruct({ variant: 'anchoring', trace: TRACE, cases: 1, gateway: g.url, token: 'test-token' });
    assert.equal(r.method, 'merkle-branch');
    assert.equal(r.traceHash, TRACE.hash);
    assert.equal(r.cases.length, 1);
    const c = r.cases[0];
    assert.equal(c.caseId, 'case-001');
    assert.equal(c.dataCase, 1);
    assert.equal(c.evidence, 1);
    assert.equal(c.events, 3);
    assert.equal(c.verifiedEvents, 3);
    assert.equal(c.failedEvents, 0);
    assert.equal(c.rootReads, 1);
    assert.ok(c.ms > 0);
    assert.equal(r.summary.okRate, 1);
    assert.equal(r.summary.msPerCase.min, c.ms);
    assert.equal(r.summary.msPerCase.sd, 0);
    assert.ok(r.summary.msPerEvent > 0);
    const auditCall = g.calls.find((x) => x.url.includes('/audit'));
    assert.equal(auditCall.url, '/api/v1/evidence/ev-c001-e001/audit?proofs=1');
    assert.equal(auditCall.auth, 'Bearer test-token');
    assert.equal(g.calls.filter((x) => x.url.includes('/anchor-roots/')).length, 1);
  } finally {
    g.server.close();
  }
});

test('parallel-anchored: a tampered event fails, the others verify; caseId is passed', async () => {
  const g = await fakeGateway({
    audit: () => eventsWithProofs([{ i: 0 }, { i: 9 }, { i: 2 }]), // leaf 1 tampered, proof unchanged
    root: () => ({ merkleRoot: V2.ROOT }),
  });
  try {
    const r = await reconstruct({ variant: 'parallel-anchored', trace: TRACE, cases: 1, gateway: g.url, token: 't' });
    const c = r.cases[0];
    assert.equal(c.events, 3);
    assert.equal(c.verifiedEvents, 2);
    assert.equal(c.failedEvents, 1);
    assert.equal(c.rootReads, 1);
    assert.equal(r.summary.okRate, 2 / 3);
    const auditCall = g.calls.find((x) => x.url.includes('/audit'));
    assert.equal(auditCall.url, '/api/v1/evidence/ev-c001-e001/audit?proofs=1&caseId=case-001');
  } finally {
    g.server.close();
  }
});

test('anchoring: missing anchor root (404) fails every event of that batch', async () => {
  const g = await fakeGateway({ audit: () => eventsWithProofs([{ i: 0 }, { i: 1 }, { i: 2 }]), root: () => null });
  try {
    const r = await reconstruct({ variant: 'anchoring', trace: TRACE, cases: 1, gateway: g.url, token: 't' });
    assert.equal(r.cases[0].failedEvents, 3);
    assert.equal(r.cases[0].rootReads, 1);
    assert.equal(r.summary.okRate, 0);
  } finally {
    g.server.close();
  }
});

test('standard / parallel: on-chain trail, no Merkle step, no proofs query', async () => {
  const g = await fakeGateway({
    audit: (id) => [{ evidenceId: id, op: 'CREATE', actor: 'a', txId: 't1', ts: '2026-01-01T00:00:00Z' }, { evidenceId: id, op: 'ACCESS', actor: 'a', txId: 't2', ts: '2026-01-01T00:00:01Z' }],
    root: () => { throw new Error('must not be called'); },
  });
  try {
    const std = await reconstruct({ variant: 'standard', trace: TRACE, cases: 2, gateway: g.url, token: 't' });
    assert.equal(std.method, 'on-chain-trail');
    assert.equal(std.cases.length, 2);
    assert.deepEqual(std.cases.map((c) => c.caseId), ['case-001', 'case-002']);
    assert.equal(std.cases[0].verifiedEvents, 2);
    assert.equal(std.summary.okRate, 1);
    assert.equal(g.calls[0].url, '/api/v1/evidence/ev-c001-e001/audit');
    const par = await reconstruct({ variant: 'parallel', trace: TRACE, cases: 1, gateway: g.url, token: 't' });
    assert.equal(g.calls[g.calls.length - 1].url, '/api/v1/evidence/ev-c001-e001/audit?caseId=case-001');
    assert.equal(par.cases[0].rootReads, 0);
  } finally {
    g.server.close();
  }
});

test('gateway error is loud', async () => {
  const g = await fakeGateway({ audit: () => { throw new Error('boom'); }, root: () => null });
  g.server.removeAllListeners('request');
  g.server.on('request', (req, res) => { res.writeHead(500); res.end(); });
  try {
    await assert.rejects(reconstruct({ variant: 'standard', trace: TRACE, cases: 1, gateway: g.url, token: 't' }), /HTTP 500/);
  } finally {
    g.server.close();
  }
});
