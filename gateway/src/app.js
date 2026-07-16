'use strict';

// GLEIPNIR API gateway (BFF). Builds the Express app from injected deps so the
// routing is testable without a live Fabric. Endpoints per docs/CONTRACTS.md §6;
// variant routing per §9. Auth (M12): static service bearer token (unchanged,
// non-production) PLUS user sessions with server-enforced roles — see auth.js.

const express = require('express');
const crypto = require('node:crypto');
const { niUri } = require('./ni');
const { routeWrite, routeRead, channelFor, RequestError } = require('./variantRouter');
const { makeAuth, bearerOf } = require('./auth');

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function isNotFound(err) {
  return /not[\s-]?found|does not exist|no such key/i.test(String((err && err.message) || ''));
}

// Build the Codex-Entry head JSON for CreateEvidence. integrity_proof is either
// supplied by the caller or derived from payloadBase64 (which is hashed then
// DISCARDED — binaries never persist). docs/CONTRACTS.md §5.
function buildHead(body, evidenceId) {
  let storage = body.storage && typeof body.storage === 'object' ? { ...body.storage } : {};
  if (!storage.integrity_proof && body.payloadBase64) {
    const bytes = Buffer.from(body.payloadBase64, 'base64');
    storage.integrity_proof = niUri(bytes); // bytes discarded here
  }
  const entry = {
    id: evidenceId,
    version: body.version || '1.0',
    storage,
    identity: body.identity && typeof body.identity === 'object' ? body.identity : {},
  };
  if (body.encryption) entry.encryption = body.encryption;
  if (body.anchor) entry.anchor = body.anchor;
  if (body.signatures) entry.signatures = body.signatures;
  if (body.previous_id) entry.previous_id = body.previous_id;
  return entry;
}

function buildEvent(op, evidenceId, caseId, actor, detail) {
  return {
    eventId: `evt-${uuid()}`,
    evidenceId,
    caseId: caseId || 'shared',
    op,
    actor: actor || '',
    detail: detail || {},
    ts: nowIso(),
  };
}

