'use strict';

// GLEIPNIR receipt-store (port 4002).
// Persists each event's off-chain witness = { leafHash, siblingPath[], batchId,
// leafIndex, rootRef } plus the CoC event body itself and its evidenceId, one
// JSON file per eventId under DATA_DIR. A per-evidence index
// (DATA_DIR/idx/<evidenceId>.txt, one eventId per line, first-PUT order) lets
// the gateway read an evidence's off-chain trail in the anchored variants:
// GET /receipts?evidenceId=X.
//
// Intentionally not hardened: no hash chains, signatures, replication or
// integrity proofs on the stored receipts or on the index, and none should be
// added. Only the Merkle root is on-chain and tamper-evident; the sibling path
// and the event copy live here, off-chain. Losing or corrupting a receipt is an
// availability exposure of the witness (the proof can no longer be
// reconstructed), not an integrity exposure of the ledger (the anchored root
// still cannot be forged; a tampered event copy fails root verification).
// This weaker guarantee is a measured property of the anchored designs, so
// hardening the store would remove the thing being measured.

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// eventId / evidenceId charset (docs/CONTRACTS.md §6): anything else is
// rejected 400 so a file can never escape DATA_DIR or collide with a path
// separator.
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

function loadConfig() {
  return {
    port: parseInt(process.env.PORT, 10) || 4002,
    dataDir: process.env.DATA_DIR || '/data',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  const idxDir = path.join(cfg.dataDir, 'idx');
  fs.mkdirSync(idxDir, { recursive: true });
  const log = (...a) => { if (cfg.logLevel !== 'silent') console.log('[receipt-store]', ...a); };
  const fileFor = (eventId) => path.join(cfg.dataDir, `${eventId}.json`);
  const idxFor = (evidenceId) => path.join(idxDir, `${evidenceId}.txt`);

  // eventIds listed for an evidence, in first-PUT order ([] if none).
  async function readIndex(evidenceId) {
    try {
      const text = await fsp.readFile(idxFor(evidenceId), 'utf8');
      // De-dupe defensively: the append below is check-then-append, not atomic.
      return [...new Set(text.split('\n').filter(Boolean))];
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  // Idempotent: every receipt is PUT twice (before/after the root txId), and
  // the index must list each eventId once.
  // Known limit: check-then-append is not atomic across concurrent PUTs of the
  // same eventId. The batcher PUTs a batch's receipts sequentially, so the only
  // exposure is a cross-batch retry of one eventId, and readIndex de-dupes on
  // read; if concurrent writers ever matter, serialise appends per evidenceId.
  async function indexAppend(evidenceId, eventId) {
    const listed = await readIndex(evidenceId);
    if (listed.includes(eventId)) return;
    await fsp.appendFile(idxFor(evidenceId), `${eventId}\n`, 'utf8');
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Upsert (full-document overwrite) — receipts are re-PUT once the root commits
  // to fill in rootRef.txId. A body carrying `evidenceId` is also indexed.
  app.put('/receipts/:eventId', async (req, res) => {
    const { eventId } = req.params;
    if (!SAFE_ID.test(eventId)) {
      return res.status(400).json({ error: 'invalid eventId' });
    }
    const evidenceId = req.body && req.body.evidenceId;
    if (evidenceId !== undefined && !(typeof evidenceId === 'string' && SAFE_ID.test(evidenceId))) {
      return res.status(400).json({ error: 'invalid evidenceId' });
    }
    try {
      await fsp.writeFile(fileFor(eventId), JSON.stringify(req.body), 'utf8');
      if (evidenceId) await indexAppend(evidenceId, eventId);
      return res.json({ ok: true, eventId });
    } catch (err) {
      return res.status(500).json({ error: 'write failed', detail: String(err && err.message) });
    }
  });

  // Off-chain trail: every receipt indexed under an evidenceId, in index order.
  app.get('/receipts', async (req, res) => {
    const { evidenceId } = req.query;
    if (typeof evidenceId !== 'string' || !SAFE_ID.test(evidenceId)) {
      return res.status(400).json({ error: 'evidenceId query required' });
    }
    try {
      const out = [];
      for (const eventId of await readIndex(evidenceId)) {
        try {
          out.push(JSON.parse(await fsp.readFile(fileFor(eventId), 'utf8')));
        } catch (err) {
          // Index lists it but the receipt file is gone/corrupt: the witness is
          // unavailable (availability exposure, by design) — skip, say so.
          if (!(err && err.code === 'ENOENT') && !(err instanceof SyntaxError)) throw err;
          log(`index ${evidenceId} lists ${eventId} but its receipt is unreadable: ${err.code || err.message}`);
        }
      }
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ error: 'read failed', detail: String(err && err.message) });
    }
  });

  app.get('/receipts/:eventId', async (req, res) => {
    const { eventId } = req.params;
    if (!SAFE_ID.test(eventId)) {
      return res.status(400).json({ error: 'invalid eventId' });
    }
    try {
      const data = await fsp.readFile(fileFor(eventId), 'utf8');
      return res.type('application/json').send(data);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return res.status(404).json({ error: 'receipt not found', eventId });
      }
      return res.status(500).json({ error: 'read failed', detail: String(err && err.message) });
    }
  });

  app.locals.config = cfg;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const cfg = app.locals.config;
  app.listen(cfg.port, () => {
    console.log(`[receipt-store] listening on :${cfg.port} data=${cfg.dataDir}`);
  });
}

module.exports = { createApp };
