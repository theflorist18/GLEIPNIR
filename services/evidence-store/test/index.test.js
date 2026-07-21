'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../src/index');

const TOKEN = 'test-internal-token';

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gleipnir-blobs-'));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function start(t, overrides) {
  const app = createApp({ dataDir: tmpDataDir(), internalToken: TOKEN, ...(overrides || {}) });
  const { server, url } = await listen(app);
  t.after(() => server.close());
  return url;
}

const HDR = { 'x-gleipnir-internal-token': TOKEN };

function putBlob(url, id, bytes, headers) {
  return fetch(`${url}/blobs/${id}`, { method: 'PUT', headers: { ...HDR, ...headers }, body: bytes });
}

// Same construction as gateway/src/ni.js — the vector the proof must match.
function expectedNi(bytes) {
  return `ni:///sha-256;${crypto.createHash('sha256').update(bytes).digest('base64url')}`;
}

test('healthz open; everything else requires the internal token', async (t) => {
  const url = await start(t);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal((await fetch(`${url}/blobs/ev-1`)).status, 401);
  assert.equal((await fetch(`${url}/blobs/ev-1`, { headers: { 'x-gleipnir-internal-token': 'wrong' } })).status, 401);
});

test('PUT stores bytes, returns the ni-URI proof; blob is immutable (409 on re-PUT)', async (t) => {
  const url = await start(t);
  const bytes = Buffer.from('hello evidence');

  const r = await putBlob(url, 'ev-1', bytes, { 'x-content-type': 'text/plain', 'x-original-filename': 'note.txt' });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.integrityProof, expectedNi(bytes));
  assert.equal(body.sizeBytes, bytes.length);
  assert.ok(body.storedAt);

  const again = await putBlob(url, 'ev-1', Buffer.from('different bytes'));
  assert.equal(again.status, 409);

  // the original bytes were not clobbered
  const got = await fetch(`${url}/blobs/ev-1`, { headers: HDR });
  assert.equal(Buffer.from(await got.arrayBuffer()).toString(), 'hello evidence');
});

test('GET streams bytes back with content headers from the sidecar', async (t) => {
  const url = await start(t);
  const bytes = crypto.randomBytes(1024);
  await putBlob(url, 'ev-bin', bytes, { 'x-content-type': 'application/octet-stream', 'x-original-filename': 'disk.img' });

  const r = await fetch(`${url}/blobs/ev-bin`, { headers: HDR });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  // ASCII filename: quoted fallback + RFC 5987 form both present.
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="disk.img"; filename*=UTF-8\'\'disk.img');
  assert.equal(r.headers.get('content-length'), String(bytes.length));
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
});

// B1: a non-ASCII filename arrives percent-encoded (the gateway encodes it),
// is stored decoded, and is served back without throwing on the header — the
// ASCII fallback is sanitised and the true name rides in filename*.
test('B1: a Unicode filename round-trips and is served via RFC 5987', async (t) => {
  const url = await start(t);
  const name = '証拠 file.pdf';
  await putBlob(url, 'ev-uni', Buffer.from('x'), { 'x-original-filename': encodeURIComponent(name) });

  const meta = await (await fetch(`${url}/blobs/ev-uni/meta`, { headers: HDR })).json();
  assert.equal(meta.originalFilename, name); // stored decoded, intact

  const r = await fetch(`${url}/blobs/ev-uni`, { headers: HDR });
  assert.equal(r.status, 200); // did NOT throw setting the header
  const cd = r.headers.get('content-disposition');
  assert.match(cd, /filename="__ file\.pdf"/);            // non-ASCII -> _, safe
  assert.match(cd, /filename\*=UTF-8''%E8%A8%BC%E6%8B%A0%20file\.pdf/); // true name
});

test('meta returns the sidecar; 404 for unknown ids', async (t) => {
  const url = await start(t);
  await putBlob(url, 'ev-m', Buffer.from('x'), { 'x-original-filename': 'a.txt' });

  const meta = await (await fetch(`${url}/blobs/ev-m/meta`, { headers: HDR })).json();
  assert.equal(meta.evidenceId, 'ev-m');
  assert.equal(meta.originalFilename, 'a.txt');
  assert.equal(meta.sizeBytes, 1);

  assert.equal((await fetch(`${url}/blobs/ev-none`, { headers: HDR })).status, 404);
  assert.equal((await fetch(`${url}/blobs/ev-none/meta`, { headers: HDR })).status, 404);
  assert.equal((await fetch(`${url}/blobs/ev-none/verify`, { headers: HDR })).status, 404);
});

test('verify: ok against stored proof and explicit expected; detects mismatch and disk tampering', async (t) => {
  const app = createApp({ dataDir: tmpDataDir(), internalToken: TOKEN });
  const { server, url } = await listen(app);
  t.after(() => server.close());
  const bytes = Buffer.from('immutable payload');
  await putBlob(url, 'ev-v', bytes);

  const bare = await (await fetch(`${url}/blobs/ev-v/verify`, { headers: HDR })).json();
  assert.equal(bare.ok, true);
  assert.equal(bare.actual, expectedNi(bytes));

  const good = await (await fetch(`${url}/blobs/ev-v/verify?expected=${encodeURIComponent(expectedNi(bytes))}`, { headers: HDR })).json();
  assert.equal(good.ok, true);

  const wrong = await (await fetch(`${url}/blobs/ev-v/verify?expected=${encodeURIComponent('ni:///sha-256;nope')}`, { headers: HDR })).json();
  assert.equal(wrong.ok, false);

  // simulate disk-level tampering behind the service's back
  fs.writeFileSync(path.join(app.locals.config.dataDir, 'ev-v'), 'tampered');
  const tampered = await (await fetch(`${url}/blobs/ev-v/verify`, { headers: HDR })).json();
  assert.equal(tampered.ok, false);
});

test('DELETE removes blob + sidecar (orphan cleanup); 404 when missing', async (t) => {
  const url = await start(t);
  await putBlob(url, 'ev-d', Buffer.from('orphan'));
  assert.equal((await fetch(`${url}/blobs/ev-d`, { method: 'DELETE', headers: HDR })).status, 204);
  assert.equal((await fetch(`${url}/blobs/ev-d`, { headers: HDR })).status, 404);
  assert.equal((await fetch(`${url}/blobs/ev-d/meta`, { headers: HDR })).status, 404);
  assert.equal((await fetch(`${url}/blobs/ev-d`, { method: 'DELETE', headers: HDR })).status, 404);
});

test('path traversal and sidecar-collision ids are rejected with 400', async (t) => {
  const url = await start(t);
  assert.equal((await fetch(`${url}/blobs/..%2Fescape`, { method: 'PUT', headers: HDR, body: 'x' })).status, 400);
  assert.equal((await fetch(`${url}/blobs/..%2Fescape`, { headers: HDR })).status, 400);
  // an id ending in .meta.json would collide with another blob's sidecar
  assert.equal((await putBlob(url, 'x.meta.json', Buffer.from('x'))).status, 400);
  // empty body is refused
  assert.equal((await fetch(`${url}/blobs/ev-empty`, { method: 'PUT', headers: HDR })).status, 400);
});

test('uploads over MAX_UPLOAD_BYTES are refused with 413', async (t) => {
  const url = await start(t, { maxUploadBytes: 1024 });
  const r = await putBlob(url, 'ev-big', crypto.randomBytes(2048));
  assert.equal(r.status, 413);
  // and nothing was persisted
  assert.equal((await fetch(`${url}/blobs/ev-big`, { headers: HDR })).status, 404);
});
