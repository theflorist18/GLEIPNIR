'use strict';

// GLEIPNIR evidence store (M13b). Persists evidence BINARIES off-chain — the
// semantic invariant across all four variants is that binaries never go
// on-chain; what the ledger holds is the ni-URI integrity proof this service
// computes at ingest. Blobs are IMMUTABLE: one PUT per evidenceId, ever
// (a second PUT is 409) — re-uploading different bytes under the same id would
// silently break the on-chain proof, so the API forbids it.
//
// Direct architectural sibling of services/receipt-store: same Express shape,
// same file-per-item persistence, same path-traversal guard. Filesystem only —
// search lives in case-registry; this service knows nothing about cases.
//
// Internal-only: reached via the gateway, guarded by X-Gleipnir-Internal-Token.

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Charset per docs/CONTRACTS.md §6 — anything else could escape DATA_DIR.
const SAFE_EVIDENCE_ID = /^[A-Za-z0-9._:-]+$/;

// Copied byte-identically from gateway/src/ni.js — the SAME hashing scheme the
// gateway used before this service existed (docs/CONTRACTS.md §4 discipline:
// one canonical hash implementation, no reinvention).
//   ni:///sha-256;<base64url( sha256(bytes) )>   (no padding, RFC 6920 §3)
function niUri(bytes) {
  const digest = crypto.createHash('sha256').update(bytes).digest();
  return `ni:///sha-256;${digest.toString('base64url')}`;
}

function loadConfig() {
  return {
    port: parseInt(process.env.PORT, 10) || 4006,
    dataDir: process.env.DATA_DIR || '/data',
    internalToken: process.env.GLEIPNIR_INTERNAL_TOKEN || 'internal-dev-token',
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 26214400, // 25 MiB
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

// Strip anything that could break out of a quoted Content-Disposition value.
const dispositionName = (name) => String(name || 'evidence.bin').replace(/["\\\r\n]/g, '_');

// 5xx without leaking internals (S16). Node fs errors embed absolute container
// paths (e.g. "ENOENT ... open '/data/<id>'"); log them server-side and return
// a generic body so the path never reaches the client (or the gateway's 502
// detail, before the S15 fix strips that too).
function serverError(res, label, err) {
  console.error(`[evidence-store] ${label}:`, (err && err.stack) || err);
  return res.status(500).json({ error: label });
}

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  fs.mkdirSync(cfg.dataDir, { recursive: true });

  const blobFor = (evidenceId) => path.join(cfg.dataDir, evidenceId);
  const metaFor = (evidenceId) => path.join(cfg.dataDir, `${evidenceId}.meta.json`);

  const app = express();

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Shared-secret guard: this service trusts only the gateway.
  app.use((req, res, next) => {
    if (req.get('x-gleipnir-internal-token') !== cfg.internalToken) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  });

  // evidenceId guard for every /blobs/:evidenceId route. The extra .meta.json
  // suffix rule keeps a blob named "x.meta.json" from colliding with the
  // sidecar of evidence "x" (blob and sidecar share DATA_DIR).
  app.param('evidenceId', (req, res, next, evidenceId) => {
    if (!SAFE_EVIDENCE_ID.test(evidenceId) || evidenceId.endsWith('.meta.json')) {
      return res.status(400).json({ error: 'invalid evidenceId' });
    }
    return next();
  });

  const readMeta = async (evidenceId) => JSON.parse(await fsp.readFile(metaFor(evidenceId), 'utf8'));

  app.put('/blobs/:evidenceId', express.raw({ type: () => true, limit: cfg.maxUploadBytes }), async (req, res) => {
    const { evidenceId } = req.params;
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) return res.status(400).json({ error: 'empty body' });
    const meta = {
      evidenceId,
      originalFilename: req.get('x-original-filename') || null,
      contentType: req.get('x-content-type') || 'application/octet-stream',
      sizeBytes: bytes.length,
      integrityProof: niUri(bytes),
      storedAt: new Date().toISOString(),
    };
    try {
      // 'wx' = exclusive create: immutability is enforced at the filesystem,
      // so two concurrent PUTs cannot both win.
      await fsp.writeFile(blobFor(evidenceId), bytes, { flag: 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') return res.status(409).json({ error: 'blob already exists (immutable)', evidenceId });
      return serverError(res, 'write failed', err);
    }
    try {
      await fsp.writeFile(metaFor(evidenceId), JSON.stringify(meta, null, 2), 'utf8');
    } catch (err) {
      return serverError(res, 'meta write failed', err);
    }
    return res.status(201).json({ integrityProof: meta.integrityProof, sizeBytes: meta.sizeBytes, storedAt: meta.storedAt });
  });

  app.get('/blobs/:evidenceId', async (req, res) => {
    const { evidenceId } = req.params;
    let meta;
    try {
      meta = await readMeta(evidenceId);
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'blob not found', evidenceId });
      return serverError(res, 'read failed', err);
    }
    res.set('content-type', meta.contentType || 'application/octet-stream');
    res.set('content-length', String(meta.sizeBytes));
    res.set('content-disposition', `attachment; filename="${dispositionName(meta.originalFilename)}"`);
    const stream = fs.createReadStream(blobFor(evidenceId));
    stream.on('error', (err) => {
      if (!res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500);
      res.end();
    });
    stream.pipe(res);
  });

  app.get('/blobs/:evidenceId/meta', async (req, res) => {
    try {
      res.json(await readMeta(req.params.evidenceId));
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'blob not found', evidenceId: req.params.evidenceId });
      return serverError(res, 'read failed', err);
    }
  });

  // Recompute the hash from the stored bytes and compare. `expected` defaults
  // to the proof recorded at ingest, so a bare /verify detects disk-level
  // tampering; the gateway passes the ON-CHAIN proof to detect divergence
  // from the ledger.
  app.get('/blobs/:evidenceId/verify', async (req, res) => {
    const { evidenceId } = req.params;
    let bytes;
    let meta;
    try {
      [bytes, meta] = [await fsp.readFile(blobFor(evidenceId)), await readMeta(evidenceId)];
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'blob not found', evidenceId });
      return serverError(res, 'read failed', err);
    }
    const actual = niUri(bytes);
    const expected = req.query.expected || meta.integrityProof;
    res.json({ ok: actual === expected, expected, actual, sizeBytes: bytes.length });
  });

  // Orphan cleanup only: the gateway calls this when an on-chain CreateEvidence
  // fails AFTER the blob write succeeded. Committed evidence is never deleted.
  app.delete('/blobs/:evidenceId', async (req, res) => {
    const { evidenceId } = req.params;
    try {
      await fsp.unlink(blobFor(evidenceId));
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'blob not found', evidenceId });
      return serverError(res, 'delete failed', err);
    }
    await fsp.unlink(metaFor(evidenceId)).catch(() => { /* sidecar may not exist */ });
    return res.status(204).end();
  });

  app.locals.config = cfg;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const cfg = app.locals.config;
  app.listen(cfg.port, () => {
    console.log(`[evidence-store] listening on :${cfg.port} data=${cfg.dataDir}`);
  });
}

module.exports = { createApp };
