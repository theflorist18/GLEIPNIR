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

// Constant-time compare of the internal shared secret (OWASP A02): hash both
// sides to a fixed length so timingSafeEqual never throws on a length mismatch
// and the guard can't leak the token by timing.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a == null ? '' : a), 'utf8').digest();
  const bh = crypto.createHash('sha256').update(String(b == null ? '' : b), 'utf8').digest();
  return crypto.timingSafeEqual(ah, bh);
}

// Same charset contract as the receipt store's eventId guard (CONTRACTS §6);
// applied to ids that reach SQL params or URLs.
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const CASE_STATUSES = ['OPEN', 'CLOSED', 'ARCHIVED'];
// M20: single evidence flag (or null). A deliberate enum, not free-form tags.
const EVIDENCE_FLAGS = ['HIGH_PRIORITY', 'PROCESSED', 'NEEDS_LEAD_REVIEW'];
// M18 (CONTRACTS §12-8): 'lead' joined the per-case ladder — leads manage the
// roster/config of cases where they hold this role (enforced by the gateway).
const CASE_ROLES = ['viewer', 'contributor', 'lead'];
// M25: every new case starts with a general file-type taxonomy. These are
// ordinary per-case category rows — the lead can rename or delete them (delete
// still refuses when referenced) and add custom ones; nothing is hard-coded
// downstream of creation.
const DEFAULT_CATEGORIES = ['Image', 'Video', 'Audio', 'Text', 'Document', 'PDF', 'Spreadsheet', 'Archive', 'Other'];
// Category listings sort alphabetically with the catch-all 'Other' pinned
// last (SQLite: a boolean expression sorts 0-before-1).
const CATEGORY_ORDER = "(name = 'Other'), name";

