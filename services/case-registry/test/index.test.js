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

  const patched = await json(await call(url, 'PATCH', '/evidence-index/ev-1', { status: 'DISPOSED' }));
  assert.equal(patched.status, 'DISPOSED');
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
  assert.ok(listed.some((x) => x.name === 'Mobile Devices'));
  // ...and the case detail carries them too (9 seeded presets + the custom one).
  assert.equal((await json(await call(url, 'GET', `/cases/${c1.id}`))).categories.length, 10);

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

const PRESETS = ['Archive', 'Audio', 'Document', 'Image', 'Other', 'PDF', 'Spreadsheet', 'Text', 'Video'];

test('M25: new cases are seeded with the preset file-type categories', async (t) => {
  const url = await start(t);
  const c = await makeCase(url, 'preset case');
  const cats = await json(await call(url, 'GET', `/cases/${c.id}/categories`));
  assert.deepEqual(cats.map((x) => x.name).sort(), PRESETS);
  assert.ok(cats.every((x) => x.createdBy === 'root'));
  // Seeded rows are ordinary categories: unused ones delete cleanly.
  const img = cats.find((x) => x.name === 'Image');
  assert.equal((await call(url, 'DELETE', `/cases/${c.id}/categories/${img.id}`)).status, 204);
});

test("M25: category listings sort alphabetically with 'Other' pinned last", async (t) => {
  const url = await start(t);
  const c = await makeCase(url, 'order case');
  await call(url, 'POST', `/cases/${c.id}/categories`, { name: 'Zip Bombs', createdBy: 'root' });
  const names = (await json(await call(url, 'GET', `/cases/${c.id}/categories`))).map((x) => x.name);
  assert.equal(names[names.length - 1], 'Other');
  assert.ok(names.indexOf('Zip Bombs') < names.length - 1);
  const detail = await json(await call(url, 'GET', `/cases/${c.id}`));
  assert.equal(detail.categories[detail.categories.length - 1].name, 'Other');
});

test('M25: participant role PATCH — in place, enum-validated, 404 unknown', async (t) => {
  const url = await start(t);
  const c = await makeCase(url);
  await call(url, 'POST', `/cases/${c.id}/participants`, { userId: 'ivy', roleInCase: 'viewer', addedBy: 'root' });

  const up = await json(await call(url, 'PATCH', `/cases/${c.id}/participants/ivy`, { roleInCase: 'contributor' }));
  assert.equal(up.roleInCase, 'contributor');
  const detail = await json(await call(url, 'GET', `/cases/${c.id}`));
  assert.equal(detail.participants.find((p) => p.userId === 'ivy').roleInCase, 'contributor');

  assert.equal((await call(url, 'PATCH', `/cases/${c.id}/participants/ivy`, { roleInCase: 'boss' })).status, 400);
  assert.equal((await call(url, 'PATCH', `/cases/${c.id}/participants/ghost`, { roleInCase: 'viewer' })).status, 404);
});

