'use strict';

// M13c integration suite: the gateway wired to the REAL case-registry and
// evidence-store apps (in-process, tmp dirs, public createApp exports) with a
// fake Fabric that replays an audit trail. This is the wire-contract test for
// upload -> on-chain head -> read-model, per-case authz, and the synchronous
// auto-AccessLog invariant. If the sibling services' node_modules are not
// installed, the whole suite skips with a hint instead of erroring.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { makeUsersStore } = require('../src/users');
const { makeSessions } = require('../src/sessions');
const { makeCaseRegistryClient, makeEvidenceStoreClient } = require('../src/serviceClients');

let createRegistry = null;
let createStore = null;
try {
  ({ createApp: createRegistry } = require('../../services/case-registry/src/index'));
  ({ createApp: createStore } = require('../../services/evidence-store/src/index'));
} catch { /* run `npm install` in services/case-registry and services/evidence-store */ }
const SKIP = { skip: createRegistry ? false : 'sibling services not installed' };

const INTERNAL = 'test-internal-token';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// Fake Fabric that records submits and replays an audit trail per evidenceId,
// so trail-growth assertions run without a live network.
function fakeFabric() {
  const events = new Map();
  const submits = [];
  const push = (id, ev) => events.set(id, [...(events.get(id) || []), ev]);
  return {
    submits,
    failNextSubmit: { value: false },
    async submit(channel, fn, args) {
      if (this.failNextSubmit.value) {
        this.failNextSubmit.value = false;
        throw new Error('endorsement failure (injected)');
      }
      submits.push({ channel, fn, args });
      if (fn === 'CreateEvidence') push(args[0], { op: 'CREATE', actor: (JSON.parse(args[1]).identity || {}).subject || '' });
      if (fn === 'TransferCustody') push(args[0], { op: 'TRANSFER', actor: args[1] });
      if (fn === 'AccessLog') push(args[0], { op: 'ACCESS', actor: args[1], detail: { action: args[2] } });
      if (fn === 'RemoveEvidence') push(args[0], { op: 'REMOVE', actor: '' });
      return `tx-${submits.length}`;
    },
    async evaluate(_channel, fn, args) {
      if (fn === 'GetAuditTrail') return JSON.stringify(events.get(args[0]) || []);
      return JSON.stringify({ id: args[0], status: 'ACTIVE' });
    },
  };
}

