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

test('M18: pre-M18 case_participants table (two-role CHECK) is rebuilt in place, keeping rows', async (t) => {
  const Database = require('better-sqlite3');
  const dir = tmpDataDir();

  // Hand-create a database with the M13-era DDL (no 'lead' in the CHECK).
  {
    const db = new Database(path.join(dir, 'case-registry.db'));
    db.exec(`
      CREATE TABLE cases (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','ARCHIVED')),
        created_by  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE TABLE case_participants (
        case_id      TEXT NOT NULL REFERENCES cases(id),
        user_id      TEXT NOT NULL,
        role_in_case TEXT NOT NULL DEFAULT 'viewer' CHECK (role_in_case IN ('viewer','contributor')),
        added_by     TEXT NOT NULL,
        added_at     TEXT NOT NULL,
        PRIMARY KEY (case_id, user_id)
      );
      CREATE INDEX idx_participants_user ON case_participants(user_id);
      INSERT INTO cases VALUES ('CASE-legacy', 'old case', '', 'OPEN', 'root', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
      INSERT INTO case_participants VALUES ('CASE-legacy', 'ivy', 'viewer', 'root', '2026-07-01T00:00:00Z');
    `);
    db.close();
  }

  const url = await start(t, dir);
  // Legacy row survived the rebuild...
  const detail = await json(await call(url, 'GET', '/cases/CASE-legacy'));
  assert.deepEqual(detail.participants.map((p) => [p.userId, p.roleInCase]), [['ivy', 'viewer']]);
  // ...and the rebuilt CHECK admits 'lead'.
  const granted = await call(url, 'POST', '/cases/CASE-legacy/participants', { userId: 'lena', roleInCase: 'lead', addedBy: 'root' });
  assert.equal(granted.status, 201);

  // Idempotence: a second boot from the same dir must not touch the table.
  const url2 = await start(t, dir);
  const again = await json(await call(url2, 'GET', '/cases/CASE-legacy'));
  assert.equal(again.participants.length, 2);
});

test('M18: participant-scoped case listings carry myRoleInCase; unscoped listings do not', async (t) => {
  const url = await start(t);
  const c = await makeCase(url);
  await call(url, 'POST', `/cases/${c.id}/participants`, { userId: 'lena', roleInCase: 'lead', addedBy: 'root' });

  const scoped = await json(await call(url, 'GET', '/cases?participant=lena'));
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].myRoleInCase, 'lead');

  const unscoped = await json(await call(url, 'GET', '/cases'));
  assert.equal(unscoped[0].myRoleInCase, undefined);

  // roleInCase validation now includes lead; junk is still rejected.
  const bad = await call(url, 'POST', `/cases/${c.id}/participants`, { userId: 'x', roleInCase: 'boss' });
  assert.equal(bad.status, 400);
});

test('M19: category CRUD — dup 409, cross-case 400, in-use delete 409', async (t) => {
  const url = await start(t);
  const c1 = await makeCase(url, 'cat case');
  const c2 = await makeCase(url, 'other case');

  const cat = await json(await call(url, 'POST', `/cases/${c1.id}/categories`, { name: 'Mobile Devices', createdBy: 'lena' }));
  assert.match(cat.id, /^cat-/);
  assert.equal(cat.caseId, c1.id);
  assert.equal((await call(url, 'POST', `/cases/${c1.id}/categories`, { name: 'Mobile Devices', createdBy: 'lena' })).status, 409);
  assert.equal((await call(url, 'POST', '/cases/CASE-ghost/categories', { name: 'x', createdBy: 'lena' })).status, 404);

  const listed = await json(await call(url, 'GET', `/cases/${c1.id}/categories`));
  assert.deepEqual(listed.map((x) => x.name), ['Mobile Devices']);
  // ...and the case detail carries them too.
  assert.equal((await json(await call(url, 'GET', `/cases/${c1.id}`))).categories.length, 1);

  const renamed = await json(await call(url, 'PATCH', `/cases/${c1.id}/categories/${cat.id}`, { name: 'Network PCAP' }));
  assert.equal(renamed.name, 'Network PCAP');
  // A category is invisible through the wrong case path.
  assert.equal((await call(url, 'PATCH', `/cases/${c2.id}/categories/${cat.id}`, { name: 'x' })).status, 404);

  // Evidence pinned to the category blocks deletion; clearing it unblocks.
  await indexEvidence(url, 'ev-cat', { caseId: c1.id, categoryId: cat.id });
  assert.equal((await call(url, 'DELETE', `/cases/${c1.id}/categories/${cat.id}`)).status, 409);
  await call(url, 'PATCH', '/evidence-index/ev-cat', { categoryId: null });
  assert.equal((await call(url, 'DELETE', `/cases/${c1.id}/categories/${cat.id}`)).status, 204);

  // A category from another case is refused on evidence rows.
  const catB = await json(await call(url, 'POST', `/cases/${c2.id}/categories`, { name: 'Cloud', createdBy: 'lena' }));
  assert.equal((await call(url, 'PATCH', '/evidence-index/ev-cat', { categoryId: catB.id })).status, 400);
});

