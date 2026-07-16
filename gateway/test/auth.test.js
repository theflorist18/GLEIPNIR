'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { makeUsersStore } = require('../src/users');
const { makeSessions } = require('../src/sessions');

function tmpAuthDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gleipnir-auth-'));
}

// Real users/sessions stores (tmp dir), fake Fabric — mirrors app.test.js.
function fakeDeps(overrides) {
  const submits = [];
  const users = makeUsersStore(tmpAuthDir());
  const sessions = makeSessions({ ttlSeconds: 3600 });
  users.seedAdmin({ username: 'root', password: 'root-pw' });
  return {
    submits,
    users,
    sessions,
    deps: {
      fabric: {
        async submit(channel, fn, args) { submits.push({ channel, fn, args }); return 'tx-abc'; },
        async evaluate(_channel, _fn, args) { return JSON.stringify({ id: args[0], status: 'ACTIVE' }); },
      },
      batcher: { async enqueue() { return { batchId: 'shared-b000000', leafIndex: 0 }; } },
      runsStore: { async create(r) { return { runId: 'req-1', status: 'requested', request: r }; }, async list() { return []; }, async get() { return null; } },
      users,
      sessions,
      config: { variant: 'standard', token: 'secret-token', defaultChannel: 'coc-main', ...overrides },
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function login(url, username, password) {
  const r = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.json().catch(() => ({})) };
}

const asUser = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

test('login: valid credentials -> token + user (no passwordHash); bad -> 401', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const ok = await login(url, 'root', 'root-pw');
  assert.equal(ok.status, 200);
  assert.match(ok.body.token, /^[0-9a-f]{64}$/);
  assert.equal(ok.body.user.username, 'root');
  assert.equal(ok.body.user.role, 'admin');
  assert.equal(ok.body.user.passwordHash, undefined);

  assert.equal((await login(url, 'root', 'wrong')).status, 401);
  assert.equal((await login(url, 'ghost', 'root-pw')).status, 401);
});

test('login without a users store -> 503; service token unaffected', async (t) => {
  const { deps } = fakeDeps();
  delete deps.users;
  delete deps.sessions;
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  assert.equal((await login(url, 'root', 'root-pw')).status, 503);
  const r = await fetch(`${url}/api/v1/runs`, { headers: { authorization: 'Bearer secret-token' } });
  assert.equal(r.status, 200);
});

test('session token authenticates /auth/me; service token gets 403 there', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const { body } = await login(url, 'root', 'root-pw');
  const me = await fetch(`${url}/api/v1/auth/me`, { headers: asUser(body.token) });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).username, 'root');

  const svc = await fetch(`${url}/api/v1/auth/me`, { headers: asUser('secret-token') });
  assert.equal(svc.status, 403);

  const garbage = await fetch(`${url}/api/v1/auth/me`, { headers: asUser('0'.repeat(64)) });
  assert.equal(garbage.status, 401);
});

test('logout invalidates the session token', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const { body } = await login(url, 'root', 'root-pw');
  const out = await fetch(`${url}/api/v1/auth/logout`, { method: 'POST', headers: asUser(body.token) });
  assert.equal(out.status, 204);
  const me = await fetch(`${url}/api/v1/auth/me`, { headers: asUser(body.token) });
  assert.equal(me.status, 401);
});

test('expired session -> 401', async (t) => {
  const { deps, users } = fakeDeps();
  const sessions = makeSessions({ ttlSeconds: 0 });
  deps.sessions = sessions;
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const token = sessions.create(users.getByUsername('root').id);
  const me = await fetch(`${url}/api/v1/auth/me`, { headers: asUser(token) });
  assert.equal(me.status, 401);
});

test('admin gating: user management requires an admin SESSION — investigator and service token both 403', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;

  const created = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST',
    headers: asUser(admin),
    body: JSON.stringify({ username: 'ivy', password: 'ivy-pw', displayName: 'Ivy Vestigator' }),
  });
  assert.equal(created.status, 201);
  const ivy = await created.json();
  assert.equal(ivy.role, 'investigator');
  assert.equal(ivy.passwordHash, undefined);

  const dup = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST',
    headers: asUser(admin),
    body: JSON.stringify({ username: 'ivy', password: 'x' }),
  });
  assert.equal(dup.status, 409);

  const ivyTok = (await login(url, 'ivy', 'ivy-pw')).body.token;
  const asIvy = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST',
    headers: asUser(ivyTok),
    body: JSON.stringify({ username: 'mallory', password: 'x' }),
  });
  assert.equal(asIvy.status, 403);

  const asService = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST',
    headers: asUser('secret-token'),
    body: JSON.stringify({ username: 'mallory', password: 'x' }),
  });
  assert.equal(asService.status, 403);

  const listed = await fetch(`${url}/api/v1/admin/users`, { headers: asUser(admin) });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).length, 2);
});

