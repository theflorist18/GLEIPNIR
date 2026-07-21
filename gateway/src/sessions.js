'use strict';

// Opaque bearer-session store (M12). Tokens are 32 random bytes (hex) with an
// absolute TTL — not JWTs: only the gateway ever verifies them, so stateless
// signatures buy nothing. In-memory by design: a gateway restart logs everyone
// out, which is acceptable for a single-host thesis deployment and keeps the
// store trivially correct. The static GLEIPNIR_TOKEN service path does not go
// through this store at all (see auth.js).

const crypto = require('node:crypto');

function makeSessions({ ttlSeconds = 28800 } = {}) {
  const sessions = new Map(); // token -> { userId, expiresAt (epoch ms) }

  function create(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  }

  function get(token) {
    const s = sessions.get(token);
    if (!s) return null;
    if (Date.now() >= s.expiresAt) {
      sessions.delete(token);
      return null;
    }
    return s;
  }

  function destroy(token) {
    sessions.delete(token);
  }

  // Invalidate every live session for a user. Used on admin password reset:
  // resetting a password is the standard response to a suspected compromise,
  // so a stolen token must not keep working for the rest of its TTL. Matches
  // the immediate-propagation model auth.js already gives deactivation and
  // role change (the user is re-fetched per request).
  function destroyForUser(userId) {
    let n = 0;
    for (const [token, s] of sessions) {
      if (s.userId === userId) { sessions.delete(token); n += 1; }
    }
    return n;
  }

  return { create, get, destroy, destroyForUser };
}

module.exports = { makeSessions };