test('M19: metadata fields set at registration and via PATCH; uncategorize clears the category', async (t) => {
  const url = await start(t);
  const c = await makeCase(url, 'meta case');
  const cat = await json(await call(url, 'POST', `/cases/${c.id}/categories`, { name: 'Physical Media', createdBy: 'lena' }));

  const row = await json(await indexEvidence(url, 'ev-meta', {
    caseId: c.id, categoryId: cat.id, label: 'ITEM-001',
    seizedAt: '2026-07-15T09:30:00Z', acquisitionLocation: 'Suspect desk drawer', handedOverBy: 'Officer Blue',
  }));
  assert.equal(row.label, 'ITEM-001');
  assert.equal(row.categoryId, cat.id);
  assert.equal(row.seizedAt, '2026-07-15T09:30:00Z');
  assert.equal(row.acquisitionLocation, 'Suspect desk drawer');
  assert.equal(row.handedOverBy, 'Officer Blue');

  // PATCH sets and clears; junk types are 400.
  const patched = await json(await call(url, 'PATCH', '/evidence-index/ev-meta', { label: 'ITEM-002', handedOverBy: null }));
  assert.equal(patched.label, 'ITEM-002');
  assert.equal(patched.handedOverBy, null);
  assert.equal((await call(url, 'PATCH', '/evidence-index/ev-meta', { label: 42 })).status, 400);

  // Uncategorizing the evidence clears its case-scoped category.
  await call(url, 'DELETE', `/cases/${c.id}/evidence/ev-meta`);
  const after = await json(await call(url, 'GET', '/evidence-index/ev-meta'));
  assert.equal(after.caseId, null);
  assert.equal(after.categoryId, null);
  assert.equal(after.label, 'ITEM-002'); // non-case metadata survives
});

test('M19: pre-M19 evidence_index (no metadata columns) gains them on boot, idempotently', async (t) => {
  const Database = require('better-sqlite3');
  const dir = tmpDataDir();
  {
    const db = new Database(path.join(dir, 'case-registry.db'));
    db.exec(`
      CREATE TABLE cases (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','ARCHIVED')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE case_participants (
        case_id TEXT NOT NULL REFERENCES cases(id), user_id TEXT NOT NULL,
        role_in_case TEXT NOT NULL DEFAULT 'viewer' CHECK (role_in_case IN ('viewer','contributor','lead')),
        added_by TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (case_id, user_id)
      );
      CREATE TABLE evidence_index (
        evidence_id TEXT PRIMARY KEY, case_id TEXT NULL REFERENCES cases(id),
        original_filename TEXT, mime_type TEXT, size_bytes INTEGER, integrity_proof TEXT,
        uploaded_by TEXT, uploaded_at TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', last_synced_at TEXT
      );
      INSERT INTO evidence_index (evidence_id, status) VALUES ('ev-old', 'ACTIVE');
    `);
    db.close();
  }

  const url = await start(t, dir);
  const row = await json(await call(url, 'GET', '/evidence-index/ev-old'));
  assert.equal(row.evidenceId, 'ev-old');
  assert.equal(row.label, null);
  // The new columns are writable on the migrated table...
  assert.equal((await call(url, 'PATCH', '/evidence-index/ev-old', { label: 'ITEM-OLD' })).status, 200);
  // ...and a second boot from the same dir is a no-op.
  const url2 = await start(t, dir);
  assert.equal((await json(await call(url2, 'GET', '/evidence-index/ev-old'))).label, 'ITEM-OLD');
});
