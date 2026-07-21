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

// Boots registry + store + gateway; seeds admin 'root', lead 'lena', and
// investigators 'ivy' and 'mallory'. Returns tokens and helpers.
async function bootStack(t) {
  const registryApp = createRegistry({ dataDir: tmp('gleipnir-lib-reg-'), internalToken: INTERNAL });
  const storeApp = createStore({ dataDir: tmp('gleipnir-lib-blob-'), internalToken: INTERNAL });
  const registry = await listen(registryApp);
  const store = await listen(storeApp);

  const users = makeUsersStore(tmp('gleipnir-lib-auth-'));
  const sessions = makeSessions({ ttlSeconds: 3600 });
  users.seedAdmin({ username: 'root', password: 'pw' });
  users.create({ username: 'lena', password: 'pw', role: 'lead' });
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
  const tokens = { root: await login('root'), lena: await login('lena'), ivy: await login('ivy'), mallory: await login('mallory'), service: 'service-token' };

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

test('M15: the auto-log is synchronous — a failed log write fails the view, and no event is half-recorded', SKIP, async (t) => {
  const s = await bootStack(t);
  await s.upload('ivy', Buffer.from('sync-proof'), { evidenceId: 'ev-sync' });
  assert.equal(await s.auditLen('ivy', 'ev-sync'), 1);

  // Arm a one-shot submit failure: reads evaluate (unaffected), so the next
  // SUBMIT is exactly the auto AccessLog(view) — the view request must fail.
  s.fabric.failNextSubmit.value = true;
  const r = await fetch(`${s.url}/api/v1/evidence/ev-sync`, { headers: s.as('ivy') });
  assert.equal(r.status, 502);
  assert.equal(await s.auditLen('ivy', 'ev-sync'), 1); // trail did NOT grow

  // ...and the same view succeeds (and logs) once the chain is healthy again.
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sync`, { headers: s.as('ivy') })).status, 200);
  assert.equal(await s.auditLen('ivy', 'ev-sync'), 2);
});

test('M15: audit-trail reads and searches are never auto-logged', SKIP, async (t) => {
  const s = await bootStack(t);
  await s.upload('ivy', Buffer.from('quiet'), { evidenceId: 'ev-quiet' });

  const before = await s.auditLen('ivy', 'ev-quiet');
  await s.auditLen('ivy', 'ev-quiet');
  await s.auditLen('ivy', 'ev-quiet');
  await fetch(`${s.url}/api/v1/evidence/search?q=ev-quiet`, { headers: s.as('ivy') });
  await fetch(`${s.url}/api/v1/cases/search?q=anything`, { headers: s.as('ivy') });
  assert.equal(await s.auditLen('ivy', 'ev-quiet'), before);
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

test('M18: leads create and own cases; investigators cannot; lead manages only their own roster', SKIP, async (t) => {
  const s = await bootStack(t);

  // A lead creates a case and lands on its roster as case lead.
  const created = await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'Op Lead' }) });
  assert.equal(created.status, 201);
  const c = await created.json();
  assert.equal(c.createdBy, 'lena');
  const detail = await (await fetch(`${s.url}/api/v1/cases/${c.id}`, { headers: s.as('lena') })).json();
  assert.deepEqual(detail.participants.map((p) => [p.userId, p.roleInCase]), [['lena', 'lead']]);

  // The listing carries the caller's own case role.
  const mine = await (await fetch(`${s.url}/api/v1/cases`, { headers: s.as('lena') })).json();
  assert.equal(mine[0].myRoleInCase, 'lead');

  // Lead manages their own roster; granting case-lead to a non-lead user is refused.
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) })).status, 201);
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'mallory', roleInCase: 'lead' }) })).status, 400);

  // A lead ingests directly into their case (case-lead implies write).
  assert.equal((await s.upload('lena', Buffer.from('by the lead'), { evidenceId: 'ev-lead', caseId: c.id })).status, 201);

  // Removing the last case lead is refused for the lead; an admin may.
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/participants/lena`, { method: 'DELETE', headers: s.as('lena') })).status, 409);
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/participants/lena`, { method: 'DELETE', headers: s.as('root') })).status, 204);

  // Cases the lead does not lead are unmanageable: a foreign case 404s
  // (non-participant) and a case where they are a mere contributor 403s.
  const other = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ name: 'not yours' }) })).json();
  assert.equal((await fetch(`${s.url}/api/v1/cases/${other.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy' }) })).status, 404);
  await fetch(`${s.url}/api/v1/cases/${other.id}/participants`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ userId: 'lena', roleInCase: 'contributor' }) });
  assert.equal((await fetch(`${s.url}/api/v1/cases/${other.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy' }) })).status, 403);

  // Investigators still cannot create cases; the service token never could.
  assert.equal((await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('ivy'), body: JSON.stringify({ name: 'x' }) })).status, 403);
  assert.equal((await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('service'), body: JSON.stringify({ name: 'x' }) })).status, 403);

  // Admin creation with a designated lead; a non-lead designee is a 400.
  const handed = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ name: 'handed over', leadUserId: 'lena' }) })).json();
  const handedDetail = await (await fetch(`${s.url}/api/v1/cases/${handed.id}`, { headers: s.as('lena') })).json();
  assert.deepEqual(handedDetail.participants.map((p) => [p.userId, p.roleInCase]), [['lena', 'lead']]);
  assert.equal((await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ name: 'bad hand', leadUserId: 'ivy' }) })).status, 400);
});

test('M18: admins read metadata and trails everywhere but blob content only as a participant', SKIP, async (t) => {
  const s = await bootStack(t);

  // Build a case root does NOT participate in, with one exhibit.
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'sealed' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  await s.upload('ivy', Buffer.from('sealed bytes'), { evidenceId: 'ev-sealed', caseId: c.id });

  // Admin: metadata, audit, export all pass; blob content is refused.
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sealed`, { headers: s.as('root') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sealed/audit`, { headers: s.as('root') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sealed/export`, { headers: s.as('root') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sealed/download`, { headers: s.as('root') })).status, 403);

  // Participants and the service token still download fine.
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sealed/download`, { headers: s.as('ivy') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sealed/download`, { headers: s.as('service') })).status, 200);

  // Once the admin joins the case (any role), content opens up.
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('root'), body: JSON.stringify({ userId: 'root', roleInCase: 'viewer' }) });
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-sealed/download`, { headers: s.as('root') })).status, 200);
});

test('M25: role ladder — remove is lead-only; participant role PATCH policy', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'ladder' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'mallory', roleInCase: 'viewer' }) });
  await s.upload('ivy', Buffer.from('x'), { evidenceId: 'ev-ladder', caseId: c.id });

  // Contributor (even the uploader) and viewer cannot remove case evidence; the lead can.
  const del = (who) => fetch(`${s.url}/api/v1/evidence/ev-ladder`, { method: 'DELETE', headers: s.asJson(who), body: JSON.stringify({ reason: 'x' }) });
  assert.equal((await del('ivy')).status, 403);
  assert.equal((await del('mallory')).status, 403);
  assert.equal((await del('lena')).status, 201);

  // Role PATCH: the lead promotes/demotes in place; enum junk 400s upstream.
  const patchRole = (who, userId, roleInCase) => fetch(`${s.url}/api/v1/cases/${c.id}/participants/${userId}`, {
    method: 'PATCH', headers: s.asJson(who), body: JSON.stringify({ roleInCase }),
  });
  assert.equal((await patchRole('lena', 'mallory', 'contributor')).status, 200);
  const detail = await (await fetch(`${s.url}/api/v1/cases/${c.id}`, { headers: s.as('lena') })).json();
  assert.equal(detail.participants.find((p) => p.userId === 'mallory').roleInCase, 'contributor');

  // Case-lead grants still need a global-lead target; a contributor may not call at all.
  assert.equal((await patchRole('lena', 'ivy', 'lead')).status, 400);
  assert.equal((await patchRole('ivy', 'mallory', 'viewer')).status, 403);

  // Demoting the case's only lead: refused for the lead, allowed for the admin.
  assert.equal((await patchRole('lena', 'lena', 'contributor')).status, 409);
  assert.equal((await patchRole('root', 'lena', 'contributor')).status, 200);
});

