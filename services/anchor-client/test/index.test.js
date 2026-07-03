import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

const silent = { error() {} };

test('POST /roots submits CommitAnchorRoot, injects caseId into metaJSON, returns 201 {txId}', async (t) => {
  const calls = [];
  const contract = {
    async submit(fn, args) { calls.push({ fn, args }); return { txId: 'tx-anchor-9' }; },
    async evaluate() { throw new Error('unused'); },
  };
  const server = createApp({ contract, logger: silent });
  const url = await listen(server);
  t.after(() => server.close());

  const resp = await fetch(`${url}/roots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: 'case-001', batchId: 'case-001-b000000', merkleRoot: 'abc123', meta: { leafCount: 5 } }),
  });
  assert.equal(resp.status, 201);
  assert.deepEqual(await resp.json(), { txId: 'tx-anchor-9' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'CommitAnchorRoot');
  assert.equal(calls[0].args[0], 'case-001-b000000');
  assert.equal(calls[0].args[1], 'abc123');
  const meta = JSON.parse(calls[0].args[2]);
  assert.equal(meta.caseId, 'case-001'); // caseId authoritative for chaincode scopeId
  assert.equal(meta.leafCount, 5);
});

test('POST /roots with missing fields -> 400', async (t) => {
  const contract = { async submit() { throw new Error('should not be called'); }, async evaluate() {} };
  const server = createApp({ contract, logger: silent });
  const url = await listen(server);
  t.after(() => server.close());

  const resp = await fetch(`${url}/roots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: 'case-001' }),
  });
  assert.equal(resp.status, 400);
});

test('POST /roots on submit failure -> 502', async (t) => {
  const contract = {
    async submit() { throw new Error('endorsement policy failure'); },
    async evaluate() {},
  };
  const server = createApp({ contract, logger: silent });
  const url = await listen(server);
  t.after(() => server.close());

  const resp = await fetch(`${url}/roots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: 'case-001', batchId: 'b1', merkleRoot: 'r1' }),
  });
  assert.equal(resp.status, 502);
});

test('GET /roots/:caseId/:batchId returns the record', async (t) => {
  const record = { scopeId: 'case-001', batchId: 'b1', merkleRoot: 'r1', leafCount: 5 };
  const contract = {
    async submit() {},
    async evaluate(fn, args) {
      assert.equal(fn, 'ReadAnchorRoot');
      assert.deepEqual(args, ['case-001', 'b1']);
      return Buffer.from(JSON.stringify(record), 'utf8');
    },
  };
  const server = createApp({ contract, logger: silent });
  const url = await listen(server);
  t.after(() => server.close());

  const resp = await fetch(`${url}/roots/case-001/b1`);
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), record);
});

test('GET /roots/:caseId/:batchId maps not-found to 404', async (t) => {
  const contract = {
    async submit() {},
    async evaluate() { const e = new Error('anchor root for scope "case-001" batch "bX" not found'); throw e; },
  };
  const server = createApp({ contract, logger: silent });
  const url = await listen(server);
  t.after(() => server.close());

  const resp = await fetch(`${url}/roots/case-001/bX`);
  assert.equal(resp.status, 404);
});

test('healthz', async (t) => {
  const server = createApp({ contract: { async submit() {}, async evaluate() {} }, logger: silent });
  const url = await listen(server);
  t.after(() => server.close());
  assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { ok: true });
});
