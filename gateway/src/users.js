'use strict';

// User store for the gateway's session auth (M12). One JSON array file at
// AUTH_DATA_DIR/users.json — file-backed like runsStore.js, loaded once at boot
// and rewritten on every mutation (user counts are tiny; simplicity wins).
// Users are deactivated (active:false), NEVER deleted: audit-trail actor
// attribution must keep resolving to a real username. Passwords are hashed with
// node:crypto scrypt — zero new dependencies. Password hashes never leave this
// module: every method returns the public shape (hash stripped).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

// ASYNC scrypt (S6): the KDF runs on the libuv threadpool instead of the event
// loop, so a burst of logins (each doing full scrypt work, even for unknown
// usernames — see DUMMY_HASH) can no longer stall the whole gateway.
const scrypt = promisify(crypto.scrypt);

const USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
// M18 (CONTRACTS §12-8): 3-tier RBAC. 'lead' sits between admin and
// investigator — leads may create cases and manage the cases they lead.
const ROLES = ['admin', 'lead', 'investigator'];

class UserError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyHash(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  // A corrupted/truncated hash must fail closed — never compare empty buffers.
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function requirePassword(password) {
  // Local-dev posture: non-empty is the only strength rule (documented).
  if (typeof password !== 'string' || password.length === 0) {
    throw new UserError(400, 'password is required');
  }
}

function toPublic(user) {
  if (!user) return null;
  const { passwordHash, ...pub } = user;
  return pub;
}

// Verifying against this dummy hash keeps an unknown-username login doing the
// same scrypt work as a real mismatch, so response timing cannot be used to
// enumerate which usernames exist. Computed once as a promise (hashPassword is
// now async) and awaited in verifyPassword; boot never blocks on it.
const DUMMY_HASH = hashPassword('gleipnir-timing-equalizer');

function makeUsersStore(authDataDir) {
  fs.mkdirSync(authDataDir, { recursive: true });
  const file = path.join(authDataDir, 'users.json');

  let users = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) users = parsed;
  } catch { /* first boot: no file yet */ }

  function persist() {
    fs.writeFileSync(file, JSON.stringify(users, null, 2), 'utf8');
  }

  // M17: the pinned wire field `displayName` was renamed to `name`
  // (CONTRACTS §12-8). Upgrade pre-M17 records in place, once, on load.
  {
    let migrated = false;
    for (const u of users) {
      if (u.displayName !== undefined) {
        if (u.name === undefined) u.name = u.displayName;
        delete u.displayName;
        migrated = true;
      }
    }
    if (migrated) persist();
  }

  function findById(id) {
    return users.find((u) => u.id === id) || null;
  }

  function findByUsername(username) {
    return users.find((u) => u.username === username) || null;
  }

  async function create({ username, password, name, role }) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new UserError(400, 'username must match ^[A-Za-z0-9._-]{1,64}$');
    }
    requirePassword(password);
    const r = role === undefined ? 'investigator' : role;
    if (!ROLES.includes(r)) throw new UserError(400, `role must be one of: ${ROLES.join(', ')}`);
    if (findByUsername(username)) throw new UserError(409, 'username already exists');
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: `usr-${crypto.randomUUID()}`,
      username,
      passwordHash,
      name: typeof name === 'string' && name ? name : username,
      role: r,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    users.push(user);
    persist();
    return toPublic(user);
  }

  // Seeds the first admin only when the store is EMPTY (first boot); returns
  // null otherwise so a restart never resets a live user database.
  async function seedAdmin({ username, password, name }) {
    if (users.length > 0) return null;
    return create({ username, password, name, role: 'admin' });
  }

  async function verifyPassword(username, password) {
    if (typeof password !== 'string') return null;
    const user = findByUsername(username);
    if (!user) {
      await verifyHash(password, await DUMMY_HASH); // equalize timing; result discarded
      return null;
    }
    return (await verifyHash(password, user.passwordHash)) ? toPublic(user) : null;
  }

  function get(id) {
    return toPublic(findById(id));
  }

  function getByUsername(username) {
    return toPublic(findByUsername(username));
  }

  function update(id, patch) {
    const user = findById(id);
    if (!user) throw new UserError(404, 'user not found');
    const p = patch || {};
    if (p.role !== undefined) {
      if (!ROLES.includes(p.role)) throw new UserError(400, `role must be one of: ${ROLES.join(', ')}`);
      user.role = p.role;
    }
    if (p.name !== undefined) {
      if (typeof p.name !== 'string' || !p.name) throw new UserError(400, 'name must be a non-empty string');
      user.name = p.name;
    }
    if (p.active !== undefined) {
      if (typeof p.active !== 'boolean') throw new UserError(400, 'active must be a boolean');
      user.active = p.active;
    }
    user.updatedAt = new Date().toISOString();
    persist();
    return toPublic(user);
  }

  async function resetPassword(id, newPassword) {
    const user = findById(id);
    if (!user) throw new UserError(404, 'user not found');
    requirePassword(newPassword);
    user.passwordHash = await hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();
    persist();
    return toPublic(user);
  }

  function list() {
    return users.map(toPublic);
  }

  return { seedAdmin, create, verifyPassword, get, getByUsername, update, resetPassword, list };
}

module.exports = { makeUsersStore, UserError };
