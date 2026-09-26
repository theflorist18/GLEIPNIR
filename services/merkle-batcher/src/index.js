'use strict';

// GLEIPNIR merkle-batcher (port 4001).
// Accumulates CoC events off-chain into per-scope batches; at a batch boundary
// it builds a Merkle tree, PUTs one receipt per event to the receipt-store, and
// submits the root for on-chain commit (gateway for `anchoring`, anchor-client
// for `parallel-anchored`), then re-PUTs receipts with the returned txId.
//
// A boundary is reached by SIZE (BATCH_SIZE events in the open queue) or, when
// BATCH_FLUSH_MS > 0, by TIME (a timer armed at the first enqueue of an open
// batch), or by POST /flush at run end. Every batch record carries the
// timestamps the "anchoring delay" metric is computed from (supervisor brief
// 2026-09-22 §6): openedAt / closedAt / committedAt and per-event
// enqueue -> commit delays {min, mean, max}.
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
    // BATCH_SIZE is the one batch-size knob (E1 sweeps ONE grid for both
    // anchored variants); default = the compose default.
    batchSize: int(process.env.BATCH_SIZE, 100),
    // 0 = size-only batching (partial batch flushed at run end by /flush).
    flushMs: int(process.env.BATCH_FLUSH_MS, 0),
    receiptStoreUrl: process.env.RECEIPT_STORE_URL || 'http://receipt-store:4002',
    gatewayUrl: process.env.GATEWAY_URL || 'http://gateway:3000',
    anchorClientUrl: process.env.ANCHOR_CLIENT_URL || 'http://anchor-client:4003',
    // Bearer token for the gateway's authed /internal/anchor-root (audit F23).
    token: process.env.GLEIPNIR_TOKEN || 'dev-token',
    // batchEpoch namespaces batchIds per batcher lifetime: the ledger persists
    // across batcher recreates (experiment cells recreate the batcher), so a
    // bare per-scope sequence would collide with roots already committed by an
    // earlier process and poison verification (audit F44). The orchestrator
    // sets BATCH_EPOCH per run; the startup timestamp covers every other restart.
    batchEpoch: process.env.BATCH_EPOCH || Date.now().toString(36),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  const log = (...args) => {
    if (cfg.logLevel !== 'silent') console.log('[merkle-batcher]', ...args);
  };

  // Per-scope open queue:
  // { seq, events:[{eventId,event,leafHash,leafIndex,enqueuedAt}], ids:Set,
  //   openedAt: ms of the first enqueue, timer: flush timer | null }
  const queues = new Map();
  // Closed-batch records keyed by batchId (kept for /status; never dropped).
  const batches = new Map();
  // In-flight boundary promises (so /flush can await them deterministically).
  const inflight = new Set();

  // batchId = scope + epoch + sequence. Opaque at every consumer (receipt
  // rootRef, chaincode composite key, verification query); the epoch component
  // keeps ids unique across batcher restarts against a persistent ledger (F44).
  const batchIdFor = (scopeId, seq) =>
    `${scopeId}-${cfg.batchEpoch}-b${String(seq).padStart(6, '0')}`;

  function getQueue(scopeId) {
    let q = queues.get(scopeId);
    if (!q) {
      q = { seq: 0, events: [], ids: new Set(), openedAt: null, timer: null };
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

  // Submit the root: anchor-client for parallel-anchored, else the gateway's bearer-authed
  // /internal/anchor-root (F23). Throws so the caller keeps receipts and marks the batch degraded.
  async function submitRoot(scopeId, batchId, merkleRoot, leafCount) {
    const [url, auth, body] = cfg.variant === 'parallel-anchored'
      ? [`${cfg.anchorClientUrl}/roots`, {}, { caseId: scopeId, batchId, merkleRoot, meta: { leafCount } }]
      : [`${cfg.gatewayUrl}/internal/anchor-root`, { authorization: `Bearer ${cfg.token}` }, { batchId, merkleRoot, meta: { scopeId, leafCount } }];
    const resp = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`${url} -> ${resp.status}`);
    return (await resp.json().catch(() => ({}))).txId || null;
  }

  async function processBatch(batch) {
    const leaves = batch.events.map((e) => e.leafHash);
    const tree = buildTree(leaves);
    // Receipt = witness (leafHash + sibling path + rootRef) PLUS the event body
    // as enqueued, so the off-chain trail can be read back and the leaf
    // recomputed from the event (leafHash stays SHA-256 of the canonical event).
    const receipts = batch.events.map((e, i) => ({
      eventId: e.eventId,
      evidenceId: e.event.evidenceId,
      event: e.event,
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
      openedAt: new Date(batch.openedAt).toISOString(),
      closedAt: new Date(batch.closedAt).toISOString(),
      committedAt: null,
      forced: batch.forced,
      delayMs: null,
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
    // Anchoring delay = root commit (as observed here) minus each event's
    // enqueue time. Recorded before the receipt re-PUT: that is bookkeeping.
    const committedAt = Date.now();
    const delays = batch.events.map((e) => committedAt - e.enqueuedAt);
    rec.committedAt = new Date(committedAt).toISOString();
    rec.delayMs = {
      min: Math.min(...delays),
      mean: delays.reduce((a, b) => a + b, 0) / delays.length,
      max: Math.max(...delays),
    };

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
    log(
      `batch ${batch.batchId} committed root ${tree.root} tx ${txId} ` +
      `leafCount=${rec.leafCount} forced=${rec.forced} openedAt=${rec.openedAt} ` +
      `closedAt=${rec.closedAt} committedAt=${rec.committedAt} ` +
      `delayMs=${rec.delayMs.min}/${rec.delayMs.mean.toFixed(1)}/${rec.delayMs.max}`
    );
  }

  // Close the open batch for a scope (if non-empty) and start processing it.
  // forced = closed by /flush or the flush timer rather than by size.
  function trigger(scopeId, forced) {
    const q = queues.get(scopeId);
    if (!q || q.events.length === 0) return;
    if (q.timer) clearTimeout(q.timer);
    const batch = {
      batchId: batchIdFor(scopeId, q.seq),
      scopeId,
      events: q.events,
      openedAt: q.openedAt,
      closedAt: Date.now(),
      forced: Boolean(forced),
    };
    q.events = [];
    q.ids = new Set();
    q.openedAt = null;
    q.timer = null;
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
      forced: list.filter((b) => b.forced).length,
      receiptDegraded: list.filter((b) => b.receiptStatus === 'degraded').length,
      degraded: list.filter((b) => b.degraded).length,
    };
    return {
      variant: cfg.variant,
      batchSize: cfg.batchSize,
      flushTimeoutMs: cfg.flushMs,
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
    const now = Date.now();
    if (q.events.length === 0) {
      q.openedAt = now;
      if (cfg.flushMs > 0) {
        q.timer = setTimeout(() => trigger(scopeId, true), cfg.flushMs);
        q.timer.unref();
      }
    }
    const batchId = batchIdFor(scopeId, q.seq);
    const leafIndex = q.events.length;
    q.events.push({ eventId, event, leafHash: leafHash(event), leafIndex, enqueuedAt: now });
    q.ids.add(eventId);
    res.status(202).json({ batchId, leafIndex });
    if (q.events.length >= cfg.batchSize) trigger(scopeId, false);
    return undefined;
  });

  // Force a batch boundary on every non-empty queue (partial-batch policy).
  app.post('/flush', async (_req, res) => {
    for (const scopeId of [...queues.keys()]) trigger(scopeId, true);
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
      `batchSize=${cfg.batchSize} flushTimeoutMs=${cfg.flushMs}`
    );
  });
}

module.exports = { createApp };
