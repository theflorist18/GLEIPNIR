'use strict';

const crypto = require('node:crypto');

// Constant-time bearer/token comparison (OWASP A02/A07). A plain `===` on a
// secret leaks its length and a prefix-match position through timing. Hash both
// sides to a fixed 32-byte digest first so timingSafeEqual always gets
// equal-length buffers (it throws on a length mismatch) and the comparison is
// constant-time regardless of the candidate's length. Mirrors the password
// path, which is already timing-safe (users.js verifyHash).
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a == null ? '' : a), 'utf8').digest();
  const bh = crypto.createHash('sha256').update(String(b == null ? '' : b), 'utf8').digest();
  return crypto.timingSafeEqual(ah, bh);
}

// Bearer authentication (M12). Two kinds of principal:
//
//   - service: the static GLEIPNIR_TOKEN. Contract-unchanged (docs/CONTRACTS.md
//     §6): it authenticates EVERY route after /healthz, internal routes
//     included — merkle-batcher, verification, Caliper's REST connector, and
//     the smoke scripts all use it. req.principal = { kind: 'service' }.
//   - user: an opaque session token from POST /api/v1/auth/login.
//     req.principal = { kind: 'user', userId, username, role }. The user is
//     re-fetched from the store on every request so deactivation or a role
//     change takes effect immediately, not at next login.
//
// requireRole gates admin-only routes (user management, case administration,
// POST /api/v1/runs): the service token is NEVER sufficient there.

function bearerOf(req) {
  const auth = req.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function makeAuth({ token, sessions, users, securityLog }) {
  // Optional security-event channel (N4). Falls back to no-ops so existing
  // callers/tests that don't pass one keep working unchanged.
  const log = securityLog || { authFailure() {}, authzDenied() {} };

  function authenticate(req, res, next) {
    const bearer = bearerOf(req);
    if (bearer === null) {
      log.authFailure(req, 'missing_token');
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (safeEqual(bearer, token)) {
      req.principal = { kind: 'service' };
      return next();
    }
    if (sessions && users) {
      const session = sessions.get(bearer);
      if (session) {
        const user = users.get(session.userId);
        if (user && user.active) {
          req.principal = { kind: 'user', userId: user.id, username: user.username, role: user.role };
          return next();
        }
      }
    }
    log.authFailure(req, 'invalid_or_expired_token');
    return res.status(401).json({ error: 'unauthorized' });
  }

  function requireUser(req, res, next) {
    if (req.principal && req.principal.kind === 'user') return next();
    log.authzDenied(req, 'user_session_required');
    return res.status(403).json({ error: 'user session required' });
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (req.principal && req.principal.kind === 'user' && roles.includes(req.principal.role)) return next();
      log.authzDenied(req, `role_required:${roles.join('|')}`);
      const label = roles.length === 1 ? `${roles[0]} role required` : `one of [${roles.join(', ')}] roles required`;
      return res.status(403).json({ error: label });
    };
  }

  // Gate for gateway-internal routes that belong to the off-chain machinery
  // (the batcher's anchor-root sink, the verification service). The contract
  // (docs/CONTRACTS.md §6) puts these on the SERVICE-token path — a user
  // session, even an admin's, must not be able to commit anchor roots. This is
  // the inverse of requireRole: only the service principal passes.
  function requireService(req, res, next) {
    if (req.principal && req.principal.kind === 'service') return next();
    log.authzDenied(req, 'service_token_required');
    return res.status(403).json({ error: 'service token required' });
  }

  return { authenticate, requireUser, requireRole, requireService };
}

module.exports = { makeAuth, bearerOf, safeEqual };
