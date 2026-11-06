'use strict';

// The finalization link: the rest connector copies the Merkle batch an anchored
// write's 202 names onto the TxStatus, and workload/lib/txlog.js writes it into
// that transaction's line, where collect.py joins it to the batch's root commit.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BENCH = path.join(__dirname, '..');

test('rest connector: a 202 puts batchId + leafIndex on the TxStatus; other answers do not', async (t) => {
  const answers = [
    [202, { batched: true, eventId: 'evt-1', batchId: 'case-001-e1-b000003', leafIndex: 7 }],
    [201, { txId: 'tx-1' }],
    [202, 'not json'],
  ];
  const server = http.createServer((req, res) => {
    const [status, body] = answers.shift();
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  const { ConnectorFactory } = require('../connectors/rest');
  const conn = await ConnectorFactory(0);
  const req = { method: 'POST', path: '/api/v1/evidence', body: {} };

  const accepted = await conn._sendSingleRequest(req);
  assert.equal(accepted.IsCommitted(), true);
  assert.equal(accepted.Get('batchId'), 'case-001-e1-b000003');
  assert.equal(accepted.Get('leafIndex'), 7);
  const committed = await conn._sendSingleRequest(req);
  assert.equal(committed.Get('batchId'), undefined);
  const garbled = await conn._sendSingleRequest(req);
  assert.equal(garbled.IsCommitted(), true, 'an unreadable 202 body is still an accepted write');
  assert.equal(garbled.Get('batchId'), undefined);
});

test('txlog: the batch placement lands in the line; a line without one is unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txlog-'));
  const script = `
    const { TxStatus } = require('@hyperledger/caliper-core');
    const txlog = require(${JSON.stringify(path.join(BENCH, 'workload', 'lib', 'txlog.js'))});
    const a = new TxStatus(); a.SetStatusSuccess(); a.Set('batchId', 'case-001-e1-b000003'); a.Set('leafIndex', 7);
    const d = new TxStatus(); d.SetStatusSuccess();
    txlog.log(0, 'slice0', 'ACCESS', 'case-001', 'ev-1', a);
    txlog.log(0, 'slice0', 'CREATE', null, 'ev-2', d);`;
  execFileSync(process.execPath, ['-e', script], { cwd: BENCH, env: { ...process.env, GLEIPNIR_TXLOG_DIR: dir } });
  const [anchored, direct] = fs.readFileSync(path.join(dir, 'tx-w0.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(anchored.batchId, 'case-001-e1-b000003');
  assert.equal(anchored.leafIndex, 7);
  assert.deepEqual(Object.keys(direct),
    ['round', 'op', 'caseId', 'evidenceId', 'tCreate', 'tFinal', 'latencyMs', 'ok', 'err', 'timed']);
  assert.equal(direct.ok, true);
});
