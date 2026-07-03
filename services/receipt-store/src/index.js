'use strict';

// GLEIPNIR receipt-store (port 4002).
// Persists each event's off-chain witness = { leafHash, siblingPath[], batchId,
// leafIndex, rootRef }, one JSON file per eventId under DATA_DIR.
//
// DELIBERATELY UN-HARDENED. There are NO hash chains, NO signatures, NO
// replication, NO integrity proofs on the stored receipts — and there must not
// be. The receipt store carries a weaker-than-on-chain guarantee ON PURPOSE:
// only the Merkle *root* is on-chain and tamper-evident; the sibling path lives
// here, off-chain. Losing/corrupting a receipt is an AVAILABILITY exposure of
// the witness (you can no longer reconstruct a proof), NOT an integrity exposure
// of the ledger (the anchored root still cannot be forged). This is a measured
// property of the design and a stated thesis caveat.
//
// Do not harden this service. The urge to add a hash chain / signature / replica
// IS the finding — surface it in the thesis, do not code it away.

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// eventId charset (docs/CONTRACTS.md §6): anything else is rejected 400 so a
// receipt can never escape DATA_DIR or collide with a path separator.
const SAFE_EVENT_ID = /^[A-Za-z0-9._:-]+$/;

function loadConfig() {
  return {
    port: parseInt(process.env.PORT, 10) || 4002,
    dataDir: process.env.DATA_DIR || '/data',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const fileFor = (eventId) => path.join(cfg.dataDir, `${eventId}.json`);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Upsert (full-document overwrite) — receipts are re-PUT once the root commits
  // to fill in rootRef.txId.
  app.put('/receipts/:eventId', async (req, res) => {
    const { eventId } = req.params;
    if (!SAFE_EVENT_ID.test(eventId)) {
      return res.status(400).json({ error: 'invalid eventId' });
    }
    try {
      await fsp.writeFile(fileFor(eventId), JSON.stringify(req.body), 'utf8');
      return res.json({ ok: true, eventId });
    } catch (err) {
      return res.status(500).json({ error: 'write failed', detail: String(err && err.message) });
    }
  });

  app.get('/receipts/:eventId', async (req, res) => {
    const { eventId } = req.params;
    if (!SAFE_EVENT_ID.test(eventId)) {
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
