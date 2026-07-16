'use strict';

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

function makeAuth({ token, sessions, users }) {
  function authenticate(req, res, next) {
    const bearer = bearerOf(req);
    if (bearer === null) return res.status(401).json({ error: 'unauthorized' });
    if (bearer === token) {
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
    return res.status(401).json({ error: 'unauthorized' });
  }

  function requireUser(req, res, next) {
    if (req.principal && req.principal.kind === 'user') return next();
    return res.status(403).json({ error: 'user session required' });
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (req.principal && req.principal.kind === 'user' && req.principal.role === role) return next();
      return res.status(403).json({ error: `${role} role required` });
    };
  }

  return { authenticate, requireUser, requireRole };
}

module.exports = { makeAuth, bearerOf };
