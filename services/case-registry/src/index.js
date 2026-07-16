'use strict';

// GLEIPNIR case registry (M13a). Owns the OFF-CHAIN Case entity (id, roster of
// participants) and the evidence search read-model. Two deliberate design
// points, stated up front:
//
//   1. `evidence_index` is a READ-MODEL / CACHE, not a source of truth. The
//      ledger stays authoritative for evidence status and custodian; a stale
//      row here is a display glitch, never an integrity problem.
//   2. Case-evidence linkage is off-chain ONLY. Nothing in this service
//      touches Fabric, the Codex-Entry schema, or the chaincode. Case ids are
//      `CASE-<uuid>` — deliberately disjoint from the Parallel variants'
//      channel routing key (`case-NNN`, gateway variantRouter CASE_RE), so the
//      two "case" concepts can never collide.
//
// Internal-only service: reached via the gateway (which enforces who may ask),
// never by the frontend. Every route after /healthz requires the shared
// X-Gleipnir-Internal-Token header.

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

// Same charset contract as the receipt store's eventId guard (CONTRACTS §6);
// applied to ids that reach SQL params or URLs.
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const CASE_STATUSES = ['OPEN', 'CLOSED', 'ARCHIVED'];
const CASE_ROLES = ['viewer', 'contributor'];

