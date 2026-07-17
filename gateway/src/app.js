'use strict';

// GLEIPNIR API gateway (BFF). Builds the Express app from injected deps so the
// routing is testable without a live Fabric. Endpoints per docs/CONTRACTS.md §6;
// variant routing per §9. Auth (M12): static service bearer token (unchanged,
// non-production) PLUS user sessions with server-enforced roles — see auth.js.

const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const { Readable } = require('node:stream');
const { niUri } = require('./ni');
const { routeWrite, routeRead, channelFor, RequestError } = require('./variantRouter');
const { makeAuth, bearerOf } = require('./auth');

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

// Same charset as evidence-store's blob guard (CONTRACTS §6); pre-validated
// here so a bad id fails before any bytes are stored.
const SAFE_EVIDENCE_ID = /^[A-Za-z0-9._:-]+$/;

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
  const { fabric, batcher, runsStore, users, sessions, caseRegistry, evidenceStore, config } = deps;
  const cfg = {
    variant: 'standard',
    token: 'dev-token',
    defaultChannel: 'coc-main',
    verificationUrl: 'http://verification:4004',
    maxUploadBytes: 26214400, // 25 MiB
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
  //
  // Brute-force throttle: a fixed window per (client IP, username). After
  // maxAttempts consecutive failures the route answers 429 (with Retry-After)
  // until the window expires — even for correct credentials, so a guesser
  // learns nothing from the lockout. Success clears the counter. In-memory,
  // same posture as the session store.
  const loginFailures = new Map(); // "ip|username" -> { count, windowStart }
  const loginMaxAttempts = cfg.loginMaxAttempts || 5;
  const loginWindowMs = (cfg.loginWindowSeconds || 60) * 1000;

  app.post('/api/v1/auth/login', (req, res) => {
    if (!users || !sessions) return res.status(503).json({ error: 'user auth not configured' });
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const key = `${req.ip}|${username}`;
    const now = Date.now();
    if (loginFailures.size > 10000) {
      for (const [k, v] of loginFailures) {
        if (now - v.windowStart >= loginWindowMs) loginFailures.delete(k);
      }
    }
    const rec = loginFailures.get(key);
    if (rec && now - rec.windowStart < loginWindowMs && rec.count >= loginMaxAttempts) {
      res.set('retry-after', String(Math.ceil((rec.windowStart + loginWindowMs - now) / 1000)));
      return res.status(429).json({ error: 'too many failed attempts — try again later' });
    }

    const user = users.verifyPassword(username, password);
    if (!user || !user.active) {
      if (rec && now - rec.windowStart < loginWindowMs) {
        rec.count += 1;
      } else {
        loginFailures.set(key, { count: 1, windowStart: now });
      }
      return res.status(401).json({ error: 'invalid credentials' });
    }
    loginFailures.delete(key);
    return res.json({ token: sessions.create(user.id), user });
  });

  // Everything below authenticates as either the static service token
  // (unchanged contract: guards every route, internal ones included) or a user
  // session (docs/CONTRACTS.md §6).
  app.use(auth.authenticate);
  const requireAdmin = auth.requireRole('admin');
  const requireAdminOrLead = auth.requireRole('admin', 'lead');

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

  // ---- evidence library (M13c): case proxying, search, per-evidence authz ----
  // These need the case-registry / evidence-store clients. Deployments without
  // them (benchmark-only harnesses) answer 503 on the library routes, and the
  // per-evidence authz gate is off — i.e. exactly the pre-library behavior.
  const requireLibrary = (req, res, next) => {
    if (!caseRegistry || !evidenceStore) return res.status(503).json({ error: 'evidence library not configured' });
    return next();
  };

  const proxy = (res, out) => res.status(out.status).json(out.body);
  const isNonAdminUser = (req) => req.principal && req.principal.kind === 'user' && req.principal.role !== 'admin';

  // Per-evidence access gate. The service token always bypasses (the
  // benchmark/infra path; case scoping is a library concern). Admins bypass
  // for metadata and trails, but NOT for blob content ({content:true}, M18 —
  // CONTRACTS §12-8): downloading evidence bytes requires being a participant
  // of the evidence's case, even for admins. User identity in case-registry
  // is the immutable username.
  async function ensureEvidenceAccess(req, evidenceId, { write = false, content = false } = {}) {
    if (!caseRegistry) return;
    if (!req.principal || req.principal.kind !== 'user') return;
    if (req.principal.role === 'admin' && !content) return;
    const { status, body } = await caseRegistry.request(
      'GET',
      `/internal/authz?userId=${encodeURIComponent(req.principal.username)}&evidenceId=${encodeURIComponent(evidenceId)}`,
    );
    if (status !== 200 || !body) throw new RequestError(502, 'authz check failed');
    if (!body.allowed) {
      // Unknown-to-the-library evidence 404s so ids can't be probed.
      throw new RequestError(body.reason === 'unknown-evidence' ? 404 : 403, 'access to this evidence is denied');
    }
    if (write && !['contributor', 'lead', 'uploader'].includes(body.roleInCase)) {
      throw new RequestError(403, 'a contributor role in the case is required to write');
    }
  }

  // Case-management gate (M18): sessions only — the service token was never
  // sufficient for case management (CONTRACTS §6) and stays that way. Admins
  // manage any case; a lead manages only cases where they hold the case-lead
  // role. Non-participants get 404 so case ids can't be probed. Returns the
  // case detail for lead callers (admins return null — no fetch needed).
  async function ensureCaseLead(req, caseId) {
    if (!req.principal || req.principal.kind !== 'user') throw new RequestError(403, 'user session required');
    if (req.principal.role === 'admin') return null;
    const out = await caseRegistry.request('GET', `/cases/${encodeURIComponent(caseId)}`);
    if (out.status !== 200 || !out.body) throw new RequestError(404, 'case not found');
    const me = (out.body.participants || []).find((p) => p.userId === req.principal.username);
    if (!me) throw new RequestError(404, 'case not found'); // don't leak existence
    if (me.roleInCase !== 'lead') throw new RequestError(403, 'the case lead role is required');
    return out.body;
  }

  // Synchronous auto-AccessLog (M13c): a user-session view/download/export
  // succeeds ONLY if the on-chain log write succeeds — "no doubt of tampering"
  // beats latency. NEVER fires for the service token: Caliper read workloads
  // must not mutate the ledger.
  async function logAccess(req, evidenceId, action, caseId) {
    if (!req.principal || req.principal.kind !== 'user') return;
    const actor = req.principal.username;
    const event = buildEvent('ACCESS', evidenceId, caseId, actor, { action, auto: true });
    await routeWrite({ variant: V, fn: 'AccessLog', ccArgs: [evidenceId, actor, action], event, caseId }, routerDeps);
  }

  const listCases = wrap(async (req, res) => {
    const qs = new URLSearchParams();
    if (req.query.status) qs.set('status', String(req.query.status));
    if (req.query.q) qs.set('q', String(req.query.q));
    if (isNonAdminUser(req)) qs.set('participant', req.principal.username);
    proxy(res, await caseRegistry.request('GET', `/cases?${qs}`));
  });
  // /cases/search must be registered before /cases/:id.
  app.get('/api/v1/cases/search', requireLibrary, listCases);
  app.get('/api/v1/cases', requireLibrary, listCases);

  // Case creation is admin-or-lead (M18). A lead who creates a case owns it:
  // they land on the roster as case 'lead'. Admins may hand the case to a
  // lead at creation via leadUserId (must reference an active 'lead' user).
  app.post('/api/v1/cases', requireLibrary, requireAdminOrLead, wrap(async (req, res) => {
    const b = req.body || {};
    let leadUserId = null;
    if (req.principal.role === 'lead') {
      leadUserId = req.principal.username;
    } else if (b.leadUserId !== undefined && b.leadUserId !== null) {
      const target = users && users.getByUsername(b.leadUserId);
      if (!target || !target.active || target.role !== 'lead') {
        return res.status(400).json({ error: 'leadUserId must reference an active user with the lead role' });
      }
      leadUserId = b.leadUserId;
    }
    const out = await caseRegistry.request('POST', '/cases', {
      name: b.name, description: b.description, status: b.status, createdBy: req.principal.username,
    });
    if (out.status === 201 && leadUserId) {
      const granted = await caseRegistry.request('POST', `/cases/${encodeURIComponent(out.body.id)}/participants`, {
        userId: leadUserId, roleInCase: 'lead', addedBy: req.principal.username,
      });
      if (granted.status !== 201) throw new RequestError(502, `case created but lead grant failed (${granted.status})`);
    }
    proxy(res, out);
  }));

  app.get('/api/v1/cases/:id', requireLibrary, wrap(async (req, res) => {
    const out = await caseRegistry.request('GET', `/cases/${encodeURIComponent(req.params.id)}`);
    if (out.status === 200 && isNonAdminUser(req)) {
      const mine = (out.body.participants || []).some((p) => p.userId === req.principal.username);
      if (!mine) return res.status(404).json({ error: 'case not found' }); // don't leak existence
    }
    proxy(res, out);
  }));

  app.patch('/api/v1/cases/:id', requireLibrary, wrap(async (req, res) => {
    await ensureCaseLead(req, req.params.id);
    const b = req.body || {};
    proxy(res, await caseRegistry.request('PATCH', `/cases/${encodeURIComponent(req.params.id)}`, {
      name: b.name, description: b.description, status: b.status,
    }));
  }));

  app.post('/api/v1/cases/:id/participants', requireLibrary, wrap(async (req, res) => {
    await ensureCaseLead(req, req.params.id);
    const b = req.body || {};
    if (users && b.userId && !users.getByUsername(b.userId)) {
      return res.status(404).json({ error: 'no such user' });
    }
    // The case-lead role is reserved for users whose global role is 'lead'.
    if (b.roleInCase === 'lead' && users) {
      const target = users.getByUsername(b.userId);
      if (!target || target.role !== 'lead') {
        return res.status(400).json({ error: 'the case lead must be a user with the lead role' });
      }
    }
    proxy(res, await caseRegistry.request('POST', `/cases/${encodeURIComponent(req.params.id)}/participants`, {
      userId: b.userId, roleInCase: b.roleInCase, addedBy: req.principal.username,
    }));
  }));

  app.delete('/api/v1/cases/:id/participants/:userId', requireLibrary, wrap(async (req, res) => {
    const detail = await ensureCaseLead(req, req.params.id);
    // A case must keep at least one lead once it has one; only an admin may
    // remove the last (detail is non-null exactly for lead callers).
    if (detail) {
      const leads = (detail.participants || []).filter((p) => p.roleInCase === 'lead');
      if (leads.length === 1 && leads[0].userId === req.params.userId) {
        return res.status(409).json({ error: 'cannot remove the last case lead' });
      }
    }
    proxy(res, await caseRegistry.request('DELETE', `/cases/${encodeURIComponent(req.params.id)}/participants/${encodeURIComponent(req.params.userId)}`));
  }));

  app.post('/api/v1/cases/:id/evidence', requireLibrary, wrap(async (req, res) => {
    await ensureCaseLead(req, req.params.id);
    proxy(res, await caseRegistry.request('POST', `/cases/${encodeURIComponent(req.params.id)}/evidence`, {
      evidenceId: (req.body || {}).evidenceId,
    }));
  }));

  app.delete('/api/v1/cases/:id/evidence/:evidenceId', requireLibrary, wrap(async (req, res) => {
    await ensureCaseLead(req, req.params.id);
    proxy(res, await caseRegistry.request('DELETE', `/cases/${encodeURIComponent(req.params.id)}/evidence/${encodeURIComponent(req.params.evidenceId)}`));
  }));

  // Must be registered before GET /api/v1/evidence/:id.
  app.get('/api/v1/evidence/search', requireLibrary, wrap(async (req, res) => {
    const qs = new URLSearchParams();
    for (const k of ['caseId', 'q', 'uploadedBy', 'type', 'from', 'to']) {
      if (req.query[k]) qs.set(k, String(req.query[k]));
    }
    if (isNonAdminUser(req)) qs.set('visibleToUserId', req.principal.username);
    proxy(res, await caseRegistry.request('GET', `/evidence-index?${qs}`));
  }));

  // ---- writes ----
  // Multipart ingest support (M13c). Engages ONLY for multipart/form-data —
  // the JSON path below (payloadBase64 hash-then-discard) is what Caliper's
  // REST connector and smoke-standard.sh use, and stays byte-identical.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes } });
  const maybeMultipart = (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    if (!evidenceStore || !caseRegistry) return res.status(503).json({ error: 'evidence library not configured' });
    return upload.single('file')(req, res, (err) => {
      if (err) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: err.message });
      }
      return next();
    });
  };

  // Ingesting directly into a case requires a contributor role there (admins
  // and the service token bypass). Uploads without a case are always allowed —
  // uncategorized evidence is visible only to its uploader and admins.
  async function ensureCaseIngest(req, caseId) {
    if (!isNonAdminUser(req)) return;
    const { status, body } = await caseRegistry.request('GET', `/cases/${encodeURIComponent(caseId)}`);
    if (status !== 200 || !body) throw new RequestError(404, 'case not found');
    const me = (body.participants || []).find((p) => p.userId === req.principal.username);
    if (!me) throw new RequestError(404, 'case not found'); // don't leak existence
    if (!['contributor', 'lead'].includes(me.roleInCase)) throw new RequestError(403, 'a contributor role in the case is required to ingest');
  }

  // Multipart ingest: store bytes off-chain -> commit the Codex-Entry head
  // with the store's integrity proof -> register the read-model row. The
  // library caseId NEVER reaches the chain (case linkage is off-chain only;
  // the on-chain record is identical to a caseless create).
  async function libraryIngest(req, res) {
    const b = req.body || {};
    const evidenceId = b.evidenceId || uuid();
    if (!SAFE_EVIDENCE_ID.test(evidenceId) || evidenceId.endsWith('.meta.json')) {
      throw new RequestError(400, 'invalid evidenceId');
    }
    const actor = actorFor(req, b.actor || '');
    const caseId = b.caseId || null;
    if (caseId) await ensureCaseIngest(req, caseId);

    const stored = await evidenceStore.put(evidenceId, req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
      originalFilename: req.file.originalname || null,
    });
    if (stored.status === 409) throw new RequestError(409, 'evidence already exists');
    if (stored.status !== 201) throw new RequestError(502, `evidence-store put failed (${stored.status})`);
    const { integrityProof } = stored.body;

    const identity = { subject: actor };
    if (b.org) identity.org = b.org;
    const head = buildHead({
      version: b.version,
      identity,
      storage: {
        protocol: 'gleipnir-evidence-store',
        location: `evidence-store://${evidenceId}`,
        integrity_proof: integrityProof,
      },
    }, evidenceId);
    const event = buildEvent('CREATE', evidenceId, undefined, actor, { storage: head.storage });

    let r;
    try {
      r = await routeWrite({ variant: V, fn: 'CreateEvidence', ccArgs: [evidenceId, JSON.stringify(head)], event, caseId: undefined }, routerDeps);
    } catch (err) {
      // The blob is orphaned if the chain write failed — best-effort cleanup.
      await evidenceStore.del(evidenceId).then(() => {}, () => {});
      throw err;
    }

    const indexed = await caseRegistry.request('POST', '/evidence-index', {
      evidenceId,
      caseId: caseId || undefined,
      originalFilename: req.file.originalname || null,
      mimeType: req.file.mimetype || null,
      sizeBytes: req.file.size,
      integrityProof,
      uploadedBy: actor,
    });
    if (indexed.status !== 201) {
      // The on-chain commit already happened (append-only ledger) — fail
      // loudly rather than leave silently-invisible evidence.
      throw new RequestError(502, `evidence committed on-chain but index registration failed (${indexed.status})`);
    }
    res.status(r.status).json({ ...r.body, integrityProof });
  }

  app.post('/api/v1/evidence', maybeMultipart, wrap(async (req, res) => {
    if (req.file) return libraryIngest(req, res);
    if (req.is('multipart/form-data')) throw new RequestError(400, "multipart ingest requires a 'file' part");
    const b = req.body || {};
    const evidenceId = b.evidenceId || uuid();
    const head = buildHead(b, evidenceId);
    const actor = actorFor(req, (b.identity && b.identity.subject) || b.actor || '');
    const event = buildEvent('CREATE', evidenceId, b.caseId, actor, { storage: head.storage });
    const r = await routeWrite({ variant: V, fn: 'CreateEvidence', ccArgs: [evidenceId, JSON.stringify(head)], event, caseId: b.caseId }, routerDeps);
    return res.status(r.status).json(r.body);
  }));

  app.post('/api/v1/evidence/:id/transfer', wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id, { write: true });
    const b = req.body || {};
    const { newCustodian = '', reason = '' } = b;
    const event = buildEvent('TRANSFER', req.params.id, b.caseId, actorFor(req, newCustodian), { newCustodian, reason });
    const r = await routeWrite({ variant: V, fn: 'TransferCustody', ccArgs: [req.params.id, newCustodian, reason], event, caseId: b.caseId }, routerDeps);
    res.status(r.status).json(r.body);
  }));

  app.post('/api/v1/evidence/:id/access', wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id, { write: true });
    const b = req.body || {};
    const { action = '' } = b;
    const actor = actorFor(req, b.actor || '');
    const event = buildEvent('ACCESS', req.params.id, b.caseId, actor, { action });
    const r = await routeWrite({ variant: V, fn: 'AccessLog', ccArgs: [req.params.id, actor, action], event, caseId: b.caseId }, routerDeps);
    res.status(r.status).json(r.body);
  }));

  app.delete('/api/v1/evidence/:id', wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id, { write: true });
    const b = req.body || {};
    const caseId = b.caseId || req.query.caseId;
    const reason = b.reason || req.query.reason || '';
    const event = buildEvent('REMOVE', req.params.id, caseId, actorFor(req, ''), { reason });
    const r = await routeWrite({ variant: V, fn: 'RemoveEvidence', ccArgs: [req.params.id, reason], event, caseId }, routerDeps);
    // Best-effort cache sync: the ledger is authoritative; a failed PATCH here
    // is a display glitch the library tolerates by design.
    if (caseRegistry) {
      await caseRegistry.request('PATCH', `/evidence-index/${encodeURIComponent(req.params.id)}`, { status: 'REMOVED' }).then(() => {}, () => {});
    }
    res.status(r.status).json(r.body);
  }));

  // ---- reads (evaluate, always direct) ----
  // Under a user session every evidence read is (a) authz-gated per case and
  // (b) view/download/export auto-append a synchronous AccessLog event.
  app.get('/api/v1/evidence/:id', wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id);
    const out = await routeRead({ variant: V, fn: 'ReadEvidence', args: [req.params.id], caseId: req.query.caseId }, routerDeps);
    await logAccess(req, req.params.id, 'view', req.query.caseId);
    res.type('application/json').send(out);
  }));

  // Audit-trail reads are authz-gated but NOT auto-logged: the detail page
  // fetches record + trail together, and logging trail reads would grow the
  // trail on every render of the very page that displays it.
  app.get('/api/v1/evidence/:id/audit', wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id);
    const out = await routeRead({ variant: V, fn: 'GetAuditTrail', args: [req.params.id], caseId: req.query.caseId }, routerDeps);
    res.type('application/json').send(out);
  }));

  // Blob CONTENT is participant-only (M18): unlike view/audit/export, the
  // admin bypass does not apply here — {content:true} sends admins through
  // the same case-participation check as everyone else.
  app.get('/api/v1/evidence/:id/download', requireLibrary, wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id, { content: true });
    const upstream = await evidenceStore.fetchBlob(req.params.id);
    if (upstream.status === 404) throw new RequestError(404, 'no stored binary for this evidence');
    if (!upstream.ok) throw new RequestError(502, `evidence-store read failed (${upstream.status})`);
    // Log BEFORE streaming: if the log write fails the download must fail.
    await logAccess(req, req.params.id, 'download', req.query.caseId);
    for (const h of ['content-type', 'content-length', 'content-disposition']) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    Readable.fromWeb(upstream.body).pipe(res);
  }));

  app.get('/api/v1/evidence/:id/export', wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id);
    const [record, audit] = await Promise.all([
      routeRead({ variant: V, fn: 'ReadEvidence', args: [req.params.id], caseId: req.query.caseId }, routerDeps),
      routeRead({ variant: V, fn: 'GetAuditTrail', args: [req.params.id], caseId: req.query.caseId }, routerDeps),
    ]);
    // Log after assembling: the exported trail reflects the pre-export state;
    // the export event itself lands as the next trail entry.
    await logAccess(req, req.params.id, 'export', req.query.caseId);
    const parse = (s) => { try { return JSON.parse(s); } catch { return s; } };
    res.json({
      evidenceId: req.params.id,
      exportedAt: nowIso(),
      record: parse(record),
      auditTrail: parse(audit),
    });
  }));

  // Verification proxy. verifyEvent is keyed by eventId (?eventId=...), since a
  // single evidence has many events; :id in the path is accepted for symmetry.
  app.get('/api/v1/evidence/:id/verify', wrap(async (req, res) => {
    await ensureEvidenceAccess(req, req.params.id);
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