test('POST /runs is admin-only; GET /runs stays open to the service token', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const start = (tok) => fetch(`${url}/api/v1/runs`, { method: 'POST', headers: asUser(tok), body: JSON.stringify({ variant: 'standard' }) });

  assert.equal((await start('secret-token')).status, 403);

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  await fetch(`${url}/api/v1/admin/users`, { method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ivy', password: 'ivy-pw' }) });
  const ivy = (await login(url, 'ivy', 'ivy-pw')).body.token;
  assert.equal((await start(ivy)).status, 403);
  assert.equal((await start(admin)).status, 201);

  const list = await fetch(`${url}/api/v1/runs`, { headers: asUser('secret-token') });
  assert.equal(list.status, 200);
});

test('deactivation kills live sessions and future logins', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  const created = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ivy', password: 'ivy-pw' }),
  });
  const ivy = await created.json();
  const ivyTok = (await login(url, 'ivy', 'ivy-pw')).body.token;

  const off = await fetch(`${url}/api/v1/admin/users/${ivy.id}`, {
    method: 'PATCH', headers: asUser(admin), body: JSON.stringify({ active: false }),
  });
  assert.equal(off.status, 200);

  // The live session dies immediately (user is re-fetched per request)...
  assert.equal((await fetch(`${url}/api/v1/auth/me`, { headers: asUser(ivyTok) })).status, 401);
  // ...and re-login is refused.
  assert.equal((await login(url, 'ivy', 'ivy-pw')).status, 401);
});

test('reset-password: old credential stops working, new one logs in', async (t) => {
  const { deps } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  const ivy = await (await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ivy', password: 'old-pw' }),
  })).json();

  const reset = await fetch(`${url}/api/v1/admin/users/${ivy.id}/reset-password`, {
    method: 'POST', headers: asUser(admin), body: JSON.stringify({ password: 'new-pw' }),
  });
  assert.equal(reset.status, 200);
  assert.equal((await login(url, 'ivy', 'old-pw')).status, 401);
  assert.equal((await login(url, 'ivy', 'new-pw')).status, 200);
});

test('actor attribution: user sessions log the authenticated username; service token keeps client actors', async (t) => {
  const { deps, submits } = fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  await fetch(`${url}/api/v1/admin/users`, { method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ivy', password: 'ivy-pw' }) });
  const ivy = (await login(url, 'ivy', 'ivy-pw')).body.token;

  // User session: client-supplied actor 'mallory' is ignored — chaincode arg is 'ivy'.
  const r1 = await fetch(`${url}/api/v1/evidence/ev-1/access`, {
    method: 'POST', headers: asUser(ivy), body: JSON.stringify({ actor: 'mallory', action: 'view' }),
  });
  assert.equal(r1.status, 201);
  assert.deepEqual(submits.at(-1).args, ['ev-1', 'ivy', 'view']);

  // Service token: client-supplied actor is preserved (Caliper realism).
  const r2 = await fetch(`${url}/api/v1/evidence/ev-1/access`, {
    method: 'POST', headers: asUser('secret-token'), body: JSON.stringify({ actor: 'mallory', action: 'view' }),
  });
  assert.equal(r2.status, 201);
  assert.deepEqual(submits.at(-1).args, ['ev-1', 'mallory', 'view']);
});

test('users store persists across reopen from the same dir', async () => {
  const dir = tmpAuthDir();
  const a = makeUsersStore(dir);
  a.seedAdmin({ username: 'root', password: 'root-pw' });
  a.create({ username: 'ivy', password: 'ivy-pw' });

  const b = makeUsersStore(dir);
  assert.equal(b.list().length, 2);
  assert.equal(b.verifyPassword('ivy', 'ivy-pw').username, 'ivy');
  // seedAdmin is first-boot-only: a non-empty store is never reseeded.
  assert.equal(b.seedAdmin({ username: 'other', password: 'x' }), null);
});