test('M25: boot backfills presets into zero-category cases only', async (t) => {
  const dataDir = tmpDataDir();
  const url = await start(t, dataDir);
  const c = await makeCase(url, 'pre-M25 case');
  // Strip the case back to zero categories (simulates a pre-seeding case),
  // and set up a second case with a deliberate one-category taxonomy.
  for (const cat of await json(await call(url, 'GET', `/cases/${c.id}/categories`))) {
    assert.equal((await call(url, 'DELETE', `/cases/${c.id}/categories/${cat.id}`)).status, 204);
  }
  const curated = await makeCase(url, 'curated case');
  for (const cat of await json(await call(url, 'GET', `/cases/${curated.id}/categories`))) {
    if (cat.name !== 'Image') await call(url, 'DELETE', `/cases/${curated.id}/categories/${cat.id}`);
  }

  // A second boot on the same volume re-seeds the empty case, not the curated one.
  const url2 = await start(t, dataDir);
  const reseeded = await json(await call(url2, 'GET', `/cases/${c.id}/categories`));
  assert.deepEqual(reseeded.map((x) => x.name).sort(), PRESETS);
  assert.equal(reseeded[0].createdBy, 'root');
  const kept = await json(await call(url2, 'GET', `/cases/${curated.id}/categories`));
  assert.deepEqual(kept.map((x) => x.name), ['Image']);
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

test('M20: notes are append-only — create/list work, no mutation routes exist', async (t) => {
  const url = await start(t);
  await indexEvidence(url, 'ev-notes');

  const n1 = await json(await call(url, 'POST', '/evidence-index/ev-notes/notes', { author: 'ivy', body: 'first pass done' }));
  assert.match(n1.id, /^note-/);
  await call(url, 'POST', '/evidence-index/ev-notes/notes', { author: 'lena', body: 'needs a second look' });

  const listed = await json(await call(url, 'GET', '/evidence-index/ev-notes/notes'));
  assert.deepEqual(listed.map((n) => n.author), ['ivy', 'lena']); // ascending

  // Immutable-by-API: no PATCH/PUT/DELETE surface for a note anywhere.
  assert.equal((await call(url, 'PATCH', `/evidence-index/ev-notes/notes/${n1.id}`, { body: 'rewrite' })).status, 404);
  assert.equal((await call(url, 'DELETE', `/evidence-index/ev-notes/notes/${n1.id}`)).status, 404);

  // Validation + unknown evidence.
  assert.equal((await call(url, 'POST', '/evidence-index/ev-notes/notes', { author: 'ivy', body: '   ' })).status, 400);
  assert.equal((await call(url, 'POST', '/evidence-index/ev-ghost/notes', { author: 'ivy', body: 'x' })).status, 404);
});

test('M20: flag is a strict enum (or null) and searchable', async (t) => {
  const url = await start(t);
  await indexEvidence(url, 'ev-flag');

  assert.equal((await json(await call(url, 'PATCH', '/evidence-index/ev-flag', { flag: 'HIGH_PRIORITY' }))).flag, 'HIGH_PRIORITY');
  assert.equal((await call(url, 'PATCH', '/evidence-index/ev-flag', { flag: 'URGENT' })).status, 400);

  const hits = await json(await call(url, 'GET', '/evidence-index?flag=HIGH_PRIORITY'));
  assert.deepEqual(hits.map((r) => r.evidenceId), ['ev-flag']);
  assert.equal((await call(url, 'GET', '/evidence-index?flag=URGENT')).status, 400);

  assert.equal((await json(await call(url, 'PATCH', '/evidence-index/ev-flag', { flag: null }))).flag, null);
  assert.equal((await json(await call(url, 'GET', '/evidence-index?flag=HIGH_PRIORITY'))).length, 0);
});

test('M25b: the activity feed is the persistent audit log — ts-DESC, actor-attributed, complete', async (t) => {
  const url = await start(t);
  const c = await makeCase(url, 'active case');
  const actorHdr = { 'x-gleipnir-actor': 'root' };
  const callAs = (method, p, body) => fetch(`${url}${p}`, {
    method,
    headers: { 'x-gleipnir-internal-token': TOKEN, ...actorHdr, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  await call(url, 'POST', `/cases/${c.id}/participants`, { userId: 'ivy', roleInCase: 'viewer', addedBy: 'root' });
  await callAs('PATCH', `/cases/${c.id}/participants/ivy`, { roleInCase: 'contributor' });
  await indexEvidence(url, 'ev-act', { caseId: c.id, label: 'ITEM-001' });
  await call(url, 'POST', '/evidence-index/ev-act/notes', { author: 'ivy', body: 'examined' });
  await callAs('PATCH', '/evidence-index/ev-act', { flag: 'PROCESSED' });
  await callAs('PATCH', `/cases/${c.id}`, { status: 'CLOSED' });
  const cat = await json(await call(url, 'POST', `/cases/${c.id}/categories`, { name: 'Ephemeral', createdBy: 'root' }));
  await callAs('DELETE', `/cases/${c.id}/categories/${cat.id}`);
  await callAs('DELETE', `/cases/${c.id}/participants/ivy`);

  const feed = await json(await call(url, 'GET', `/cases/${c.id}/activity`));
  const types = feed.map((e) => e.type);
  for (const expect of ['CASE_CREATED', 'CASE_UPDATED', 'PARTICIPANT_ADDED', 'PARTICIPANT_ROLE_CHANGED',
    'PARTICIPANT_REMOVED', 'EVIDENCE_ADDED', 'NOTE_ADDED', 'FLAG_CHANGED', 'CATEGORY_CREATED', 'CATEGORY_DELETED']) {
    assert.ok(types.includes(expect), `missing ${expect} in ${types}`);
  }
  // ts-DESC ordering; every row has an id (persistent, not synthesized).
  for (let i = 1; i < feed.length; i += 1) {
    assert.ok(feed[i - 1].ts >= feed[i].ts, 'feed not ts-DESC');
  }
  assert.ok(feed.every((e) => /^evt-/.test(e.id)));

  const roleChange = feed.find((e) => e.type === 'PARTICIPANT_ROLE_CHANGED');
  assert.equal(roleChange.actor, 'root');
  assert.equal(roleChange.target, 'ivy');
  assert.deepEqual(roleChange.detail, { from: 'viewer', to: 'contributor' });
  const removed = feed.find((e) => e.type === 'PARTICIPANT_REMOVED');
  assert.equal(removed.target, 'ivy');
  const note = feed.find((e) => e.type === 'NOTE_ADDED');
  assert.equal(note.actor, 'ivy');
  assert.equal(note.evidenceId, 'ev-act');
  // limit applies; unknown case 404s.
  assert.equal((await json(await call(url, 'GET', `/cases/${c.id}/activity?limit=2`))).length, 2);
  assert.equal((await call(url, 'GET', '/cases/CASE-ghost/activity')).status, 404);
});

test('M25b: audit history backfill materializes derivable events once, idempotently', async (t) => {
  const dataDir = tmpDataDir();
  // Boot 1: create history the old-fashioned way (rows only), then wipe the
  // audit table to simulate a pre-M25b volume.
  const app1 = createApp({ dataDir, internalToken: TOKEN, logLevel: 'silent' });
  const { server: s1, url: u1 } = await listen(app1);
  const c = await makeCase(u1, 'historic case');
  await call(u1, 'POST', `/cases/${c.id}/participants`, { userId: 'ivy', roleInCase: 'contributor', addedBy: 'root' });
  await indexEvidence(u1, 'ev-hist', { caseId: c.id });
  app1.locals.db.prepare('DELETE FROM case_audit_log').run();
  s1.close();
  app1.locals.db.close();

  // Boot 2: backfill materializes CASE_CREATED + PARTICIPANT_ADDED + EVIDENCE_ADDED.
  const app2 = createApp({ dataDir, internalToken: TOKEN, logLevel: 'silent' });
  const { server: s2, url: u2 } = await listen(app2);
  const feed = await json(await call(u2, 'GET', `/cases/${c.id}/activity`));
  assert.deepEqual(feed.map((e) => e.type).sort(), ['CASE_CREATED', 'EVIDENCE_ADDED', 'PARTICIPANT_ADDED']);
  assert.equal(feed.find((e) => e.type === 'PARTICIPANT_ADDED').target, 'ivy');
  s2.close();
  app2.locals.db.close();

  // Boot 3: the case now has audit rows — no duplication.
  const app3 = createApp({ dataDir, internalToken: TOKEN, logLevel: 'silent' });
  const { server: s3, url: u3 } = await listen(app3);
  assert.equal((await json(await call(u3, 'GET', `/cases/${c.id}/activity`))).length, 3);
  s3.close();
  app3.locals.db.close();
});

// S19: list/search results are bounded. Default cap plus an optional ?limit
// override (itself capped) so a query can never return an unbounded set.
test('S19: /cases and /evidence-index bound their result sets via ?limit', async (t) => {
  const url = await start(t);
  for (let i = 0; i < 5; i += 1) await makeCase(url, `Case ${i}`);
  const one = await json(await call(url, 'GET', '/cases?limit=1'));
  assert.equal(one.length, 1, '?limit=1 must return at most one case');
  const all = await json(await call(url, 'GET', '/cases'));
  assert.equal(all.length, 5, 'default cap (500) does not clip a small store');

  for (let i = 0; i < 4; i += 1) await indexEvidence(url, `ev-${i}`);
  const ev1 = await json(await call(url, 'GET', '/evidence-index?q=ev-&limit=2'));
  assert.equal(ev1.length, 2, '?limit=2 must cap evidence search');
});
