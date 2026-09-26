'use strict';

// Opaque bearer-session store (M12). Tokens are 32 random bytes (hex) with an
// absolute TTL — not JWTs: only the gateway ever verifies them, so stateless
// signatures buy nothing. In-memory by design: a gateway restart logs everyone
// out, which is acceptable for a single-host thesis deployment and keeps the
// store trivially correct. The static GLEIPNIR_TOKEN service path does not go
// through this store at all (see auth.js).
//
// A session dies at the EARLIER of two clocks (OWASP A07 / N3): an absolute
// expiry set at login (a stolen token can't live forever) and a SLIDING idle
// expiry refreshed on each authenticated request (an abandoned token on an
// unattended terminal stops working after a period of inactivity). Before N3
// there was only the absolute clock, so a token left idle stayed valid for the
// full 8h. Purely additive: the service-token path never reaches this store.

const crypto = require('node:crypto');

function makeSessions({ ttlSeconds = 28800, idleTtlSeconds = 1800 } = {}) {
  const sessions = new Map(); // token -> { userId, expiresAt, lastSeenAt (epoch ms) }
  const idleMs = idleTtlSeconds * 1000;

  function create(userId) {
    const now = Date.now();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId, expiresAt: now + ttlSeconds * 1000, lastSeenAt: now });
    return token;
  }

  function get(token) {
    const s = sessions.get(token);
    if (!s) return null;
    const now = Date.now();
    // Absolute cap OR idle timeout — whichever fires first ends the session.
    if (now >= s.expiresAt || now - s.lastSeenAt >= idleMs) {
      sessions.delete(token);
      return null;
    }
    s.lastSeenAt = now; // sliding window: activity resets the idle clock
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
    for (const [token, s] of sessions) {
      if (s.userId === userId) sessions.delete(token);
    }
  }

  return { create, get, destroy, destroyForUser };
}

module.exports = { makeSessions };
