'use strict';

// GLEIPNIR merkle-batcher (port 4001).
// Accumulates CoC events off-chain into per-scope batches; at a batch boundary
// it builds a Merkle tree, PUTs one receipt per event to the receipt-store, and
// submits the root for on-chain commit (gateway for `anchoring`, anchor-client
// for `parallel-anchored`), then re-PUTs receipts with the returned txId.
//
// Does NOT: submit to the ledger itself, persist receipts, or verify anything.
// Contracts: docs/CONTRACTS.md §4/§5/§6/§7/§9; docs/ARCHITECTURE.md §4.2.

const express = require('express');
const {
  leafHash,
  buildTree,
  siblingPath,
} = require('./merkle');

function loadConfig() {
  const int = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    port: int(process.env.PORT, 4001),
    variant: process.env.VARIANT || 'anchoring',
    batchN: int(process.env.BATCH_N, 100),
    batchK: int(process.env.BATCH_K, 25),
    receiptStoreUrl: process.env.RECEIPT_STORE_URL || 'http://receipt-store:4002',
    gatewayUrl: process.env.GATEWAY_URL || 'http://gateway:3000',
    anchorClientUrl: process.env.ANCHOR_CLIENT_URL || 'http://anchor-client:4003',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  const log = (...args) => {
    if (cfg.logLevel !== 'silent') console.log('[merkle-batcher]', ...args);
  };

  // Per-scope open queue: { seq, events:[{eventId,event,leafHash,leafIndex}], ids:Set }
  const queues = new Map();
  // Closed-batch records keyed by batchId (kept for /status; never dropped).
  const batches = new Map();
  // In-flight boundary promises (so /flush can await them deterministically).
  const inflight = new Set();

  const batchSize = () =>
    (cfg.variant === 'parallel-anchored' ? cfg.batchK : cfg.batchN);

  const batchIdFor = (scopeId, seq) =>
    `${scopeId}-b${String(seq).padStart(6, '0')}`;

  function getQueue(scopeId) {
    let q = queues.get(scopeId);
    if (!q) {
      q = { seq: 0, events: [], ids: new Set() };
      queues.set(scopeId, q);
    }
    return q;
  }

  // PUT one receipt to the receipt-store; retry once on failure.
  // Returns true on a 2xx, false after both attempts fail (batch degraded).
  async function putReceipt(receipt) {
    const url = `${cfg.receiptStoreUrl}/receipts/${encodeURIComponent(receipt.eventId)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const resp = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(receipt),
        });
        if (resp.ok) return true;
      } catch (_err) {
        // fall through to retry / failure
      }
    }
    return false;
  }

  // Submit the Merkle root for on-chain commit. Throws on failure so the caller
  // can keep the receipts and surface the batch as degraded.
  async function submitRoot(scopeId, batchId, merkleRoot, leafCount) {
    if (cfg.variant === 'parallel-anchored') {
      const resp = await fetch(`${cfg.anchorClientUrl}/roots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caseId: scopeId,
          batchId,
          merkleRoot,
          meta: { leafCount },
        }),
      });
      if (!resp.ok) throw new Error(`anchor-client /roots -> ${resp.status}`);
      const body = await resp.json().catch(() => ({}));
      return body.txId || null;
    }
    // anchoring (and any default): submit via the gateway internal endpoint.
    const resp = await fetch(`${cfg.gatewayUrl}/internal/anchor-root`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        batchId,
        merkleRoot,
        meta: { scopeId, leafCount },
      }),
    });
    if (!resp.ok) throw new Error(`gateway /internal/anchor-root -> ${resp.status}`);
    const body = await resp.json().catch(() => ({}));
    return body.txId || null;
  }

  async function processBatch(batch) {
    const leaves = batch.events.map((e) => e.leafHash);
    const tree = buildTree(leaves);
    const receipts = batch.events.map((e, i) => ({
      eventId: e.eventId,
      leafHash: e.leafHash,
      siblingPath: siblingPath(tree.layers, i),
      batchId: batch.batchId,
      leafIndex: i,
      rootRef: { scopeId: batch.scopeId, batchId: batch.batchId, txId: null },
    }));

    const rec = {
      batchId: batch.batchId,
      scopeId: batch.scopeId,
      leafCount: leaves.length,
      root: tree.root,
      receiptStatus: 'pending',
      rootStatus: 'pending',
      txId: null,
      degraded: false,
      error: null,
    };
    batches.set(batch.batchId, rec);

    // 1) Persist receipts (without txId yet). Never drop silently on failure.
    let receiptsOk = true;
    for (const r of receipts) {
      if (!(await putReceipt(r))) receiptsOk = false;
    }
    rec.receiptStatus = receiptsOk ? 'ok' : 'degraded';
    if (!receiptsOk) rec.degraded = true;

    // 2) Submit the root. On failure keep receipts and surface via /status.
    let txId;
    try {
      txId = await submitRoot(batch.scopeId, batch.batchId, tree.root, leaves.length);
      rec.rootStatus = 'committed';
      rec.txId = txId;
    } catch (err) {
      rec.rootStatus = 'failed';
      rec.degraded = true;
      rec.error = String((err && err.message) || err);
      log(`batch ${batch.batchId} root submit failed: ${rec.error}`);
      return;
    }

    // 3) Re-PUT receipts with the committed rootRef.txId.
    let rePutOk = true;
    for (const r of receipts) {
      r.rootRef.txId = txId;
      if (!(await putReceipt(r))) rePutOk = false;
    }
    if (!rePutOk) {
      rec.receiptStatus = 'degraded';
      rec.degraded = true;
    }
    log(`batch ${batch.batchId} committed root ${tree.root} tx ${txId}`);
  }

  // Close the open batch for a scope (if non-empty) and start processing it.
  function trigger(scopeId) {
    const q = queues.get(scopeId);
    if (!q || q.events.length === 0) return;
    const batch = { batchId: batchIdFor(scopeId, q.seq), scopeId, events: q.events };
    q.events = [];
    q.ids = new Set();
    q.seq += 1;
    const p = processBatch(batch)
      .catch((err) => log('processBatch error', err))
      .finally(() => inflight.delete(p));
    inflight.add(p);
  }

  async function settle() {
    while (inflight.size > 0) {
      await Promise.allSettled([...inflight]);
    }
  }

  function status() {
    const queueDepths = {};
    for (const [scopeId, q] of queues) queueDepths[scopeId] = q.events.length;
    const list = [...batches.values()];
    const counters = {
      openScopes: queues.size,
      closedBatches: list.length,
      committed: list.filter((b) => b.rootStatus === 'committed').length,
      failed: list.filter((b) => b.rootStatus === 'failed').length,
      receiptDegraded: list.filter((b) => b.receiptStatus === 'degraded').length,
      degraded: list.filter((b) => b.degraded).length,
    };
    return {
      variant: cfg.variant,
      batchSize: batchSize(),
      queues: queueDepths,
      counters,
      degraded: counters.degraded > 0,
      batches: list,
    };
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.post('/events', (req, res) => {
    const event = req.body;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      return res.status(400).json({ error: 'event body required' });
    }
    const eventId = event.eventId;
    if (typeof eventId !== 'string' || eventId.length === 0) {
      return res.status(400).json({ error: 'eventId required' });
    }
    const scopeId = cfg.variant === 'anchoring' ? 'shared' : event.caseId;
    if (typeof scopeId !== 'string' || scopeId.length === 0) {
      return res.status(400).json({ error: 'caseId required to derive scope' });
    }
    const q = getQueue(scopeId);
    if (q.ids.has(eventId)) {
      return res.status(409).json({ error: 'duplicate eventId in batch', eventId });
    }
    const batchId = batchIdFor(scopeId, q.seq);
    const leafIndex = q.events.length;
    q.events.push({ eventId, event, leafHash: leafHash(event), leafIndex });
    q.ids.add(eventId);
    res.status(202).json({ batchId, leafIndex });
    if (q.events.length >= batchSize()) trigger(scopeId);
    return undefined;
  });

  // Force a batch boundary on every non-empty queue (partial-batch policy).
  app.post('/flush', async (_req, res) => {
    for (const scopeId of [...queues.keys()]) trigger(scopeId);
    await settle();
    res.json(status());
  });

  app.get('/status', (_req, res) => res.json(status()));

  // Exposed for tests / graceful drain; not part of the REST contract.
  app.locals.settle = settle;
  app.locals.config = cfg;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const cfg = app.locals.config;
  app.listen(cfg.port, () => {
    console.log(
      `[merkle-batcher] listening on :${cfg.port} variant=${cfg.variant} ` +
      `N=${cfg.batchN} K=${cfg.batchK}`
    );
  });
}

module.exports = { createApp };