function loadConfig() {
  return {
    port: parseInt(process.env.PORT, 10) || 4005,
    dataDir: process.env.DATA_DIR || '/data',
    internalToken: process.env.GLEIPNIR_INTERNAL_TOKEN || 'internal-dev-token',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

const nowIso = () => new Date().toISOString();

function openDb(dataDir) {
  const db = new Database(path.join(dataDir, 'case-registry.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','ARCHIVED')),
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS case_participants (
      case_id      TEXT NOT NULL REFERENCES cases(id),
      user_id      TEXT NOT NULL,
      role_in_case TEXT NOT NULL DEFAULT 'viewer' CHECK (role_in_case IN ('viewer','contributor')),
      added_by     TEXT NOT NULL,
      added_at     TEXT NOT NULL,
      PRIMARY KEY (case_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS evidence_index (
      evidence_id       TEXT PRIMARY KEY,
      case_id           TEXT NULL REFERENCES cases(id),
      original_filename TEXT,
      mime_type         TEXT,
      size_bytes        INTEGER,
      integrity_proof   TEXT,
      uploaded_by       TEXT,
      uploaded_at       TEXT,
      status            TEXT NOT NULL DEFAULT 'ACTIVE',
      last_synced_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence_index(case_id);
    CREATE INDEX IF NOT EXISTS idx_participants_user ON case_participants(user_id);
  `);
  return db;
}

// Row -> wire shape (camelCase; docs/CONTRACTS.md pins these).
const caseWire = (r) => r && ({
  id: r.id, name: r.name, description: r.description, status: r.status,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const participantWire = (r) => ({
  userId: r.user_id, roleInCase: r.role_in_case, addedBy: r.added_by, addedAt: r.added_at,
});
const evidenceWire = (r) => r && ({
  evidenceId: r.evidence_id, caseId: r.case_id, originalFilename: r.original_filename,
  mimeType: r.mime_type, sizeBytes: r.size_bytes, integrityProof: r.integrity_proof,
  uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, status: r.status,
  lastSyncedAt: r.last_synced_at,
});

// LIKE-escape so a search term containing % or _ matches literally.
const likeOf = (q) => `%${String(q).replace(/([\\%_])/g, '\\$1')}%`;

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = openDb(cfg.dataDir);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Shared-secret guard: this service trusts only the gateway.
  app.use((req, res, next) => {
    if (req.get('x-gleipnir-internal-token') !== cfg.internalToken) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  });

  const bad = (res, msg) => res.status(400).json({ error: msg });
  const notFound = (res, msg) => res.status(404).json({ error: msg });

  const getCase = db.prepare('SELECT * FROM cases WHERE id = ?');
  const getEvidence = db.prepare('SELECT * FROM evidence_index WHERE evidence_id = ?');
  const getParticipant = db.prepare('SELECT * FROM case_participants WHERE case_id = ? AND user_id = ?');

  // ---- cases ----
  app.post('/cases', (req, res) => {
    const b = req.body || {};
    if (typeof b.name !== 'string' || !b.name.trim()) return bad(res, 'name is required');
    if (typeof b.createdBy !== 'string' || !b.createdBy) return bad(res, 'createdBy is required');
    if (b.status !== undefined && !CASE_STATUSES.includes(b.status)) return bad(res, `status must be one of: ${CASE_STATUSES.join(', ')}`);
    const now = nowIso();
    const row = {
      id: `CASE-${crypto.randomUUID()}`,
      name: b.name.trim(),
      description: typeof b.description === 'string' ? b.description : '',
      status: b.status || 'OPEN',
      created_by: b.createdBy,
      created_at: now,
      updated_at: now,
    };
    db.prepare(`INSERT INTO cases (id, name, description, status, created_by, created_at, updated_at)
                VALUES (@id, @name, @description, @status, @created_by, @created_at, @updated_at)`).run(row);
    res.status(201).json(caseWire(row));
  });

  app.get('/cases', (req, res) => {
    const { participant, status, q } = req.query;
    if (status !== undefined && !CASE_STATUSES.includes(status)) return bad(res, `status must be one of: ${CASE_STATUSES.join(', ')}`);
    const where = [];
    const params = {};
    if (participant) {
      where.push('c.id IN (SELECT case_id FROM case_participants WHERE user_id = @participant)');
      params.participant = participant;
    }
    if (status) {
      where.push('c.status = @status');
      params.status = status;
    }
    if (q) {
      where.push("(c.name LIKE @q ESCAPE '\\' OR c.description LIKE @q ESCAPE '\\' OR c.id LIKE @q ESCAPE '\\')");
      params.q = likeOf(q);
    }
    const sql = `SELECT c.* FROM cases c ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.created_at DESC`;
    res.json(db.prepare(sql).all(params).map(caseWire));
  });

  app.get('/cases/:caseId', (req, res) => {
    const row = getCase.get(req.params.caseId);
    if (!row) return notFound(res, 'case not found');
    const participants = db.prepare('SELECT * FROM case_participants WHERE case_id = ? ORDER BY added_at').all(row.id).map(participantWire);
    const evidence = db.prepare('SELECT * FROM evidence_index WHERE case_id = ? ORDER BY uploaded_at').all(row.id).map(evidenceWire);
    res.json({ ...caseWire(row), participants, evidence });
  });

  app.patch('/cases/:caseId', (req, res) => {
    const row = getCase.get(req.params.caseId);
    if (!row) return notFound(res, 'case not found');
    const b = req.body || {};
    if (b.name !== undefined) {
      if (typeof b.name !== 'string' || !b.name.trim()) return bad(res, 'name must be a non-empty string');
      row.name = b.name.trim();
    }
    if (b.description !== undefined) {
      if (typeof b.description !== 'string') return bad(res, 'description must be a string');
      row.description = b.description;
    }
    if (b.status !== undefined) {
      if (!CASE_STATUSES.includes(b.status)) return bad(res, `status must be one of: ${CASE_STATUSES.join(', ')}`);
      row.status = b.status;
    }
    row.updated_at = nowIso();
    db.prepare('UPDATE cases SET name=@name, description=@description, status=@status, updated_at=@updated_at WHERE id=@id').run(row);
    res.json(caseWire(row));
  });

  // ---- participants ----
  app.post('/cases/:caseId/participants', (req, res) => {
    const row = getCase.get(req.params.caseId);
    if (!row) return notFound(res, 'case not found');
    const b = req.body || {};
    if (typeof b.userId !== 'string' || !b.userId) return bad(res, 'userId is required');
    const role = b.roleInCase === undefined ? 'viewer' : b.roleInCase;
    if (!CASE_ROLES.includes(role)) return bad(res, `roleInCase must be one of: ${CASE_ROLES.join(', ')}`);
    if (getParticipant.get(row.id, b.userId)) return res.status(409).json({ error: 'already a participant' });
    const p = { case_id: row.id, user_id: b.userId, role_in_case: role, added_by: b.addedBy || '', added_at: nowIso() };
    db.prepare(`INSERT INTO case_participants (case_id, user_id, role_in_case, added_by, added_at)
                VALUES (@case_id, @user_id, @role_in_case, @added_by, @added_at)`).run(p);
    res.status(201).json(participantWire(p));
  });

  app.delete('/cases/:caseId/participants/:userId', (req, res) => {
    const out = db.prepare('DELETE FROM case_participants WHERE case_id = ? AND user_id = ?').run(req.params.caseId, req.params.userId);
    if (out.changes === 0) return notFound(res, 'participant not found');
    res.status(204).end();
  });

  // ---- categorization (case <-> evidence linkage, off-chain only) ----
  app.post('/cases/:caseId/evidence', (req, res) => {
    const caseRow = getCase.get(req.params.caseId);
    if (!caseRow) return notFound(res, 'case not found');
    const b = req.body || {};
    if (typeof b.evidenceId !== 'string' || !b.evidenceId) return bad(res, 'evidenceId is required');
    const ev = getEvidence.get(b.evidenceId);
    if (!ev) return notFound(res, 'evidence not found in index');
    if (ev.case_id === caseRow.id) return res.json(evidenceWire(ev)); // idempotent
    if (ev.case_id) return res.status(409).json({ error: 'evidence already assigned to another case', caseId: ev.case_id });
    db.prepare('UPDATE evidence_index SET case_id = ?, last_synced_at = ? WHERE evidence_id = ?').run(caseRow.id, nowIso(), ev.evidence_id);
    res.status(201).json(evidenceWire(getEvidence.get(ev.evidence_id)));
  });

  app.delete('/cases/:caseId/evidence/:evidenceId', (req, res) => {
    const out = db.prepare('UPDATE evidence_index SET case_id = NULL, last_synced_at = ? WHERE evidence_id = ? AND case_id = ?')
      .run(nowIso(), req.params.evidenceId, req.params.caseId);
    if (out.changes === 0) return notFound(res, 'evidence not found in this case');
    res.status(204).end();
  });

  // ---- evidence index (read-model; registered once by the gateway at ingest) ----
  app.post('/evidence-index', (req, res) => {
    const b = req.body || {};
    if (typeof b.evidenceId !== 'string' || !SAFE_ID.test(b.evidenceId)) return bad(res, 'evidenceId must match ^[A-Za-z0-9._:-]+$');
    if (getEvidence.get(b.evidenceId)) return res.status(409).json({ error: 'evidence already indexed' });
    if (b.caseId !== undefined && b.caseId !== null && !getCase.get(b.caseId)) return notFound(res, 'case not found');
    const row = {
      evidence_id: b.evidenceId,
      case_id: b.caseId || null,
      original_filename: b.originalFilename || null,
      mime_type: b.mimeType || null,
      size_bytes: Number.isFinite(b.sizeBytes) ? b.sizeBytes : null,
      integrity_proof: b.integrityProof || null,
      uploaded_by: b.uploadedBy || null,
      uploaded_at: b.uploadedAt || nowIso(),
      status: b.status || 'ACTIVE',
      last_synced_at: nowIso(),
    };
    db.prepare(`INSERT INTO evidence_index (evidence_id, case_id, original_filename, mime_type, size_bytes,
                  integrity_proof, uploaded_by, uploaded_at, status, last_synced_at)
                VALUES (@evidence_id, @case_id, @original_filename, @mime_type, @size_bytes,
                  @integrity_proof, @uploaded_by, @uploaded_at, @status, @last_synced_at)`).run(row);
    res.status(201).json(evidenceWire(row));
  });

  // Search MUST be registered before /evidence-index/:evidenceId would match.
  app.get('/evidence-index', (req, res) => {
    const { caseId, q, uploadedBy, type, from, to, visibleToUserId } = req.query;
    const where = [];
    const params = {};
    if (caseId) { where.push('case_id = @caseId'); params.caseId = caseId; }
    if (uploadedBy) { where.push('uploaded_by = @uploadedBy'); params.uploadedBy = uploadedBy; }
    if (type) { where.push("mime_type LIKE @type ESCAPE '\\'"); params.type = `${String(type).replace(/([\\%_])/g, '\\$1')}%`; }
    if (from) { where.push('uploaded_at >= @from'); params.from = from; }
    if (to) { where.push('uploaded_at <= @to'); params.to = to; }
    if (q) {
      where.push("(evidence_id LIKE @q ESCAPE '\\' OR original_filename LIKE @q ESCAPE '\\')");
      params.q = likeOf(q);
    }
    // Visibility scoping (the gateway passes this for non-admin callers):
    // participant cases, plus own uncategorized uploads.
    if (visibleToUserId) {
      where.push(`(case_id IN (SELECT case_id FROM case_participants WHERE user_id = @vis)
                   OR (case_id IS NULL AND uploaded_by = @vis))`);
      params.vis = visibleToUserId;
    }
    const sql = `SELECT * FROM evidence_index ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY uploaded_at DESC`;
    res.json(db.prepare(sql).all(params).map(evidenceWire));
  });

  app.get('/evidence-index/:evidenceId', (req, res) => {
    const row = getEvidence.get(req.params.evidenceId);
    if (!row) return notFound(res, 'evidence not found in index');
    res.json(evidenceWire(row));
  });

  // Cache sync: the chain stays authoritative; the gateway PATCHes status here
  // after on-chain writes (e.g. REMOVE) so listings track reality.
  app.patch('/evidence-index/:evidenceId', (req, res) => {
    const row = getEvidence.get(req.params.evidenceId);
    if (!row) return notFound(res, 'evidence not found in index');
    const b = req.body || {};
    if (b.status !== undefined) {
      if (typeof b.status !== 'string' || !b.status) return bad(res, 'status must be a non-empty string');
      row.status = b.status;
    }
    row.last_synced_at = nowIso();
    db.prepare('UPDATE evidence_index SET status = @status, last_synced_at = @last_synced_at WHERE evidence_id = @evidence_id').run(row);
    res.json(evidenceWire(row));
  });

  // ---- authz pre-flight (the gateway's per-evidence gate for user sessions) ----
  // Decision matrix: participant of the evidence's case -> allowed (with the
  // case role); uncategorized evidence -> uploader only; unknown -> denied.
  // Admin short-circuits happen in the GATEWAY (it never calls this for admins
  // or the service token).
  app.get('/internal/authz', (req, res) => {
    const { userId, evidenceId } = req.query;
    if (!userId || !evidenceId) return bad(res, 'userId and evidenceId are required');
    const ev = getEvidence.get(evidenceId);
    if (!ev) return res.json({ allowed: false, reason: 'unknown-evidence' });
    if (!ev.case_id) {
      if (ev.uploaded_by === userId) return res.json({ allowed: true, caseId: null, roleInCase: 'uploader' });
      return res.json({ allowed: false, caseId: null, reason: 'uncategorized-not-uploader' });
    }
    const p = getParticipant.get(ev.case_id, userId);
    if (!p) return res.json({ allowed: false, caseId: ev.case_id, reason: 'not-participant' });
    return res.json({ allowed: true, caseId: ev.case_id, roleInCase: p.role_in_case });
  });

  app.locals.config = cfg;
  app.locals.db = db;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const cfg = app.locals.config;
  app.listen(cfg.port, () => {
    console.log(`[case-registry] listening on :${cfg.port} data=${cfg.dataDir}`);
  });
}

module.exports = { createApp };