test('M19: category management is lead-gated; reading follows case visibility', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'taxonomy' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });

  // Lead creates; contributor cannot; outsider can't even see the case.
  const created = await fetch(`${s.url}/api/v1/cases/${c.id}/categories`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'Mobile Devices' }) });
  assert.equal(created.status, 201);
  const cat = await created.json();
  assert.equal(cat.createdBy, 'lena');
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/categories`, { method: 'POST', headers: s.asJson('ivy'), body: JSON.stringify({ name: 'Nope' }) })).status, 403);
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/categories`, { headers: s.as('mallory') })).status, 404);

  // Participants and admins list them (M25: alongside the seeded presets).
  assert.ok((await (await fetch(`${s.url}/api/v1/cases/${c.id}/categories`, { headers: s.as('ivy') })).json()).map((x) => x.name).includes('Mobile Devices'));
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/categories`, { headers: s.as('root') })).status, 200);
});

test('M19: ingest carries forensic metadata to the read-model; the on-chain head is untouched', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'meta case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  const cat = await (await fetch(`${s.url}/api/v1/cases/${c.id}/categories`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'Disk Images' }) })).json();

  const up = await s.upload('ivy', Buffer.from('imaged disk'), {
    evidenceId: 'ev-meta', caseId: c.id, categoryId: cat.id, label: 'ITEM-001',
    seizedAt: '2026-07-15T09:30:00Z', acquisitionLocation: 'Server room rack 2', handedOverBy: 'Officer Blue',
  });
  assert.equal(up.status, 201);

  const row = (await (await fetch(`${s.url}/api/v1/evidence/search?q=ev-meta`, { headers: s.as('ivy') })).json())[0];
  assert.equal(row.label, 'ITEM-001');
  assert.equal(row.categoryId, cat.id);
  assert.equal(row.seizedAt, '2026-07-15T09:30:00Z');
  assert.equal(row.acquisitionLocation, 'Server room rack 2');
  assert.equal(row.handedOverBy, 'Officer Blue');

  // The Codex-Entry head carries NONE of the library metadata.
  const head = JSON.parse(s.fabric.submits.find((x) => x.fn === 'CreateEvidence').args[1]);
  assert.equal(head.label, undefined);
  assert.equal(head.categoryId, undefined);
  assert.equal(head.seizedAt, undefined);

  // A category from the wrong case fails BEFORE anything is written: the id
  // stays reusable (no blob, no chain commit).
  const other = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'wrong case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${other.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  const bad = await s.upload('ivy', Buffer.from('x'), { evidenceId: 'ev-badcat', caseId: other.id, categoryId: cat.id });
  assert.equal(bad.status, 400);
  assert.equal((await s.upload('ivy', Buffer.from('x'), { evidenceId: 'ev-badcat', caseId: other.id })).status, 201);
});

test('M19: evidence details PATCH is write-gated; viewers cannot, contributors and admins can', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'details' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'mallory', roleInCase: 'viewer' }) });
  await s.upload('ivy', Buffer.from('detail bytes'), { evidenceId: 'ev-details', caseId: c.id });

  const patch = (who, body) => fetch(`${s.url}/api/v1/evidence/ev-details/details`, { method: 'PATCH', headers: s.asJson(who), body: JSON.stringify(body) });
  assert.equal((await patch('mallory', { label: 'ITEM-X' })).status, 403);
  const ok = await patch('ivy', { label: 'ITEM-001', acquisitionLocation: 'Front desk' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).label, 'ITEM-001');
  assert.equal((await patch('root', { handedOverBy: 'Desk Sgt.' })).status, 200); // metadata: admin bypass applies

  // Details PATCHes are library metadata, not evidence access: no auto-log.
  assert.equal(await s.auditLen('ivy', 'ev-details'), 1); // CREATE only
});

test('M20: notes follow read/write gates; sessions stamp the author; nothing auto-logs', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'notes case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'mallory', roleInCase: 'viewer' }) });
  await s.upload('ivy', Buffer.from('note target'), { evidenceId: 'ev-notes', caseId: c.id });

  // Contributor posts; the client-supplied author is overridden by the session.
  const posted = await fetch(`${s.url}/api/v1/evidence/ev-notes/notes`, {
    method: 'POST', headers: s.asJson('ivy'), body: JSON.stringify({ author: 'someone-else', body: 'chain of custody intact' }),
  });
  assert.equal(posted.status, 201);
  assert.equal((await posted.json()).author, 'ivy');

  // Viewer reads but cannot post; outsider sees nothing.
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-notes/notes`, { headers: s.as('mallory') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-notes/notes`, { method: 'POST', headers: s.asJson('mallory'), body: JSON.stringify({ body: 'nope' }) })).status, 403);

  // Service token: full bypass and the client author is honored.
  const svc = await fetch(`${s.url}/api/v1/evidence/ev-notes/notes`, {
    method: 'POST', headers: s.asJson('service'), body: JSON.stringify({ author: 'caliper-worker-3', body: 'load note' }),
  });
  assert.equal(svc.status, 201);
  assert.equal((await svc.json()).author, 'caliper-worker-3');

  // Flag: write-gated, echoed on the read model.
  assert.equal((await fetch(`${s.url}/api/v1/evidence/ev-notes/flag`, { method: 'PUT', headers: s.asJson('mallory'), body: JSON.stringify({ flag: 'PROCESSED' }) })).status, 403);
  const flagged = await fetch(`${s.url}/api/v1/evidence/ev-notes/flag`, { method: 'PUT', headers: s.asJson('ivy'), body: JSON.stringify({ flag: 'NEEDS_LEAD_REVIEW' }) });
  assert.equal(flagged.status, 200);
  assert.equal((await flagged.json()).flag, 'NEEDS_LEAD_REVIEW');
  const found = await (await fetch(`${s.url}/api/v1/evidence/search?flag=NEEDS_LEAD_REVIEW`, { headers: s.as('ivy') })).json();
  assert.deepEqual(found.map((r) => r.evidenceId), ['ev-notes']);

  // None of it touched the on-chain trail: CREATE only.
  assert.equal(await s.auditLen('ivy', 'ev-notes'), 1);
});

test('M20: the case activity feed follows case visibility and reflects the collaboration', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'feed case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  await s.upload('ivy', Buffer.from('feed exhibit'), { evidenceId: 'ev-feed', caseId: c.id, label: 'ITEM-007' });
  await fetch(`${s.url}/api/v1/evidence/ev-feed/notes`, { method: 'POST', headers: s.asJson('ivy'), body: JSON.stringify({ body: 'first note' }) });

  const feed = await (await fetch(`${s.url}/api/v1/cases/${c.id}/activity`, { headers: s.as('ivy') })).json();
  const types = feed.map((e) => e.type);
  assert.ok(types.includes('CASE_CREATED') && types.includes('PARTICIPANT_ADDED') && types.includes('EVIDENCE_ADDED') && types.includes('NOTE_ADDED'), String(types));
  assert.equal(feed.find((e) => e.type === 'EVIDENCE_ADDED').detail.label, 'ITEM-007');

  // Participant and admin read it; outsiders get 404.
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/activity`, { headers: s.as('root') })).status, 200);
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/activity`, { headers: s.as('mallory') })).status, 404);

  // M25b: management actions are audited persistently with the SESSION actor —
  // a removal leaves a log row even though the participant row is gone.
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants/ivy`, { method: 'PATCH', headers: s.asJson('lena'), body: JSON.stringify({ roleInCase: 'viewer' }) });
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants/ivy`, { method: 'DELETE', headers: s.as('lena') });
  const after = await (await fetch(`${s.url}/api/v1/cases/${c.id}/activity`, { headers: s.as('lena') })).json();
  const roleChanged = after.find((e) => e.type === 'PARTICIPANT_ROLE_CHANGED');
  assert.deepEqual({ actor: roleChanged.actor, target: roleChanged.target, detail: roleChanged.detail },
    { actor: 'lena', target: 'ivy', detail: { from: 'contributor', to: 'viewer' } });
  const removedEvt = after.find((e) => e.type === 'PARTICIPANT_REMOVED');
  assert.equal(removedEvt.actor, 'lena');
  assert.equal(removedEvt.target, 'ivy');
});

// Regression: both of these reach the registry through PATCH /evidence-index/:id,
// whose audit rows take the actor from the X-Gleipnir-Actor header. They were the
// only mutating registry calls that omitted the opts argument, so the flag and
// details events landed in the persistent case audit log with an EMPTY actor —
// an unattributed entry in a chain-of-custody log (CONTRACTS §6: under a user
// session the audit actor is ALWAYS the authenticated username).
test('M25b: flag and details changes are actor-attributed in the case audit log', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'attribution case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  await s.upload('ivy', Buffer.from('attributed exhibit'), { evidenceId: 'ev-attr', caseId: c.id, label: 'ITEM-042' });

  await fetch(`${s.url}/api/v1/evidence/ev-attr/flag`, { method: 'PUT', headers: s.asJson('ivy'), body: JSON.stringify({ flag: 'HIGH_PRIORITY' }) });
  await fetch(`${s.url}/api/v1/evidence/ev-attr/details`, { method: 'PATCH', headers: s.asJson('ivy'), body: JSON.stringify({ acquisitionLocation: 'evidence locker B' }) });

  const feed = await (await fetch(`${s.url}/api/v1/cases/${c.id}/activity`, { headers: s.as('ivy') })).json();
  const flagEvt = feed.find((e) => e.type === 'FLAG_CHANGED');
  assert.ok(flagEvt, `no FLAG_CHANGED in ${feed.map((e) => e.type)}`);
  assert.equal(flagEvt.actor, 'ivy');
  assert.deepEqual(flagEvt.detail, { from: null, to: 'HIGH_PRIORITY' });

  const detailsEvt = feed.find((e) => e.type === 'EVIDENCE_DETAILS_UPDATED');
  assert.ok(detailsEvt, `no EVIDENCE_DETAILS_UPDATED in ${feed.map((e) => e.type)}`);
  assert.equal(detailsEvt.actor, 'ivy');

  // The service path keeps its contract: no session, so no session attribution
  // is forced onto the row (it must not be stamped with a user identity).
  await fetch(`${s.url}/api/v1/evidence/ev-attr/flag`, { method: 'PUT', headers: s.asJson('service'), body: JSON.stringify({ flag: 'PROCESSED' }) });
  const feed2 = await (await fetch(`${s.url}/api/v1/cases/${c.id}/activity`, { headers: s.as('ivy') })).json();
  const svcFlag = feed2.find((e) => e.type === 'FLAG_CHANGED' && e.detail && e.detail.to === 'PROCESSED');
  assert.ok(svcFlag, 'service-token flag change not recorded');
  assert.ok(!svcFlag.actor, `service path must not stamp a user actor, got ${svcFlag.actor}`);
});

test('M24: per-case CoC report — json + csv shapes, authz, and exactly one ACCESS per evidence for sessions', SKIP, async (t) => {
  const s = await bootStack(t);
  const c = await (await fetch(`${s.url}/api/v1/cases`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'court case' }) })).json();
  await fetch(`${s.url}/api/v1/cases/${c.id}/participants`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ userId: 'ivy', roleInCase: 'contributor' }) });
  const cat = await (await fetch(`${s.url}/api/v1/cases/${c.id}/categories`, { method: 'POST', headers: s.asJson('lena'), body: JSON.stringify({ name: 'Media' }) })).json();
  await s.upload('ivy', Buffer.from('exhibit A'), { evidenceId: 'ev-rep-a', caseId: c.id, label: 'ITEM-001', categoryId: cat.id });
  await s.upload('ivy', Buffer.from('exhibit B'), { evidenceId: 'ev-rep-b', caseId: c.id, label: 'ITEM-002' });

  // Outsiders can't see it; participants and admins can.
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/coc-report`, { headers: s.as('mallory') })).status, 404);

  const asIvy = await fetch(`${s.url}/api/v1/cases/${c.id}/coc-report`, { headers: s.as('ivy') });
  assert.equal(asIvy.status, 200);
  const report = await asIvy.json();
  assert.equal(report.caseId, c.id);
  assert.deepEqual(report.evidence.map((e) => e.evidenceId), ['ev-rep-a', 'ev-rep-b']);
  assert.equal(report.evidence[0].category, 'Media');
  // The report shows the pre-report trails (1 CREATE each)...
  assert.equal(report.evidence[0].auditTrail.length, 1);
  // ...and the report itself appended exactly one ACCESS per evidence.
  assert.equal(await s.auditLen('ivy', 'ev-rep-a'), 2);
  assert.equal(await s.auditLen('ivy', 'ev-rep-b'), 2);
  const reportActs = s.fabric.submits.filter((x) => x.fn === 'AccessLog' && x.args[2] === 'coc-report');
  assert.deepEqual(reportActs.map((x) => x.args[1]), ['ivy', 'ivy']);

  // CSV: header + one row per event, all cells quoted, attachment headers.
  const csvRes = await fetch(`${s.url}/api/v1/cases/${c.id}/coc-report?format=csv`, { headers: s.as('root') });
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get('content-type') || '', /text\/csv/);
  assert.match(csvRes.headers.get('content-disposition') || '', /attachment; filename="coc-CASE-/);
  const csv = await csvRes.text();
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], '"caseId","caseName","evidenceLabel","evidenceId","originalFilename","category","integrityProof","eventId","op","actor","ts","detail"');
  // 2 evidence x (CREATE + ivy's coc-report ACCESS) = 4 event rows minimum.
  assert.ok(lines.length >= 5, csv);
  assert.ok(lines.some((l) => l.includes('"ITEM-001"') && l.includes('"CREATE"')), csv);

  // The service token gets the report without growing any trail.
  const before = await s.auditLen('service', 'ev-rep-a');
  assert.equal((await fetch(`${s.url}/api/v1/cases/${c.id}/coc-report`, { headers: s.as('service') })).status, 200);
  assert.equal(await s.auditLen('service', 'ev-rep-a'), before);
});
