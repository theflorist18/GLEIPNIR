'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/index');

const TOKEN = 'test-internal-token';

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gleipnir-casereg-'));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function start(t, dataDir) {
  const app = createApp({ dataDir: dataDir || tmpDataDir(), internalToken: TOKEN, logLevel: 'silent' });
  const { server, url } = await listen(app);
  t.after(() => { server.close(); app.locals.db.close(); });
  return url;
}

function call(url, method, p, body) {
  return fetch(`${url}${p}`, {
    method,
    headers: { 'x-gleipnir-internal-token': TOKEN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json(res) { return res.json(); }

async function makeCase(url, name = 'Op Nightjar') {
  return json(await call(url, 'POST', '/cases', { name, description: 'test case', createdBy: 'root' }));
}

async function indexEvidence(url, evidenceId, extra) {
  return call(url, 'POST', '/evidence-index', {
    evidenceId,
    originalFilename: 'disk.img',
    mimeType: 'application/octet-stream',
    sizeBytes: 42,
    integrityProof: 'ni:///sha-256;abc',
    uploadedBy: 'ivy',
    ...extra,
  });
}

test('healthz is open; everything else requires the internal token', async (t) => {
  const url = await start(t);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal((await fetch(`${url}/cases`)).status, 401);
  assert.equal((await fetch(`${url}/cases`, { headers: { 'x-gleipnir-internal-token': 'wrong' } })).status, 401);
  assert.equal((await call(url, 'GET', '/cases')).status, 200);
});

test('case create/read/patch lifecycle with CASE-<uuid> ids', async (t) => {
  const url = await start(t);
  const created = await makeCase(url);
  assert.match(created.id, /^CASE-[0-9a-f-]{36}$/);
  assert.equal(created.status, 'OPEN');
  // The library Case id must NEVER collide with the Parallel channel key case-NNN.
  assert.equal(/^case-\d{3}$/.test(created.id), false);

  const read = await json(await call(url, 'GET', `/cases/${created.id}`));
  assert.equal(read.name, 'Op Nightjar');
  assert.deepEqual(read.participants, []);
  assert.deepEqual(read.evidence, []);

  const patched = await json(await call(url, 'PATCH', `/cases/${created.id}`, { status: 'CLOSED', description: 'done' }));
  assert.equal(patched.status, 'CLOSED');
  assert.equal(patched.description, 'done');

  assert.equal((await call(url, 'PATCH', `/cases/${created.id}`, { status: 'NOPE' })).status, 400);
  assert.equal((await call(url, 'GET', '/cases/CASE-missing')).status, 404);
  assert.equal((await call(url, 'POST', '/cases', { name: '', createdBy: 'root' })).status, 400);
});

test('participants: grant, duplicate 409, revoke, 404s', async (t) => {
  const url = await start(t);
  const c = await makeCase(url);

  const granted = await call(url, 'POST', `/cases/${c.id}/participants`, { userId: 'ivy', roleInCase: 'contributor', addedBy: 'root' });
  assert.equal(granted.status, 201);
  assert.equal((await json(granted)).roleInCase, 'contributor');

  assert.equal((await call(url, 'POST', `/cases/${c.id}/participants`, { userId: 'ivy' })).status, 409);
  assert.equal((await call(url, 'POST', `/cases/${c.id}/participants`, { userId: 'bob', roleInCase: 'owner' })).status, 400);
  assert.equal((await call(url, 'POST', '/cases/CASE-missing/participants', { userId: 'ivy' })).status, 404);

  const roster = (await json(await call(url, 'GET', `/cases/${c.id}`))).participants;
  assert.deepEqual(roster.map((p) => p.userId), ['ivy']);

  assert.equal((await call(url, 'DELETE', `/cases/${c.id}/participants/ivy`)).status, 204);
  assert.equal((await call(url, 'DELETE', `/cases/${c.id}/participants/ivy`)).status, 404);
});

test('evidence-index: register once (409 on dup), read, status sync', async (t) => {
  const url = await start(t);
  const created = await indexEvidence(url, 'ev-1');
  assert.equal(created.status, 201);
  const row = await json(created);
  assert.equal(row.caseId, null);
  assert.equal(row.status, 'ACTIVE');

  assert.equal((await indexEvidence(url, 'ev-1')).status, 409);
  assert.equal((await indexEvidence(url, '../escape')).status, 400);
  assert.equal((await indexEvidence(url, 'ev-x', { caseId: 'CASE-missing' })).status, 404);

  const patched = await json(await call(url, 'PATCH', '/evidence-index/ev-1', { status: 'REMOVED' }));
  assert.equal(patched.status, 'REMOVED');
  assert.ok(patched.lastSyncedAt);

  assert.equal((await call(url, 'GET', '/evidence-index/ev-none')).status, 404);
});

test('categorize/uncategorize: idempotent same-case, 409 cross-case, roster reflects it', async (t) => {
  const url = await start(t);
  const c1 = await makeCase(url, 'case one');
  const c2 = await makeCase(url, 'case two');
  await indexEvidence(url, 'ev-1');

  assert.equal((await call(url, 'POST', `/cases/${c1.id}/evidence`, { evidenceId: 'ev-1' })).status, 201);
  // idempotent re-assign to the same case
  assert.equal((await call(url, 'POST', `/cases/${c1.id}/evidence`, { evidenceId: 'ev-1' })).status, 200);
  // one case per evidence item: cross-case assign refused
  assert.equal((await call(url, 'POST', `/cases/${c2.id}/evidence`, { evidenceId: 'ev-1' })).status, 409);
  assert.equal((await call(url, 'POST', `/cases/${c1.id}/evidence`, { evidenceId: 'ev-none' })).status, 404);

  const roster = (await json(await call(url, 'GET', `/cases/${c1.id}`))).evidence;
  assert.deepEqual(roster.map((e) => e.evidenceId), ['ev-1']);
  assert.equal(roster[0].originalFilename, 'disk.img');
  assert.equal(roster[0].uploadedBy, 'ivy');

  assert.equal((await call(url, 'DELETE', `/cases/${c2.id}/evidence/ev-1`)).status, 404);
  assert.equal((await call(url, 'DELETE', `/cases/${c1.id}/evidence/ev-1`)).status, 204);
  assert.equal((await json(await call(url, 'GET', '/evidence-index/ev-1'))).caseId, null);
});

test('case list/search: participant scoping, status filter, q with LIKE-escaping', async (t) => {
  const url = await start(t);
  const c1 = await makeCase(url, 'Alpha 100% match');
  const c2 = await makeCase(url, 'Beta');
  await call(url, 'POST', `/cases/${c1.id}/participants`, { userId: 'ivy' });
  await call(url, 'PATCH', `/cases/${c2.id}`, { status: 'ARCHIVED' });

  const mine = await json(await call(url, 'GET', '/cases?participant=ivy'));
  assert.deepEqual(mine.map((c) => c.id), [c1.id]);

  const archived = await json(await call(url, 'GET', '/cases?status=ARCHIVED'));
  assert.deepEqual(archived.map((c) => c.id), [c2.id]);

  // '%' must match literally, not as a wildcard
  const q = await json(await call(url, 'GET', `/cases?q=${encodeURIComponent('100%')}`));
  assert.deepEqual(q.map((c) => c.id), [c1.id]);
  assert.equal((await json(await call(url, 'GET', '/cases?q=zzz'))).length, 0);

  const all = await json(await call(url, 'GET', '/cases'));
  assert.equal(all.length, 2);
});

test('evidence search: filters + visibleToUserId scoping (participant cases + own uncategorized)', async (t) => {
  const url = await start(t);
  const c1 = await makeCase(url, 'scoped');
  await call(url, 'POST', `/cases/${c1.id}/participants`, { userId: 'ivy' });

  await indexEvidence(url, 'ev-in-case', { caseId: c1.id, originalFilename: 'photo.jpg', mimeType: 'image/jpeg', uploadedBy: 'bob' });
  await indexEvidence(url, 'ev-mine-uncat', { uploadedBy: 'ivy' });
  await indexEvidence(url, 'ev-other-uncat', { uploadedBy: 'bob' });

  const visible = await json(await call(url, 'GET', '/evidence-index?visibleToUserId=ivy'));
  assert.deepEqual(visible.map((e) => e.evidenceId).sort(), ['ev-in-case', 'ev-mine-uncat']);

  const byType = await json(await call(url, 'GET', '/evidence-index?type=image/'));
  assert.deepEqual(byType.map((e) => e.evidenceId), ['ev-in-case']);

  const byName = await json(await call(url, 'GET', `/evidence-index?q=photo`));
  assert.deepEqual(byName.map((e) => e.evidenceId), ['ev-in-case']);

  const byUploader = await json(await call(url, 'GET', '/evidence-index?uploadedBy=ivy'));
  assert.deepEqual(byUploader.map((e) => e.evidenceId), ['ev-mine-uncat']);

  const byCase = await json(await call(url, 'GET', `/evidence-index?caseId=${c1.id}`));
  assert.deepEqual(byCase.map((e) => e.evidenceId), ['ev-in-case']);
});

test('authz pre-flight decision matrix', async (t) => {
  const url = await start(t);
  const c1 = await makeCase(url);
  await call(url, 'POST', `/cases/${c1.id}/participants`, { userId: 'ivy', roleInCase: 'contributor' });
  await indexEvidence(url, 'ev-cased', { caseId: c1.id, uploadedBy: 'bob' });
  await indexEvidence(url, 'ev-uncat', { uploadedBy: 'ivy' });

  const authz = async (userId, evidenceId) => json(await call(url, 'GET', `/internal/authz?userId=${userId}&evidenceId=${evidenceId}`));

  assert.deepEqual(await authz('ivy', 'ev-cased'), { allowed: true, caseId: c1.id, roleInCase: 'contributor' });
  assert.deepEqual(await authz('mallory', 'ev-cased'), { allowed: false, caseId: c1.id, reason: 'not-participant' });
  assert.deepEqual(await authz('ivy', 'ev-uncat'), { allowed: true, caseId: null, roleInCase: 'uploader' });
  assert.deepEqual(await authz('mallory', 'ev-uncat'), { allowed: false, caseId: null, reason: 'uncategorized-not-uploader' });
  assert.deepEqual(await authz('ivy', 'ev-ghost'), { allowed: false, reason: 'unknown-evidence' });
  assert.equal((await call(url, 'GET', '/internal/authz?userId=ivy')).status, 400);
});

test('data persists across reopen from the same dataDir', async (t) => {
  const dir = tmpDataDir();
  {
    const app = createApp({ dataDir: dir, internalToken: TOKEN });
    const { server, url } = await listen(app);
    await makeCase(url, 'durable');
    await indexEvidence(url, 'ev-durable');
    server.close();
    app.locals.db.close();
  }
  const url = await start(t, dir);
  assert.equal((await json(await call(url, 'GET', '/cases'))).length, 1);
  assert.equal((await json(await call(url, 'GET', '/evidence-index/ev-durable'))).evidenceId, 'ev-durable');
});