// Boots registry + store + gateway; seeds admin 'root' and investigators
// 'ivy' and 'mallory'. Returns tokens and helpers.
async function bootStack(t) {
  const registryApp = createRegistry({ dataDir: tmp('gleipnir-lib-reg-'), internalToken: INTERNAL });
  const storeApp = createStore({ dataDir: tmp('gleipnir-lib-blob-'), internalToken: INTERNAL });
  const registry = await listen(registryApp);
  const store = await listen(storeApp);

  const users = makeUsersStore(tmp('gleipnir-lib-auth-'));
  const sessions = makeSessions({ ttlSeconds: 3600 });
  users.seedAdmin({ username: 'root', password: 'pw' });
  users.create({ username: 'ivy', password: 'pw' });
  users.create({ username: 'mallory', password: 'pw' });

  const fabric = fakeFabric();
  const app = createApp({
    fabric,
    batcher: { async enqueue() { throw new Error('not used in standard'); } },
    runsStore: { async create(r) { return { runId: 'req-1', request: r }; }, async list() { return []; }, async get() { return null; } },
    users,
    sessions,
    caseRegistry: makeCaseRegistryClient(registry.url, INTERNAL),
    evidenceStore: makeEvidenceStoreClient(store.url, INTERNAL),
    config: { variant: 'standard', token: 'service-token', defaultChannel: 'coc-main' },
  });
  const gw = await listen(app);
  t.after(() => {
    gw.server.close();
    registry.server.close();
    store.server.close();
    registryApp.locals.db.close();
  });

  const login = async (username) => {
    const r = await fetch(`${gw.url}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'pw' }),
    });
    return (await r.json()).token;
  };
  const tokens = { root: await login('root'), ivy: await login('ivy'), mallory: await login('mallory'), service: 'service-token' };

  const as = (who) => ({ authorization: `Bearer ${tokens[who]}` });
  const asJson = (who) => ({ ...as(who), 'content-type': 'application/json' });

  const upload = async (who, bytes, fields = {}, filename = 'note.txt', type = 'text/plain') => {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), filename);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fetch(`${gw.url}/api/v1/evidence`, { method: 'POST', headers: as(who), body: fd });
  };

  const auditLen = async (who, id) => {
    const r = await fetch(`${gw.url}/api/v1/evidence/${id}/audit`, { headers: as(who) });
    assert.equal(r.status, 200);
    return (await r.json()).length;
  };

  return { url: gw.url, fabric, tokens, as, asJson, upload, auditLen };
}

test('multipart ingest: blob stored, head committed with store proof, index registered', SKIP, async (t) => {
  const s = await bootStack(t);
  const bytes = Buffer.from('the quick brown exhibit');

  const r = await s.upload('ivy', bytes, { evidenceId: 'ev-lib-1' });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.evidenceId, 'ev-lib-1');
  const expectedProof = `ni:///sha-256;${crypto.createHash('sha256').update(bytes).digest('base64url')}`;
  assert.equal(body.integrityProof, expectedProof);
  assert.ok(body.txId);

  // on-chain head carries the store pointer + proof, and the actor is the session user
  const create = s.fabric.submits.find((x) => x.fn === 'CreateEvidence');
  const head = JSON.parse(create.args[1]);
  assert.equal(head.storage.protocol, 'gleipnir-evidence-store');
  assert.equal(head.storage.location, 'evidence-store://ev-lib-1');
  assert.equal(head.storage.integrity_proof, expectedProof);
  assert.equal(head.identity.subject, 'ivy');

  // read-model row exists and is uploader-scoped
  const search = await fetch(`${s.url}/api/v1/evidence/search`, { headers: s.as('ivy') });
  const rows = await search.json();
  assert.deepEqual(rows.map((x) => x.evidenceId), ['ev-lib-1']);
  assert.equal(rows[0].originalFilename, 'note.txt');
  assert.equal(rows[0].uploadedBy, 'ivy');

  // duplicate id refused before touching the chain
  assert.equal((await s.upload('ivy', bytes, { evidenceId: 'ev-lib-1' })).status, 409);
  // multipart without a file part is a 400, not a silent JSON create
  const noFile = await fetch(`${s.url}/api/v1/evidence`, {
    method: 'POST', headers: s.as('ivy'), body: (() => { const fd = new FormData(); fd.append('evidenceId', 'x'); return fd; })(),
  });
  assert.equal(noFile.status, 400);
});

test('JSON create path still works untouched with the library configured', SKIP, async (t) => {
  const s = await bootStack(t);
  const r = await fetch(`${s.url}/api/v1/evidence`, {
    method: 'POST',
    headers: s.asJson('service'),
    body: JSON.stringify({ evidenceId: 'ev-json', storage: { protocol: 'file', location: 'blob://x' }, payloadBase64: Buffer.from('hi').toString('base64'), identity: { subject: 'alice' } }),
  });
  assert.equal(r.status, 201);
  const head = JSON.parse(s.fabric.submits.find((x) => x.fn === 'CreateEvidence').args[1]);
  assert.equal(head.storage.protocol, 'file'); // untouched: no store rewrite
  assert.match(head.storage.integrity_proof, /^ni:\/\/\/sha-256;/);
});

test('orphan cleanup: failed chain commit deletes the blob so the id is reusable', SKIP, async (t) => {
  const s = await bootStack(t);
  s.fabric.failNextSubmit.value = true;
  const r1 = await s.upload('ivy', Buffer.from('doomed'), { evidenceId: 'ev-orphan' });
  assert.equal(r1.status, 502);
  // blob was rolled back -> same id succeeds now
  const r2 = await s.upload('ivy', Buffer.from('second try'), { evidenceId: 'ev-orphan' });
  assert.equal(r2.status, 201);
});

test('case lifecycle + scoping: admin-only management, participant-only visibility', SKIP, async (t) => {
  const s = await bootStack(t);

  // admin creates a case; investigator cannot
  assert.equal((await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('ivy'), body: JSON.stringify({ name: 'x' }) })).status, 403);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ name: 'Op Nightjar' }) })).json();
  assert.match(c.id, /^CASE-/);
  assert.equal(c.createdBy, 'root');

  // grant ivy; unknown users are refused
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ userId: 'ghost' }) })).status, 404);
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) })).status, 201);

  // participant sees it; non-participant list is empty and detail 404s
  assert.deepEqual((await (await fetch(`${s.url}/api/v1/cases`, { headers: s.as('ivy') })).json()).map((x) => x.id), [c.id]);
  assert.deepEqual(await (await fetch(`${s.url}/api/v1/cases`, { headers: s.as('mallory') })).json(), []);
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}`, { headers: s.as('mallory') })).status, 404);
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}`, { headers: s.as('ivy') })).status, 200);

  // case search alias works and is scoped
  assert.equal((await (await fetch(`${s.url}/api/v1/cases/search?q=Nightjar`, { headers: s.as('ivy') })).json()).length, 1);
  assert.equal((await (await fetch(`${s.url}/api/v1/cases/search?q=Nightjar`, { headers: s.as('mallory') })).json()).length, 0);
});

