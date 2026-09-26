'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { makeUsersStore } = require('../src/users');
const { makeSessions } = require('../src/sessions');
const { makeSecurityLog } = require('../src/securityLog');

function tmpAuthDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gleipnir-auth-'));
}

// Real users/sessions stores (tmp dir), fake Fabric — mirrors app.test.js.
async function fakeDeps(overrides) {
  const submits = [];
  const users = makeUsersStore(tmpAuthDir());
  const sessions = makeSessions({ ttlSeconds: 3600 });
  await users.seedAdmin({ username: 'root', password: 'root-pw' });
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
      // Per-evidence authz stub: every user session is a contributor.
      caseRegistry: { async request() { return { status: 200, body: { allowed: true, roleInCase: 'contributor' } }; } },
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
  const { deps } = await fakeDeps();
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
  const { deps } = await fakeDeps();
  delete deps.users;
  delete deps.sessions;
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  assert.equal((await login(url, 'root', 'root-pw')).status, 503);
  const r = await fetch(`${url}/api/v1/evidence/ev-1/audit`, { headers: { authorization: 'Bearer secret-token' } });
  assert.equal(r.status, 200);
});

test('session token authenticates /auth/me; service token gets 403 there', async (t) => {
  const { deps } = await fakeDeps();
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
  const { deps } = await fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const { body } = await login(url, 'root', 'root-pw');
  const out = await fetch(`${url}/api/v1/auth/logout`, { method: 'POST', headers: asUser(body.token) });
  assert.equal(out.status, 204);
  const me = await fetch(`${url}/api/v1/auth/me`, { headers: asUser(body.token) });
  assert.equal(me.status, 401);
});

test('expired session -> 401', async (t) => {
  const { deps, users } = await fakeDeps();
  const sessions = makeSessions({ ttlSeconds: 0 });
  deps.sessions = sessions;
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const token = sessions.create(users.getByUsername('root').id);
  const me = await fetch(`${url}/api/v1/auth/me`, { headers: asUser(token) });
  assert.equal(me.status, 401);
});

test('admin gating: user management requires an admin SESSION — investigator and service token both 403', async (t) => {
  const { deps } = await fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;

  const created = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST',
    headers: asUser(admin),
    body: JSON.stringify({ username: 'ivy', password: 'ivy-pw', name: 'Ivy Vestigator' }),
  });
  assert.equal(created.status, 201);
  const ivy = await created.json();
  assert.equal(ivy.role, 'investigator');
  assert.equal(ivy.name, 'Ivy Vestigator');
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

test('deactivation kills live sessions and future logins', async (t) => {
  const { deps } = await fakeDeps();
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
  const { deps } = await fakeDeps();
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
  const { deps, submits } = await fakeDeps();
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

test('login throttle: lockout after max failures (even for correct creds), window expiry, success resets', async (t) => {
  const { deps } = await fakeDeps({ loginMaxAttempts: 3, loginWindowSeconds: 1 });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  // three failures fill the window...
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await login(url, 'root', 'wrong')).status, 401);
  }
  // ...then even CORRECT credentials are refused until the window expires,
  // so the lockout leaks nothing about the guess.
  const locked = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'root-pw' }),
  });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) >= 0);

  // a different username is unaffected (per-user keying)
  assert.equal((await login(url, 'ghost', 'nope')).status, 401);

  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await login(url, 'root', 'root-pw')).status, 200);

  // success cleared the counter: a couple of new failures do not lock out
  assert.equal((await login(url, 'root', 'wrong')).status, 401);
  assert.equal((await login(url, 'root', 'root-pw')).status, 200);
});

test('unknown-username login still does password verification work (timing equalization)', async (t) => {
  const { deps } = await fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  // Behavioral check: identical status + body for unknown user vs wrong
  // password — no oracle in the response. (The scrypt-on-dummy-hash work is
  // asserted by construction in users.js.)
  const unknown = await login(url, 'ghost', 'x');
  const wrongPw = await login(url, 'root', 'x');
  assert.equal(unknown.status, 401);
  assert.equal(wrongPw.status, 401);
  assert.deepEqual(unknown.body, wrongPw.body);
});