function createApp(deps) {
  const { fabric, batcher, runsStore, users, sessions, config } = deps;
  const cfg = {
    variant: 'standard',
    token: 'dev-token',
    defaultChannel: 'coc-main',
    verificationUrl: 'http://verification:4004',
    ...config,
  };
  const routerDeps = { fabric, batcher, defaultChannel: cfg.defaultChannel };
  const auth = makeAuth({ token: cfg.token, sessions, users });

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health check is unauthenticated.
  app.get('/healthz', (_req, res) => res.json({ ok: true, variant: cfg.variant }));

  // Login is the only other unauthenticated route: it exchanges credentials for
  // an opaque session token (M12). Deployments without a users store (e.g.
  // benchmark-only test harnesses that inject just fabric/batcher) answer 503
  // here; the service-token path below is unaffected.
  app.post('/api/v1/auth/login', (req, res) => {
    if (!users || !sessions) return res.status(503).json({ error: 'user auth not configured' });
    const { username, password } = req.body || {};
    const user = typeof username === 'string' && typeof password === 'string'
      ? users.verifyPassword(username, password)
      : null;
    if (!user || !user.active) return res.status(401).json({ error: 'invalid credentials' });
    return res.json({ token: sessions.create(user.id), user });
  });

  // Everything below authenticates as either the static service token
  // (unchanged contract: guards every route, internal ones included) or a user
  // session (docs/CONTRACTS.md §6).
  app.use(auth.authenticate);
  const requireAdmin = auth.requireRole('admin');

  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    // Any error carrying an HTTP status (RequestError, UserError, upstream
    // service errors) maps straight through.
    if (Number.isInteger(err && err.status)) return res.status(err.status).json({ error: err.message });
    if (isNotFound(err)) return res.status(404).json({ error: err.message });
    return res.status(502).json({ error: 'upstream error', detail: String((err && err.message) || err) });
  });

  const V = cfg.variant;

  // Actor attribution (M12): under a user session the audit actor is ALWAYS the
  // authenticated username — client-supplied actor/identity.subject fields are
  // ignored for logging. The service-token path keeps client-supplied actors
  // (Caliper workloads and smoke scripts need them for load-test realism).
  const actorFor = (req, fallback) => (req.principal && req.principal.kind === 'user' ? req.principal.username : fallback);

  // ---- auth/session ----
  app.post('/api/v1/auth/logout', auth.requireUser, (req, res) => {
    sessions.destroy(bearerOf(req));
    res.status(204).end();
  });

  app.get('/api/v1/auth/me', auth.requireUser, (req, res) => {
    res.json(users.get(req.principal.userId));
  });

  // ---- user administration (admin sessions only; the service token is never
  // sufficient here) ----
  app.get('/api/v1/admin/users', requireAdmin, wrap(async (_req, res) => {
    res.json(users.list());
  }));

  app.post('/api/v1/admin/users', requireAdmin, wrap(async (req, res) => {
    res.status(201).json(users.create(req.body || {}));
  }));

  app.patch('/api/v1/admin/users/:id', requireAdmin, wrap(async (req, res) => {
    res.json(users.update(req.params.id, req.body || {}));
  }));

  app.post('/api/v1/admin/users/:id/reset-password', requireAdmin, wrap(async (req, res) => {
    res.json(users.resetPassword(req.params.id, (req.body || {}).password));
  }));

  // ---- writes ----
  app.post('/api/v1/evidence', wrap(async (req, res) => {
    const b = req.body || {};
    const evidenceId = b.evidenceId || uuid();
    const head = buildHead(b, evidenceId);
    const actor = actorFor(req, (b.identity && b.identity.subject) || b.actor || '');
    const event = buildEvent('CREATE', evidenceId, b.caseId, actor, { storage: head.storage });
    const r = await routeWrite({ variant: V, fn: 'CreateEvidence', ccArgs: [evidenceId, JSON.stringify(head)], event, caseId: b.caseId }, routerDeps);
    res.status(r.status).json(r.body);
  }));

  app.post('/api/v1/evidence/:id/transfer', wrap(async (req, res) => {
    const b = req.body || {};
    const { newCustodian = '', reason = '' } = b;
    const event = buildEvent('TRANSFER', req.params.id, b.caseId, actorFor(req, newCustodian), { newCustodian, reason });
    const r = await routeWrite({ variant: V, fn: 'TransferCustody', ccArgs: [req.params.id, newCustodian, reason], event, caseId: b.caseId }, routerDeps);
    res.status(r.status).json(r.body);
  }));

  app.post('/api/v1/evidence/:id/access', wrap(async (req, res) => {
    const b = req.body || {};
    const { action = '' } = b;
    const actor = actorFor(req, b.actor || '');
    const event = buildEvent('ACCESS', req.params.id, b.caseId, actor, { action });
    const r = await routeWrite({ variant: V, fn: 'AccessLog', ccArgs: [req.params.id, actor, action], event, caseId: b.caseId }, routerDeps);
    res.status(r.status).json(r.body);
  }));

  app.delete('/api/v1/evidence/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const caseId = b.caseId || req.query.caseId;
    const reason = b.reason || req.query.reason || '';
    const event = buildEvent('REMOVE', req.params.id, caseId, actorFor(req, ''), { reason });
    const r = await routeWrite({ variant: V, fn: 'RemoveEvidence', ccArgs: [req.params.id, reason], event, caseId }, routerDeps);
    res.status(r.status).json(r.body);
  }));

  // ---- reads (evaluate, always direct) ----
  app.get('/api/v1/evidence/:id', wrap(async (req, res) => {
    const out = await routeRead({ variant: V, fn: 'ReadEvidence', args: [req.params.id], caseId: req.query.caseId }, routerDeps);
    res.type('application/json').send(out);
  }));

  app.get('/api/v1/evidence/:id/audit', wrap(async (req, res) => {
    const out = await routeRead({ variant: V, fn: 'GetAuditTrail', args: [req.params.id], caseId: req.query.caseId }, routerDeps);
    res.type('application/json').send(out);
  }));

  // Verification proxy. verifyEvent is keyed by eventId (?eventId=...), since a
  // single evidence has many events; :id in the path is accepted for symmetry.
  app.get('/api/v1/evidence/:id/verify', wrap(async (req, res) => {
    const eventId = req.query.eventId || req.params.id;
    const resp = await fetch(`${cfg.verificationUrl}/verify/${encodeURIComponent(eventId)}`);
    const body = await resp.json().catch(() => ({}));
    res.status(resp.status).json(body);
  }));

  // ---- internal: anchor-root sink for the Anchoring variant (coc-main) ----
  app.post('/internal/anchor-root', wrap(async (req, res) => {
    const { batchId, merkleRoot, meta } = req.body || {};
    if (!batchId || !merkleRoot) throw new RequestError(400, 'batchId and merkleRoot are required');
    const txId = await fabric.submit(cfg.defaultChannel, 'CommitAnchorRoot', [batchId, merkleRoot, JSON.stringify(meta || {})]);
    res.status(201).json({ txId });
  }));

  app.get('/internal/anchor-root/:scopeId/:batchId', wrap(async (req, res) => {
    const out = await fabric.evaluate(cfg.defaultChannel, 'ReadAnchorRoot', [req.params.scopeId, req.params.batchId]);
    res.type('application/json').send(out);
  }));

  // ---- runs (request store; execution is host-side sweep.py) ----
  // Starting a run is an admin action (M12). Reads stay open to any
  // authenticated principal — sweep.py never uses this API, so the gate cannot
  // touch the benchmark path.
  app.post('/api/v1/runs', requireAdmin, wrap(async (req, res) => {
    const record = await runsStore.create(req.body || {});
    res.status(201).json(record);
  }));
  app.get('/api/v1/runs', wrap(async (_req, res) => res.json(await runsStore.list())));
  app.get('/api/v1/runs/:id', wrap(async (req, res) => {
    const r = await runsStore.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'run not found' });
    return res.json(r);
  }));

  app.locals.config = cfg;
  return app;
}

module.exports = { createApp, buildHead, buildEvent };
