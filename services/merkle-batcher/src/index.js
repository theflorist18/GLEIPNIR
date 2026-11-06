'use strict';

// GLEIPNIR merkle-batcher (port 4001).
// Accumulates CoC events off-chain into per-scope batches; at a batch boundary
// it builds a Merkle tree, PUTs one receipt per event to the receipt-store, and
// submits the root for on-chain commit through the gateway (`anchoring`: one
// `shared` scope, roots on coc-main; `parallel-anchored`: one scope per case,
// each root on that case's own channel), then re-PUTs receipts with the
// returned txId.
//
// A boundary is reached by size (BATCH_SIZE events in the open queue), by the
// idle timer (BATCH_IDLE_MS > 0: that long after the batch's LAST event), by
// the age timer (BATCH_FLUSH_MS > 0: that long after its FIRST event), or by
// POST /flush at run end; each batch record names which one (`closeReason`).
// Every batch record carries the timestamps the anchoring-delay and
// finalization metrics are computed from (docs/methodology/experiments.md):
// openedAt / closedAt / committedAt, per-event enqueue -> commit delays
// {min, mean, max}, and each event's enqueue time (`enqueuedAtMs`, leaf order;
// served only by GET /status?events=1, so the polled /status stays small).
//
// Known limit: an open batch exists only in this process's memory. Events
// accepted (202) but not yet in a committed batch are lost if the process dies:
// no receipt, no root, no record anywhere.
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
    // BATCH_SIZE is the only batch-size knob (E1 sweeps one grid shared by
    // both anchored variants); default = the compose default.
    batchSize: int(process.env.BATCH_SIZE, 100),
    // Both timers 0 = size-only batching (partial batch flushed at run end by /flush).
    flushMs: int(process.env.BATCH_FLUSH_MS, 0),
    idleMs: int(process.env.BATCH_IDLE_MS, 0),
    receiptStoreUrl: process.env.RECEIPT_STORE_URL || 'http://receipt-store:4002',
    gatewayUrl: process.env.GATEWAY_URL || 'http://gateway:3000',
    // Bearer token for the gateway's authenticated /internal/anchor-root.
    token: process.env.GLEIPNIR_TOKEN || 'dev-token',
    // batchEpoch namespaces batchIds per batcher lifetime: the ledger persists
    // across batcher recreates (experiment cells recreate the batcher), so a
    // bare per-scope sequence would collide with roots already committed by an
    // earlier process and poison verification. The orchestrator
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
  //   openedAt: ms of the first enqueue, timer: age timer | null, idleTimer: idle timer | null }
  const queues = new Map();
  // Closed-batch records keyed by batchId (kept for /status; never dropped).
  const batches = new Map();
  // In-flight boundary promises (so /flush can await them deterministically).
  const inflight = new Set();

  // batchId = scope + epoch + sequence. Opaque at every consumer (receipt
  // rootRef, chaincode composite key, verification query); the epoch component
  // keeps ids unique across batcher restarts against a persistent ledger.
  const batchIdFor = (scopeId, seq) =>
    `${scopeId}-${cfg.batchEpoch}-b${String(seq).padStart(6, '0')}`;

  function getQueue(scopeId) {
    let q = queues.get(scopeId);
    if (!q) {
      q = { seq: 0, events: [], ids: new Set(), openedAt: null, timer: null, idleTimer: null };
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

  // Submit the root through the gateway's bearer-authed /internal/anchor-root.
  // The chaincode keys a root on meta.caseId (default "shared"): Anchoring sends
  // none, so its roots land in the shared scope on coc-main; Parallel-Anchored
  // names the case, which the gateway also uses as the channel. Throws so the
  // caller keeps receipts and marks the batch degraded.
  async function submitRoot(scopeId, batchId, merkleRoot, leafCount) {
    const url = `${cfg.gatewayUrl}/internal/anchor-root`;
    const meta = cfg.variant === 'parallel-anchored' ? { scopeId, leafCount, caseId: scopeId } : { scopeId, leafCount };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ batchId, merkleRoot, meta }),
    });
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
      closeReason: batch.closeReason,
      forced: batch.closeReason !== 'size',
      delayMs: null,
      enqueuedAtMs: batch.events.map((e) => e.enqueuedAt),
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
      `leafCount=${rec.leafCount} closeReason=${rec.closeReason} openedAt=${rec.openedAt} ` +
      `closedAt=${rec.closedAt} committedAt=${rec.committedAt} ` +
      `delayMs=${rec.delayMs.min}/${rec.delayMs.mean.toFixed(1)}/${rec.delayMs.max}`
    );
  }

  // Close the open batch for a scope (if non-empty) and start processing it.
  // reason: 'size' | 'idle' (idle timer) | 'timeout' (age timer) | 'flush' (POST /flush);
  // every reason but 'size' marks the batch `forced`.
  function trigger(scopeId, reason) {
    const q = queues.get(scopeId);
    if (!q || q.events.length === 0) return;
    if (q.timer) clearTimeout(q.timer);
    if (q.idleTimer) clearTimeout(q.idleTimer);
    const batch = {
      batchId: batchIdFor(scopeId, q.seq),
      scopeId,
      events: q.events,
      openedAt: q.openedAt,
      closedAt: Date.now(),
      closeReason: reason,
    };
    q.events = [];
    q.ids = new Set();
    q.openedAt = null;
    q.timer = null;
    q.idleTimer = null;
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

  // withEvents adds each batch's per-event enqueue times; without it the
  // response stays small enough to poll (it grows with every closed batch).
  function status(withEvents) {
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
      idleTimeoutMs: cfg.idleMs,
      queues: queueDepths,
      counters,
      degraded: counters.degraded > 0,
      batches: withEvents ? list : list.map(({ enqueuedAtMs, ...b }) => b),
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
        q.timer = setTimeout(() => trigger(scopeId, 'timeout'), cfg.flushMs);
        q.timer.unref();
      }
    }
    if (cfg.idleMs > 0) {
      // refresh() restarts the countdown from now: the batch closes idleMs
      // after its latest event.
      if (q.idleTimer) q.idleTimer.refresh();
      else {
        q.idleTimer = setTimeout(() => trigger(scopeId, 'idle'), cfg.idleMs);
        q.idleTimer.unref();
      }
    }
    const batchId = batchIdFor(scopeId, q.seq);
    const leafIndex = q.events.length;
    q.events.push({ eventId, event, leafHash: leafHash(event), leafIndex, enqueuedAt: now });
    q.ids.add(eventId);
    res.status(202).json({ batchId, leafIndex });
    if (q.events.length >= cfg.batchSize) trigger(scopeId, 'size');
    return undefined;
  });

  // Force a batch boundary on every non-empty queue (partial-batch policy).
  app.post('/flush', async (_req, res) => {
    for (const scopeId of [...queues.keys()]) trigger(scopeId, 'flush');
    await settle();
    res.json(status());
  });

  // ?events=1 adds each batch's enqueuedAtMs (the run-end snapshot reads it).
  app.get('/status', (req, res) => res.json(status(req.query.events === '1')));

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
      `batchSize=${cfg.batchSize} flushTimeoutMs=${cfg.flushMs} idleTimeoutMs=${cfg.idleMs}`
    );
  });
}

module.exports = { createApp };
