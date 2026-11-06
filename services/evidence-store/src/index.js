'use strict';

// GLEIPNIR evidence store. Persists evidence binaries off-chain: in all four
// variants binaries never go on-chain; the ledger holds the ni-URI integrity
// proof this service computes at ingest. Blobs are immutable: one PUT per
// evidenceId (a second PUT is 409), because re-uploading different bytes
// under the same id would silently break the on-chain proof.
//
// Same shape as services/receipt-store: Express, file-per-item persistence,
// the same path-traversal guard. Filesystem only; search lives in
// case-registry, and this service knows nothing about cases.
//
// Internal-only: reached via the gateway, guarded by X-Gleipnir-Internal-Token.

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Restricted charset (no path separators): anything else could escape DATA_DIR.
const SAFE_EVIDENCE_ID = /^[A-Za-z0-9._:-]+$/;

// Constant-time compare of the internal shared secret (OWASP A02): hash both
// sides to a fixed length so timingSafeEqual never throws on a length mismatch
// and the guard can't leak the token by timing.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a == null ? '' : a), 'utf8').digest();
  const bh = crypto.createHash('sha256').update(String(b == null ? '' : b), 'utf8').digest();
  return crypto.timingSafeEqual(ah, bh);
}

// Copied byte-identically from gateway/src/ni.js so both compute the same
// proof (one canonical hash construction, as in docs/CONTRACTS.md §4).
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
  };
}

// Content-Disposition for a possibly-non-ASCII filename. A raw Unicode
// value in an HTTP header throws (header values must be latin1), so we emit both
// an ASCII-only quoted `filename="..."` fallback (non-ASCII and quote/backslash/
// CR/LF replaced with _) and an RFC 5987 `filename*=UTF-8''<pct>` that modern
// browsers prefer and that carries the true name.
function contentDisposition(name) {
  const raw = String(name || 'evidence.bin');
  const asciiFallback = raw.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

// The gateway percent-encodes x-original-filename so non-latin1 names survive
// the HTTP header; decode it back to the true filename for storage.
function decodeOriginalFilename(header) {
  if (!header) return null;
  try { return decodeURIComponent(header); } catch { return header; }
}

// 5xx without leaking internals. Node fs errors embed absolute container
// paths (e.g. "ENOENT ... open '/data/<id>'"); log them server-side and return
// a generic body so the path never reaches the client or the gateway's 502
// detail.
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

  // Shared-secret guard: this service trusts only the gateway (constant-time
  // compare, see safeEqual).
  app.use((req, res, next) => {
    if (!safeEqual(req.get('x-gleipnir-internal-token'), cfg.internalToken)) {
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
      originalFilename: decodeOriginalFilename(req.get('x-original-filename')),
      contentType: req.get('x-content-type') || 'application/octet-stream',
      sizeBytes: bytes.length,
      integrityProof: niUri(bytes),
      storedAt: new Date().toISOString(),
      // DELETE is ingest-rollback-only (docs/CONTRACTS.md §6), enforced
      // server-side: the caller must present this token, returned only to
      // whoever did the PUT, so holding the internal token alone cannot delete
      // committed evidence. Stored in the sidecar, never served.
      rollbackToken: crypto.randomBytes(16).toString('hex'),
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
    return res.status(201).json({
      integrityProof: meta.integrityProof, sizeBytes: meta.sizeBytes, storedAt: meta.storedAt,
      rollbackToken: meta.rollbackToken,
    });
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
    res.set('content-disposition', contentDisposition(meta.originalFilename));
    const stream = fs.createReadStream(blobFor(evidenceId));
    stream.on('error', (err) => {
      if (!res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500);
      res.end();
    });
    stream.pipe(res);
  });

  // Orphan cleanup only: the gateway calls this when an on-chain CreateEvidence
  // fails after the blob write succeeded. Committed evidence is never deleted.
  // The caller must present the rollbackToken returned by this blob's PUT
  // (x-gleipnir-rollback-token), so even with the internal token a caller who
  // did not perform the ingest cannot delete existing evidence. The sidecar is
  // read first to compare.
  app.delete('/blobs/:evidenceId', async (req, res) => {
    const { evidenceId } = req.params;
    let meta;
    try {
      meta = await readMeta(evidenceId);
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'blob not found', evidenceId });
      return serverError(res, 'read failed', err);
    }
    const presented = req.get('x-gleipnir-rollback-token') || '';
    if (!meta.rollbackToken || presented !== meta.rollbackToken) {
      return res.status(403).json({ error: 'delete requires the ingest rollback token (rollback-only)' });
    }
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