test('users store persists across reopen from the same dir', async () => {
  const dir = tmpAuthDir();
  const a = makeUsersStore(dir);
  await a.seedAdmin({ username: 'root', password: 'root-pw' });
  await a.create({ username: 'ivy', password: 'ivy-pw' });

  const b = makeUsersStore(dir);
  assert.equal(b.list().length, 2);
  assert.equal((await b.verifyPassword('ivy', 'ivy-pw')).username, 'ivy');
  // seedAdmin is first-boot-only: a non-empty store is never reseeded.
  assert.equal(await b.seedAdmin({ username: 'other', password: 'x' }), null);
});

test('M18: lead is a valid user role, but admin routes stay admin-only', async (t) => {
  const { deps } = await fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  const created = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'lena', password: 'pw', role: 'lead' }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).role, 'lead');

  // Leads sign in like anyone else but are NOT admins: user management 403s.
  const lena = (await login(url, 'lena', 'pw')).body.token;
  const denied = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST', headers: asUser(lena), body: JSON.stringify({ username: 'x', password: 'x' }),
  });
  assert.equal(denied.status, 403);

  // Unknown roles are still rejected.
  const junk = await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'y', password: 'y', role: 'boss' }),
  });
  assert.equal(junk.status, 400);
});

test('M25: /users/directory — admin and lead sessions see active users only; investigator and service token 403', async (t) => {
  const { deps } = await fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  await fetch(`${url}/api/v1/admin/users`, { method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'lena', password: 'lena-pw', role: 'lead' }) });
  await fetch(`${url}/api/v1/admin/users`, { method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ivy', password: 'ivy-pw', role: 'investigator' }) });
  const ghost = await (await fetch(`${url}/api/v1/admin/users`, { method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ghost', password: 'ghost-pw' }) })).json();
  await fetch(`${url}/api/v1/admin/users/${ghost.id}`, { method: 'PATCH', headers: asUser(admin), body: JSON.stringify({ active: false }) });

  const lena = (await login(url, 'lena', 'lena-pw')).body.token;
  const dir = await fetch(`${url}/api/v1/users/directory`, { headers: asUser(lena) });
  assert.equal(dir.status, 200);
  const listed = await dir.json();
  // ghost is deactivated; root is an ADMIN — above a lead's access, hidden (M25b)
  assert.deepEqual(listed.map((u) => u.username).sort(), ['ivy', 'lena']);
  assert.ok(listed.every((u) => u.passwordHash === undefined));

  // Admin sessions still see everyone active, admins included.
  const adminDir = await (await fetch(`${url}/api/v1/users/directory`, { headers: asUser(admin) })).json();
  assert.deepEqual(adminDir.map((u) => u.username).sort(), ['ivy', 'lena', 'root']);
  const ivy = (await login(url, 'ivy', 'ivy-pw')).body.token;
  assert.equal((await fetch(`${url}/api/v1/users/directory`, { headers: asUser(ivy) })).status, 403);
  assert.equal((await fetch(`${url}/api/v1/users/directory`, { headers: asUser('secret-token') })).status, 403);
});

// N1 (OWASP A02/A07): the service-token comparison is constant-time. A correct
// token still authenticates and a near-miss is refused — equal, same-length-
// differs, and length-mismatch (a raw timingSafeEqual would throw -> 500).
test('N1: service token still authenticates after the constant-time swap; near-miss -> 401', async (t) => {
  const { deps } = await fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());
  assert.equal((await fetch(`${url}/api/v1/evidence/ev-1/audit`, { headers: asUser('secret-token') })).status, 200);
  assert.equal((await fetch(`${url}/api/v1/evidence/ev-1/audit`, { headers: asUser('secret-tokeX') })).status, 401);
  assert.equal((await fetch(`${url}/api/v1/evidence/ev-1/audit`, { headers: asUser('secret-token-extra') })).status, 401);
});

// N3 (OWASP A07): a sliding idle timeout ends an inactive session before its
// absolute TTL; each authenticated read refreshes the idle window.
test('N3: idle timeout expires an inactive token; activity slides the window', async () => {
  const s = makeSessions({ ttlSeconds: 3600, idleTtlSeconds: 0.15 }); // 150 ms idle window
  const tok = s.create('usr-1');
  assert.equal(s.get(tok)?.userId, 'usr-1');            // fresh
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(s.get(tok)?.userId, 'usr-1');            // 80 ms < 150 ms, and this get slides it
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(s.get(tok)?.userId, 'usr-1');            // slid again (80 ms since last activity)
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(s.get(tok), null);                        // idle > 150 ms -> expired
});

// N4 (OWASP A09): security-relevant failures are logged as structured lines,
// and a token/password is NEVER logged.
test('N4: auth/authz failures emit structured security events; no secrets leak', async (t) => {
  const lines = [];
  const { deps } = await fakeDeps();
  deps.securityLog = makeSecurityLog({ sink: { warn: (s) => lines.push(s) } });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  await login(url, 'root', 'wrong-secret-password');                                   // login_failure
  await fetch(`${url}/api/v1/auth/me`);                                                 // auth_failure missing_token
  await fetch(`${url}/api/v1/auth/me`, { headers: asUser('super-secret-bad-token') });  // auth_failure invalid token
  await fetch(`${url}/api/v1/admin/users`, { headers: asUser('secret-token') });        // authz_denied (service->admin)

  assert.ok(lines.some((l) => l.includes('"sec":"login_failure"') && l.includes('"username":"root"')));
  assert.ok(lines.some((l) => l.includes('"sec":"auth_failure"') && l.includes('missing_token')));
  assert.ok(lines.some((l) => l.includes('"sec":"auth_failure"') && l.includes('invalid_or_expired_token')));
  assert.ok(lines.some((l) => l.includes('"sec":"authz_denied"') && l.includes('role_required:admin')));
  assert.ok(lines.every((l) => l.startsWith('[security] {')));

  const joined = lines.join('\n');
  assert.doesNotMatch(joined, /wrong-secret-password/); // attempted password never logged
  assert.doesNotMatch(joined, /super-secret-bad-token/); // bad bearer never logged
  assert.doesNotMatch(joined, /secret-token/);           // the service token value never logged
});

test('N4: successful auth emits NO security line (service-token hot path stays quiet)', async (t) => {
  const lines = [];
  const { deps } = await fakeDeps();
  deps.securityLog = makeSecurityLog({ sink: { warn: (s) => lines.push(s) } });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  assert.equal((await fetch(`${url}/api/v1/evidence/ev-1/audit`, { headers: asUser('secret-token') })).status, 200);
  assert.equal((await login(url, 'root', 'root-pw')).status, 200);
  assert.equal(lines.length, 0, 'successful auth must not emit security events');
});

// ---- Chunk 4 security fixes ----

// S1: /internal/anchor-root is service-principal only. Global authenticate
// alone admitted any user session; an investigator (or anyone with a session)
// could commit or squat Merkle roots on coc-main.
test('S1: /internal/anchor-root requires the service principal', async (t) => {
  const { deps, submits } = await fakeDeps({ variant: 'anchoring' });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  await fetch(`${url}/api/v1/admin/users`, { method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ivy', password: 'ivy-pw' }) });
  const ivy = (await login(url, 'ivy', 'ivy-pw')).body.token;

  const body = JSON.stringify({ batchId: 'shared-b000001', merkleRoot: 'a'.repeat(64) });
  // an investigator session: 403 and NO submit
  const asInvestigator = await fetch(`${url}/internal/anchor-root`, { method: 'POST', headers: asUser(ivy), body });
  assert.equal(asInvestigator.status, 403);
  // even an admin session: 403 (this is the service path, not a role)
  const asAdmin = await fetch(`${url}/internal/anchor-root`, { method: 'POST', headers: asUser(admin), body });
  assert.equal(asAdmin.status, 403);
  assert.equal(submits.length, 0, 'no CommitAnchorRoot should have been submitted by a user session');

  // the service token: accepted, submits CommitAnchorRoot
  const asService = await fetch(`${url}/internal/anchor-root`, { method: 'POST', headers: asUser('secret-token'), body });
  assert.equal(asService.status, 201);
  assert.equal(submits.length, 1);
  assert.equal(submits[0].fn, 'CommitAnchorRoot');

  // the read side is service-only too
  assert.equal((await fetch(`${url}/internal/anchor-root/shared/b1`, { headers: asUser(ivy) })).status, 403);
  assert.equal((await fetch(`${url}/internal/anchor-root/shared/b1`, { headers: asUser('secret-token') })).status, 200);
});

// S5: an admin password reset invalidates the target's live sessions, so a
// stolen token cannot outlive the response to a compromise.
test('S5: password reset invalidates the target user\'s live sessions', async (t) => {
  const { deps } = await fakeDeps();
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  const ivy = await (await fetch(`${url}/api/v1/admin/users`, {
    method: 'POST', headers: asUser(admin), body: JSON.stringify({ username: 'ivy', password: 'old-pw' }),
  })).json();
  const ivyToken = (await login(url, 'ivy', 'old-pw')).body.token;
  // the session works before the reset
  assert.equal((await fetch(`${url}/api/v1/auth/me`, { headers: asUser(ivyToken) })).status, 200);

  await fetch(`${url}/api/v1/admin/users/${ivy.id}/reset-password`, {
    method: 'POST', headers: asUser(admin), body: JSON.stringify({ password: 'new-pw' }),
  });
  // the pre-reset token is now dead
  assert.equal((await fetch(`${url}/api/v1/auth/me`, { headers: asUser(ivyToken) })).status, 401);
});

// S7: with trust proxy set, the login throttle keys on the real client IP
// (X-Forwarded-For), so locking one client out does not lock a named account
// out for everyone.
test('S7: login throttle keys per client IP, not globally per username', async (t) => {
  const { deps } = await fakeDeps({ loginMaxAttempts: 3, loginWindowSeconds: 60 });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const failFrom = (ip) => fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username: 'root', password: 'wrong' }),
  });

  // lock out client A against username 'root'
  for (let i = 0; i < 3; i += 1) assert.equal((await failFrom('9.9.9.9')).status, 401);
  assert.equal((await failFrom('9.9.9.9')).status, 429, 'client A should be locked');

  // client B, same username, is NOT locked — the key is (real-ip, username)
  assert.equal((await failFrom('8.8.8.8')).status, 401, 'client B must not inherit A\'s lockout');

  // and the real admin, arriving from a different IP with correct creds, is fine
  const ok = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7' },
    body: JSON.stringify({ username: 'root', password: 'root-pw' }),
  });
  assert.equal(ok.status, 200);
});

// S17: the auto-logging read routes are rate-limited per user session (each is
// an on-chain AccessLog write); the service token is exempt.
test('S17: auto-log read routes are rate-limited per session, service token exempt', async (t) => {
  const { deps } = await fakeDeps({ autoLogMaxPerWindow: 3, autoLogWindowSeconds: 60 });
  const { server, url } = await listen(createApp(deps));
  t.after(() => server.close());

  const admin = (await login(url, 'root', 'root-pw')).body.token;
  const hit = (tok) => fetch(`${url}/api/v1/evidence/ev-x`, { headers: { authorization: `Bearer ${tok}` } });

  // As a user: the 4th request within the window is refused with 429 (the first
  // three reach the handler; the limiter runs before it).
  let sawUserLimit = false;
  for (let i = 0; i < 4; i += 1) { if ((await hit(admin)).status === 429) sawUserLimit = true; }
  assert.ok(sawUserLimit, 'a user session should hit the auto-log rate limit');

  // The service token is exempt — never 429 no matter how many requests.
  for (let i = 0; i < 6; i += 1) {
    assert.notEqual((await hit('secret-token')).status, 429, 'service token must never be auto-log-rate-limited');
  }
});