function loadConfig() {
  return {
    port: parseInt(process.env.PORT, 10) || 4005,
    dataDir: process.env.DATA_DIR || '/data',
    internalToken: process.env.GLEIPNIR_INTERNAL_TOKEN || 'internal-dev-token',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

const nowIso = () => new Date().toISOString();

// Idempotent column-add guard (M19): the live case-registry-data volume has
// no migration framework, so new nullable columns land via checked ALTERs.
function addColumnIfMissing(db, table, col, ddl) {
  if (!db.pragma(`table_info(${table})`).some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

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
      role_in_case TEXT NOT NULL DEFAULT 'viewer' CHECK (role_in_case IN ('viewer','contributor','lead')),
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
    CREATE TABLE IF NOT EXISTS evidence_categories (
      id         TEXT PRIMARY KEY,
      case_id    TEXT NOT NULL REFERENCES cases(id),
      name       TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (case_id, name)
    );
    CREATE TABLE IF NOT EXISTS evidence_notes (
      id          TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL REFERENCES evidence_index(evidence_id),
      author      TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS case_audit_log (
      id          TEXT PRIMARY KEY,
      case_id     TEXT NOT NULL REFERENCES cases(id),
      ts          TEXT NOT NULL,
      actor       TEXT NOT NULL DEFAULT '',
      type        TEXT NOT NULL,
      evidence_id TEXT,
      target      TEXT,
      detail      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_case_ts ON case_audit_log(case_id, ts);
    CREATE INDEX IF NOT EXISTS idx_notes_evidence ON evidence_notes(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence_index(case_id);
    CREATE INDEX IF NOT EXISTS idx_participants_user ON case_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_categories_case ON evidence_categories(case_id);
  `);
  // M19: forensic ingest metadata — off-chain only, nullable, validated in
  // code (no CHECKs: the volume has live rows and CHECKs cannot be altered).
  addColumnIfMissing(db, 'evidence_index', 'label', 'label TEXT');
  addColumnIfMissing(db, 'evidence_index', 'category_id', 'category_id TEXT');
  addColumnIfMissing(db, 'evidence_index', 'seized_at', 'seized_at TEXT');
  addColumnIfMissing(db, 'evidence_index', 'acquisition_location', 'acquisition_location TEXT');
  addColumnIfMissing(db, 'evidence_index', 'handed_over_by', 'handed_over_by TEXT');
  addColumnIfMissing(db, 'evidence_index', 'flag', 'flag TEXT');
  // M18: role_in_case gained 'lead'. SQLite cannot ALTER a CHECK constraint,
  // so a pre-M18 table (its stored DDL lacks 'lead') is rebuilt in place —
  // transactional, and idempotent because the second boot sees 'lead' in
  // sqlite_master. Fresh databases take the CREATE above and skip this.
  const cp = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='case_participants'").get();
  if (cp && !cp.sql.includes("'lead'")) {
    db.exec(`
      BEGIN;
      CREATE TABLE case_participants_m18 (
        case_id      TEXT NOT NULL REFERENCES cases(id),
        user_id      TEXT NOT NULL,
        role_in_case TEXT NOT NULL DEFAULT 'viewer' CHECK (role_in_case IN ('viewer','contributor','lead')),
        added_by     TEXT NOT NULL,
        added_at     TEXT NOT NULL,
        PRIMARY KEY (case_id, user_id)
      );
      INSERT INTO case_participants_m18 SELECT case_id, user_id, role_in_case, added_by, added_at FROM case_participants;
      DROP TABLE case_participants;
      ALTER TABLE case_participants_m18 RENAME TO case_participants;
      CREATE INDEX IF NOT EXISTS idx_participants_user ON case_participants(user_id);
      COMMIT;
    `);
  }
  return db;
}

// Row -> wire shape (camelCase; docs/CONTRACTS.md pins these). my_role is
// present only on participant-filtered listings (M18: `myRoleInCase`).
const caseWire = (r) => r && ({
  id: r.id, name: r.name, description: r.description, status: r.status,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.my_role !== undefined && r.my_role !== null ? { myRoleInCase: r.my_role } : {}),
});
const participantWire = (r) => ({
  userId: r.user_id, roleInCase: r.role_in_case, addedBy: r.added_by, addedAt: r.added_at,
});
const evidenceWire = (r) => r && ({
  evidenceId: r.evidence_id, caseId: r.case_id, originalFilename: r.original_filename,
  mimeType: r.mime_type, sizeBytes: r.size_bytes, integrityProof: r.integrity_proof,
  uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, status: r.status,
  lastSyncedAt: r.last_synced_at,
  label: r.label ?? null, categoryId: r.category_id ?? null, seizedAt: r.seized_at ?? null,
  acquisitionLocation: r.acquisition_location ?? null, handedOverBy: r.handed_over_by ?? null,
  flag: r.flag ?? null,
});
const noteWire = (r) => r && ({
  id: r.id, evidenceId: r.evidence_id, author: r.author, body: r.body, createdAt: r.created_at,
});
const categoryWire = (r) => r && ({
  id: r.id, caseId: r.case_id, name: r.name, createdBy: r.created_by, createdAt: r.created_at,
});

// LIKE-escape so a search term containing % or _ matches literally.
const likeOf = (q) => `%${String(q).replace(/([\\%_])/g, '\\$1')}%`;

// S19: bound list/search result sets so a query can never return an unbounded
// set. Optional ?limit override, itself capped. (The activity feed already caps
// its own results; this covers /cases and /evidence-index search.)
const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 1000;
const boundedLimit = (q) => {
  const n = parseInt(q, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
};

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = openDb(cfg.dataDir);

  // M25 backfill: cases that predate preset seeding start with an empty
  // taxonomy, which leaves the ingest wizard's category picker empty. Any
  // ZERO-category case gets the current preset set on boot (attributed to the
  // case creator); a case whose lead already defined categories — including a
  // partial preset set — is left untouched.
  db.transaction(() => {
    const insert = db.prepare('INSERT INTO evidence_categories (id, case_id, name, created_by, created_at) VALUES (@id, @case_id, @name, @created_by, @created_at)');
    const empty = db.prepare(`SELECT c.id, c.created_by FROM cases c
                              WHERE NOT EXISTS (SELECT 1 FROM evidence_categories ec WHERE ec.case_id = c.id)`).all();
    for (const c of empty) {
      for (const name of DEFAULT_CATEGORIES) {
        insert.run({ id: `cat-${crypto.randomUUID()}`, case_id: c.id, name, created_by: c.created_by, created_at: nowIso() });
      }
    }
    if (empty.length > 0) console.log(`[case-registry] seeded preset categories into ${empty.length} pre-M25 case(s)`);
  })();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Shared-secret guard: this service trusts only the gateway. Constant-time
  // compare (OWASP A02) — hash both sides to a fixed length so timingSafeEqual
  // never throws on a length mismatch and the check can't leak the token by
  // timing.
  app.use((req, res, next) => {
    if (!safeEqual(req.get('x-gleipnir-internal-token'), cfg.internalToken)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    // M25b: the acting username, attributed by the GATEWAY (session-derived,
    // never client-supplied on user sessions). Empty for service-token calls.
    req.actor = req.get('x-gleipnir-actor') || '';
    return next();
  });

  const bad = (res, msg) => res.status(400).json({ error: msg });
  const notFound = (res, msg) => res.status(404).json({ error: msg });

  const getCase = db.prepare('SELECT * FROM cases WHERE id = ?');
  const getEvidence = db.prepare('SELECT * FROM evidence_index WHERE evidence_id = ?');
  const getParticipant = db.prepare('SELECT * FROM case_participants WHERE case_id = ? AND user_id = ?');

  // ---- case audit log (M25b) ----
  // Append-only, one row per management action, written in the SAME
  // transaction as the mutation it records. This is the library's own log —
  // evidence ACCESS (view/download/export) stays on-chain per evidence (the
  // thesis's CoC trail); duplicating it here would create a second source of
  // truth. No update/delete routes exist: immutable-by-API, like notes.
  const insertAudit = db.prepare(`INSERT INTO case_audit_log (id, case_id, ts, actor, type, evidence_id, target, detail)
    VALUES (@id, @case_id, @ts, @actor, @type, @evidence_id, @target, @detail)`);
  function audit(caseId, type, { actor = '', evidenceId = null, target = null, detail = null, ts = null } = {}) {
    insertAudit.run({
      id: `evt-${crypto.randomUUID()}`, case_id: caseId, ts: ts || nowIso(), actor, type,
      evidence_id: evidenceId, target, detail: detail === null ? null : JSON.stringify(detail),
    });
  }

  // History backfill, once per case: the M20 feed was SYNTHESIZED from
  // timestamped rows (so participant removals etc. were invisible). Cases
  // with zero audit rows get their derivable history materialized with the
  // original timestamps; from then on every event is a real appended row.
  db.transaction(() => {
    const bare = db.prepare(`SELECT c.* FROM cases c
                             WHERE NOT EXISTS (SELECT 1 FROM case_audit_log a WHERE a.case_id = c.id)`).all();
    for (const row of bare) {
      audit(row.id, 'CASE_CREATED', { actor: row.created_by, ts: row.created_at });
      if (row.updated_at !== row.created_at) {
        audit(row.id, 'CASE_UPDATED', { ts: row.updated_at, detail: { status: row.status } });
      }
      for (const p of db.prepare('SELECT * FROM case_participants WHERE case_id = ?').all(row.id)) {
        audit(row.id, 'PARTICIPANT_ADDED', { actor: p.added_by, ts: p.added_at, target: p.user_id, detail: { roleInCase: p.role_in_case } });
      }
      for (const e of db.prepare('SELECT * FROM evidence_index WHERE case_id = ?').all(row.id)) {
        audit(row.id, 'EVIDENCE_ADDED', { actor: e.uploaded_by || '', ts: e.uploaded_at, evidenceId: e.evidence_id, detail: { label: e.label ?? null } });
      }
      const notes = db.prepare(`SELECT n.* FROM evidence_notes n JOIN evidence_index e ON e.evidence_id = n.evidence_id WHERE e.case_id = ?`).all(row.id);
      for (const n of notes) {
        audit(row.id, 'NOTE_ADDED', { actor: n.author, ts: n.created_at, evidenceId: n.evidence_id, detail: { noteId: n.id } });
      }
    }
    if (bare.length > 0) console.log(`[case-registry] backfilled audit history for ${bare.length} case(s)`);
  })();

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
    const insertCategory = db.prepare('INSERT INTO evidence_categories (id, case_id, name, created_by, created_at) VALUES (@id, @case_id, @name, @created_by, @created_at)');
    db.transaction(() => {
      db.prepare(`INSERT INTO cases (id, name, description, status, created_by, created_at, updated_at)
                  VALUES (@id, @name, @description, @status, @created_by, @created_at, @updated_at)`).run(row);
      for (const name of DEFAULT_CATEGORIES) {
        insertCategory.run({ id: `cat-${crypto.randomUUID()}`, case_id: row.id, name, created_by: b.createdBy, created_at: now });
      }
      audit(row.id, 'CASE_CREATED', { actor: b.createdBy, ts: now, detail: { seededCategories: DEFAULT_CATEGORIES.length } });
    })();
    res.status(201).json(caseWire(row));
  });

  app.get('/cases', (req, res) => {
    const { participant, status, q } = req.query;
    if (status !== undefined && !CASE_STATUSES.includes(status)) return bad(res, `status must be one of: ${CASE_STATUSES.join(', ')}`);
    const where = [];
    const params = {};
    if (participant) {
      where.push('cp.user_id = @participant');
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
    // Participant-filtered listings join the roster so each row carries the
    // caller's own role (myRoleInCase); unfiltered listings stay role-free.
    params.__limit = boundedLimit(req.query.limit);
    const sql = participant
      ? `SELECT c.*, cp.role_in_case AS my_role FROM cases c JOIN case_participants cp ON cp.case_id = c.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.created_at DESC LIMIT @__limit`
      : `SELECT c.* FROM cases c ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.created_at DESC LIMIT @__limit`;
    res.json(db.prepare(sql).all(params).map(caseWire));
  });

  app.get('/cases/:caseId', (req, res) => {
    const row = getCase.get(req.params.caseId);
    if (!row) return notFound(res, 'case not found');
    const participants = db.prepare('SELECT * FROM case_participants WHERE case_id = ? ORDER BY added_at').all(row.id).map(participantWire);
    const evidence = db.prepare('SELECT * FROM evidence_index WHERE case_id = ? ORDER BY uploaded_at').all(row.id).map(evidenceWire);
    const categories = db.prepare(`SELECT * FROM evidence_categories WHERE case_id = ? ORDER BY ${CATEGORY_ORDER}`).all(row.id).map(categoryWire);
    res.json({ ...caseWire(row), participants, evidence, categories });
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
    db.transaction(() => {
      db.prepare('UPDATE cases SET name=@name, description=@description, status=@status, updated_at=@updated_at WHERE id=@id').run(row);
      audit(row.id, 'CASE_UPDATED', {
        actor: req.actor, ts: row.updated_at,
        detail: { fields: ['name', 'description', 'status'].filter((k) => b[k] !== undefined), status: row.status },
      });
    })();
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
    db.transaction(() => {
      db.prepare(`INSERT INTO case_participants (case_id, user_id, role_in_case, added_by, added_at)
                  VALUES (@case_id, @user_id, @role_in_case, @added_by, @added_at)`).run(p);
      audit(row.id, 'PARTICIPANT_ADDED', { actor: p.added_by || req.actor, ts: p.added_at, target: p.user_id, detail: { roleInCase: role } });
    })();
    res.status(201).json(participantWire(p));
  });

  // M25: change a participant's case role in place (the alternative was a
  // remove+re-add dance that briefly dropped access). Policy (who may call,
  // last-lead demotion, global-lead targets) lives in the gateway.
  app.patch('/cases/:caseId/participants/:userId', (req, res) => {
    const p = getParticipant.get(req.params.caseId, req.params.userId);
    if (!p) return notFound(res, 'participant not found');
    const role = (req.body || {}).roleInCase;
    if (!CASE_ROLES.includes(role)) return bad(res, `roleInCase must be one of: ${CASE_ROLES.join(', ')}`);
    db.transaction(() => {
      db.prepare('UPDATE case_participants SET role_in_case = ? WHERE case_id = ? AND user_id = ?').run(role, p.case_id, p.user_id);
      if (role !== p.role_in_case) {
        audit(p.case_id, 'PARTICIPANT_ROLE_CHANGED', { actor: req.actor, target: p.user_id, detail: { from: p.role_in_case, to: role } });
      }
    })();
    res.json(participantWire(getParticipant.get(p.case_id, p.user_id)));
  });

  app.delete('/cases/:caseId/participants/:userId', (req, res) => {
    const p = getParticipant.get(req.params.caseId, req.params.userId);
    if (!p) return notFound(res, 'participant not found');
    db.transaction(() => {
      db.prepare('DELETE FROM case_participants WHERE case_id = ? AND user_id = ?').run(p.case_id, p.user_id);
      audit(p.case_id, 'PARTICIPANT_REMOVED', { actor: req.actor, target: p.user_id, detail: { roleInCase: p.role_in_case } });
    })();
    res.status(204).end();
  });

  // ---- evidence categories (M19): per-case taxonomy, lead-managed via the
  // gateway. Deleting a category referenced by evidence is refused (409) —
  // forensic metadata never silently disappears.
  const getCategory = db.prepare('SELECT * FROM evidence_categories WHERE id = ?');

  app.post('/cases/:caseId/categories', (req, res) => {
    const caseRow = getCase.get(req.params.caseId);
    if (!caseRow) return notFound(res, 'case not found');
    const b = req.body || {};
    if (typeof b.name !== 'string' || !b.name.trim()) return bad(res, 'name is required');
    if (typeof b.createdBy !== 'string' || !b.createdBy) return bad(res, 'createdBy is required');
    const row = { id: `cat-${crypto.randomUUID()}`, case_id: caseRow.id, name: b.name.trim(), created_by: b.createdBy, created_at: nowIso() };
    try {
      db.transaction(() => {
        db.prepare('INSERT INTO evidence_categories (id, case_id, name, created_by, created_at) VALUES (@id, @case_id, @name, @created_by, @created_at)').run(row);
        audit(caseRow.id, 'CATEGORY_CREATED', { actor: b.createdBy, ts: row.created_at, target: row.id, detail: { name: row.name } });
      })();
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'a category with this name already exists in the case' });
      throw err;
    }
    res.status(201).json(categoryWire(row));
  });

  app.get('/cases/:caseId/categories', (req, res) => {
    if (!getCase.get(req.params.caseId)) return notFound(res, 'case not found');
    res.json(db.prepare(`SELECT * FROM evidence_categories WHERE case_id = ? ORDER BY ${CATEGORY_ORDER}`).all(req.params.caseId).map(categoryWire));
  });

  app.patch('/cases/:caseId/categories/:categoryId', (req, res) => {
    const row = getCategory.get(req.params.categoryId);
    if (!row || row.case_id !== req.params.caseId) return notFound(res, 'category not found');
    const b = req.body || {};
    if (typeof b.name !== 'string' || !b.name.trim()) return bad(res, 'name is required');
    try {
      db.transaction(() => {
        db.prepare('UPDATE evidence_categories SET name = ? WHERE id = ?').run(b.name.trim(), row.id);
        audit(row.case_id, 'CATEGORY_RENAMED', { actor: req.actor, target: row.id, detail: { from: row.name, to: b.name.trim() } });
      })();
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'a category with this name already exists in the case' });
      throw err;
    }
    res.json(categoryWire(getCategory.get(row.id)));
  });

  app.delete('/cases/:caseId/categories/:categoryId', (req, res) => {
    const row = getCategory.get(req.params.categoryId);
    if (!row || row.case_id !== req.params.caseId) return notFound(res, 'category not found');
    const inUse = db.prepare('SELECT COUNT(*) AS n FROM evidence_index WHERE category_id = ?').get(row.id).n;
    if (inUse > 0) return res.status(409).json({ error: 'category is referenced by evidence', count: inUse });
    db.transaction(() => {
      db.prepare('DELETE FROM evidence_categories WHERE id = ?').run(row.id);
      audit(row.case_id, 'CATEGORY_DELETED', { actor: req.actor, target: row.id, detail: { name: row.name } });
    })();
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
    db.transaction(() => {
      db.prepare('UPDATE evidence_index SET case_id = ?, last_synced_at = ? WHERE evidence_id = ?').run(caseRow.id, nowIso(), ev.evidence_id);
      audit(caseRow.id, 'EVIDENCE_ASSIGNED', { actor: req.actor, evidenceId: ev.evidence_id, detail: { label: ev.label ?? null } });
    })();
    res.status(201).json(evidenceWire(getEvidence.get(ev.evidence_id)));
  });

  app.delete('/cases/:caseId/evidence/:evidenceId', (req, res) => {
    // Uncategorizing also clears the case-scoped category (M19): a category
    // belongs to the case the evidence is leaving.
    const ev = getEvidence.get(req.params.evidenceId);
    if (!ev || ev.case_id !== req.params.caseId) return notFound(res, 'evidence not found in this case');
    db.transaction(() => {
      db.prepare('UPDATE evidence_index SET case_id = NULL, category_id = NULL, last_synced_at = ? WHERE evidence_id = ?')
        .run(nowIso(), ev.evidence_id);
      audit(req.params.caseId, 'EVIDENCE_UNASSIGNED', { actor: req.actor, evidenceId: ev.evidence_id, detail: { label: ev.label ?? null } });
    })();
    res.status(204).end();
  });

  // M19 metadata fields (all optional, off-chain only): string sets, null
  // clears. categoryId must reference a category of the evidence's own case.
  const META_FIELDS = [
    ['label', 'label'],
    ['seizedAt', 'seized_at'],
    ['acquisitionLocation', 'acquisition_location'],
    ['handedOverBy', 'handed_over_by'],
  ];
  // Returns an {column: value} patch or writes a 400/404 and returns null.
  function metaPatchOf(b, caseId, res) {
    const patch = {};
    for (const [wire, col] of META_FIELDS) {
      if (b[wire] === undefined) continue;
      if (b[wire] !== null && typeof b[wire] !== 'string') { bad(res, `${wire} must be a string or null`); return null; }
      patch[col] = b[wire];
    }
    if (b.categoryId !== undefined) {
      if (b.categoryId === null) {
        patch.category_id = null;
      } else {
        const cat = getCategory.get(b.categoryId);
        if (!cat) { notFound(res, 'category not found'); return null; }
        if (!caseId || cat.case_id !== caseId) { bad(res, 'category does not belong to the evidence\'s case'); return null; }
        patch.category_id = b.categoryId;
      }
    }
    return patch;
  }

  // ---- evidence index (read-model; registered once by the gateway at ingest) ----
  app.post('/evidence-index', (req, res) => {
    const b = req.body || {};
    if (typeof b.evidenceId !== 'string' || !SAFE_ID.test(b.evidenceId)) return bad(res, 'evidenceId must match ^[A-Za-z0-9._:-]+$');
    if (getEvidence.get(b.evidenceId)) return res.status(409).json({ error: 'evidence already indexed' });
    if (b.caseId !== undefined && b.caseId !== null && !getCase.get(b.caseId)) return notFound(res, 'case not found');
    const meta = metaPatchOf(b, b.caseId || null, res);
    if (meta === null) return undefined;
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
      label: null,
      category_id: null,
      seized_at: null,
      acquisition_location: null,
      handed_over_by: null,
      ...meta,
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO evidence_index (evidence_id, case_id, original_filename, mime_type, size_bytes,
                    integrity_proof, uploaded_by, uploaded_at, status, last_synced_at,
                    label, category_id, seized_at, acquisition_location, handed_over_by)
                  VALUES (@evidence_id, @case_id, @original_filename, @mime_type, @size_bytes,
                    @integrity_proof, @uploaded_by, @uploaded_at, @status, @last_synced_at,
                    @label, @category_id, @seized_at, @acquisition_location, @handed_over_by)`).run(row);
      if (row.case_id) {
        audit(row.case_id, 'EVIDENCE_ADDED', { actor: row.uploaded_by || req.actor, ts: row.uploaded_at, evidenceId: row.evidence_id, detail: { label: row.label ?? null } });
      }
    })();
    return res.status(201).json(evidenceWire(row));
  });

  // Search MUST be registered before /evidence-index/:evidenceId would match.
  app.get('/evidence-index', (req, res) => {
    const { caseId, q, uploadedBy, type, from, to, visibleToUserId, flag } = req.query;
    const where = [];
    const params = {};
    if (caseId) { where.push('case_id = @caseId'); params.caseId = caseId; }
    if (flag) {
      if (!EVIDENCE_FLAGS.includes(flag)) return bad(res, `flag must be one of: ${EVIDENCE_FLAGS.join(', ')}`);
      where.push('flag = @flag'); params.flag = flag;
    }
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
    params.__limit = boundedLimit(req.query.limit);
    const sql = `SELECT * FROM evidence_index ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY uploaded_at DESC LIMIT @__limit`;
    res.json(db.prepare(sql).all(params).map(evidenceWire));
  });

  app.get('/evidence-index/:evidenceId', (req, res) => {
    const row = getEvidence.get(req.params.evidenceId);
    if (!row) return notFound(res, 'evidence not found in index');
    res.json(evidenceWire(row));
  });

  // Cache sync + metadata updates: the chain stays authoritative for status
  // (the gateway PATCHes it after on-chain writes, e.g. REMOVE); the M19
  // metadata fields are library-owned and validated here.
  app.patch('/evidence-index/:evidenceId', (req, res) => {
    const row = getEvidence.get(req.params.evidenceId);
    if (!row) return notFound(res, 'evidence not found in index');
    const before = { status: row.status, flag: row.flag ?? null };
    const b = req.body || {};
    if (b.status !== undefined) {
      if (typeof b.status !== 'string' || !b.status) return bad(res, 'status must be a non-empty string');
      row.status = b.status;
    }
    const meta = metaPatchOf(b, row.case_id, res);
    if (meta === null) return undefined;
    Object.assign(row, meta);
    if (b.flag !== undefined) {
      if (b.flag !== null && !EVIDENCE_FLAGS.includes(b.flag)) {
        return bad(res, `flag must be null or one of: ${EVIDENCE_FLAGS.join(', ')}`);
      }
      row.flag = b.flag;
    }
    row.last_synced_at = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE evidence_index SET status = @status, last_synced_at = @last_synced_at,
                    label = @label, category_id = @category_id, seized_at = @seized_at,
                    acquisition_location = @acquisition_location, handed_over_by = @handed_over_by,
                    flag = @flag
                  WHERE evidence_id = @evidence_id`).run(row);
      if (row.case_id) {
        const opts = { actor: req.actor, evidenceId: row.evidence_id };
        if (row.status === 'REMOVED' && before.status !== 'REMOVED') {
          audit(row.case_id, 'EVIDENCE_REMOVED', { ...opts, detail: { label: row.label ?? null } });
        }
        if (b.flag !== undefined && (row.flag ?? null) !== before.flag) {
          audit(row.case_id, 'FLAG_CHANGED', { ...opts, detail: { from: before.flag, to: row.flag ?? null } });
        }
        const metaKeys = Object.keys(meta);
        if (metaKeys.length > 0) {
          audit(row.case_id, 'EVIDENCE_DETAILS_UPDATED', { ...opts, detail: { fields: metaKeys.map((k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())) } });
        }
      }
    })();
    return res.json(evidenceWire(row));
  });

  // ---- examiner notes (M20): append-only by design. There are NO update or
  // delete routes — a note, once written, is immutable through this API.
  app.post('/evidence-index/:evidenceId/notes', (req, res) => {
    const ev = getEvidence.get(req.params.evidenceId);
    if (!ev) return notFound(res, 'evidence not found in index');
    const b = req.body || {};
    if (typeof b.author !== 'string' || !b.author) return bad(res, 'author is required');
    if (typeof b.body !== 'string' || !b.body.trim()) return bad(res, 'body is required');
    const row = { id: `note-${crypto.randomUUID()}`, evidence_id: ev.evidence_id, author: b.author, body: b.body, created_at: nowIso() };
    db.transaction(() => {
      db.prepare('INSERT INTO evidence_notes (id, evidence_id, author, body, created_at) VALUES (@id, @evidence_id, @author, @body, @created_at)').run(row);
      if (ev.case_id) {
        audit(ev.case_id, 'NOTE_ADDED', { actor: b.author, ts: row.created_at, evidenceId: ev.evidence_id, detail: { noteId: row.id } });
      }
    })();
    res.status(201).json(noteWire(row));
  });

  app.get('/evidence-index/:evidenceId/notes', (req, res) => {
    if (!getEvidence.get(req.params.evidenceId)) return notFound(res, 'evidence not found in index');
    res.json(db.prepare('SELECT * FROM evidence_notes WHERE evidence_id = ? ORDER BY created_at, id').all(req.params.evidenceId).map(noteWire));
  });

  // ---- case activity feed. M20 synthesized this from timestamped rows;
  // M25b reads the persistent append-only case_audit_log instead, so events
  // with no surviving row (participant removals, category deletes, role
  // changes) finally appear — and history survives the source rows changing.
  const auditWire = (r) => ({
    id: r.id, type: r.type, ts: r.ts, actor: r.actor || undefined,
    ...(r.evidence_id ? { evidenceId: r.evidence_id } : {}),
    ...(r.target ? { target: r.target } : {}),
    ...(r.detail ? { detail: JSON.parse(r.detail) } : {}),
  });

  app.get('/cases/:caseId/activity', (req, res) => {
    const row = getCase.get(req.params.caseId);
    if (!row) return notFound(res, 'case not found');
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = db.prepare('SELECT * FROM case_audit_log WHERE case_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(row.id, limit);
    res.json(rows.map(auditWire));
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