test('per-evidence authz: uploader-only while uncategorized; case roles gate reads and writes', SKIP, async (t) => {
  const s = await bootStack(t);
  await s.upload('ivy', Buffer.from('secret'), { evidenceId: 'ev-authz' });

  // uncategorized: uploader reads, others get 403; admin + service bypass
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-authz`, { headers: s.as('ivy') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-authz`, { headers: s.as('mallory') })).status, 403);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-authz`, { headers: s.as('root') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-authz`, { headers: s.as('service') })).status, 200);
  // evidence the library has never seen 404s for investigators
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-ghost`, { headers: s.as('mallory') })).status, 404);

  // put it in a case; mallory joins as VIEWER: read yes, write no
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ name: 'authz case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ userId: 'mallory', roleInCase: 'viewer' }) });
  await fetch(`${s.url}/api/v1/cases/${c.id}/evidence`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ evidenceId: 'ev-authz' }) });

  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-authz`, { headers: s.as('mallory') })).status, 200);
  const denied = await fetch(`${s.url}/api/v1/evidence/ev-authz/transfer`, {
    method: 'POST', headers: s.asJson('mallory'), body: JSON.stringify({ newCustodian: 'mallory', reason: 'grab' }),
  });
  assert.equal(denied.status, 403);
  // ...and ivy (now a non-participant, no longer uploader-of-uncategorized) is shut out
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-authz`, { headers: s.as('ivy') })).status, 403);
});

test('auto-AccessLog: view/download/export each append exactly one ACCESS; service reads never do', SKIP, async (t) => {
  const s = await bootStack(t);
  const bytes = Buffer.from('audited payload');
  await s.upload('ivy', bytes, { evidenceId: 'ev-audit' });
  assert.equal(await s.auditLen('ivy', 'ev-audit'), 1); // CREATE

  // view
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-audit`, { headers: s.as('ivy') })).status, 200);
  assert.equal(await s.auditLen('ivy', 'ev-audit'), 2);

  // download returns the exact bytes and logs
  const dl = await fetch(`${s.url}/api/v1/evidence/ev-audit/download`, { headers: s.as('ivy') });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') || '', /attachment/);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), bytes);
  assert.equal(await s.auditLen('ivy', 'ev-audit'), 3);

  // export bundles record + trail (pre-export trail) and logs
  const ex = await fetch(`${s.url}/api/v1/evidence/ev-audit/export`, { headers: s.as('ivy') });
  assert.equal(ex.status, 200);
  const bundle = await ex.json();
  assert.equal(bundle.evidenceId, 'ev-audit');
  assert.equal(bundle.record.status, 'ACTIVE');
  assert.equal(bundle.auditTrail.length, 3); // trail as of the export moment
  assert.equal(await s.auditLen('ivy', 'ev-audit'), 4); // CREATE + view + download + export

  const acts = s.fabric.submits.filter((x) => x.fn === 'AccessLog').map((x) => x.args);
  assert.deepEqual(acts, [['ev-audit', 'ivy', 'view'], ['ev-audit', 'ivy', 'download'], ['ev-audit', 'ivy', 'export']]);

  // service-token reads NEVER log (Caliper read workloads must not write)
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-audit`, { headers: s.as('service') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-audit/download`, { headers: s.as('service') })).status, 200);
  assert.equal(await s.auditLen('service', 'ev-audit'), 4);
});

test('evidence search scoping and REMOVE status sync', SKIP, async (t) => {
  const s = await bootStack(t);
  await s.upload('ivy', Buffer.from('a'), { evidenceId: 'ev-ivy' });
  await s.upload('mallory', Buffer.from('b'), { evidenceId: 'ev-mal' });

  // each investigator sees only their own uncategorized uploads; admin sees all
  assert.deepEqual((await (await fetch(`${s.url}/api/v1/evidence/search`, { headers: s.as('ivy') })).json()).map((x) => x.evidenceId), ['ev-ivy']);
  assert.equal((await (await fetch(`${s.url}/api/v1/evidence/search`, { headers: s.as('root') })).json()).length, 2);

  // REMOVE syncs the cached status (ledger stays authoritative)
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-ivy`, { method: 'DELETE', headers: s.asJson('ivy'), body: JSON.stringify({ reason: 'disposed' }) })).status, 201);
  const row = (await (await fetch(`${s.url}/api/v1/evidence/search`, { headers: s.as('ivy') })).json())[0];
  assert.equal(row.status, 'REMOVED');
});

test('ingest directly into a case: contributor yes, viewer 403, non-participant 404', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ name: 'ingest case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ userId: 'mallory', roleInCase: 'viewer' }) });

  const ok = await s.upload('ivy', Buffer.from('cased'), { evidenceId: 'ev-cased', caseId: c.id });
  assert.equal(ok.status, 201);
  const detail = await (await fetch(`${s.url}/api/v1/cases/${c.id}`, { headers: s.as('ivy') })).json();
  assert.deepEqual(detail.evidence.map((e) => e.evidenceId), ['ev-cased']);

  assert.equal((await s.upload('mallory', Buffer.from('nope'), { caseId: c.id })).status, 403);
  const c2 = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ name: 'other' }) })).json();
  assert.equal((await s.upload('ivy', Buffer.from('nope'), { caseId: c2.id })).status, 404);
});
