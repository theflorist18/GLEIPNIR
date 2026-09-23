'use strict';

// Security-event logging (OWASP A09 / N4). Emits ONE structured stdout line per
// security-relevant event — authentication failures, authorization denials, and
// login lockouts — so an operator can see attacks that the on-chain audit trail
// (which records only SUCCESSFUL evidence writes) never captures.
//
// Design constraints:
//   - Only FAILURES are logged. A successful request emits nothing, so the
//     service-token benchmark hot path is untouched (no flood, no added latency).
//   - NEVER log a token, password, session id, or evidence content. Only the
//     event type, a coarse reason, the actor's USERNAME (already public), method,
//     path, and client ip.
//   - No request-logging middleware; this is a targeted security channel.
//
// The sink defaults to console; tests inject a fake sink to assert output.

function makeSecurityLog({ enabled = true, sink = console } = {}) {
  function emit(event, fields) {
    if (!enabled) return;
    const rec = { ts: new Date().toISOString(), sec: event, ...fields };
    // console.warn -> stderr, keeping security events off the stdout data plane.
    sink.warn(`[security] ${JSON.stringify(rec)}`);
  }
  return {
    // Unauthenticated: a bad/missing/expired bearer on a protected route.
    authFailure: (req, reason) =>
      emit('auth_failure', { reason, method: req.method, path: req.path, ip: req.ip }),
    // Authenticated but not permitted: role/service/participation denial.
    authzDenied: (req, reason) =>
      emit('authz_denied', {
        reason,
        kind: (req.principal && req.principal.kind) || null,
        user: (req.principal && req.principal.username) || null,
        method: req.method,
        path: req.path,
      }),
    loginFailure: (req, username) =>
      emit('login_failure', { username: typeof username === 'string' ? username : null, ip: req.ip }),
    loginLockout: (req, username) =>
      emit('login_lockout', { username: typeof username === 'string' ? username : null, ip: req.ip }),
  };
}

module.exports = { makeSecurityLog };
