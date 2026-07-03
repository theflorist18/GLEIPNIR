'use strict';

// GLEIPNIR verification service (port 4004) — THE audit-latency metric path.
//
// GET /verify/:eventId times three steps with process.hrtime.bigint():
//   fetchMs        = GET the receipt (off-chain witness) from the receipt-store
//   recomputeMs    = fold leafHash up the sibling path to the implied root
//   compareRootMs  = read the ANCHORED root and compare
// and returns { ok, latencyMs, steps:{fetchMs,recomputeMs,compareRootMs} }.
//
// This is the numerator of the latency-vs-storage tradeoff the Anchoring study
// exists to quantify (thesis RQ2). It deliberately does NOT verify signatures or
// schema — those are separate concerns kept OFF the timed path so the number
// isolates Merkle verification cost.
//
// Contracts: docs/CONTRACTS.md §4/§6/§9; docs/ARCHITECTURE.md §4.5.

const express = require('express');
const { computeRoot } = require('./merkle');

function loadConfig() {
  return {
    port: parseInt(process.env.PORT, 10) || 4004,
    variant: process.env.VARIANT || 'anchoring',
    receiptStoreUrl: process.env.RECEIPT_STORE_URL || 'http://receipt-store:4002',
    gatewayUrl: process.env.GATEWAY_URL || 'http://gateway:3000',
    anchorClientUrl: process.env.ANCHOR_CLIENT_URL || 'http://anchor-client:4003',
    token: process.env.GLEIPNIR_TOKEN || 'dev-token',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

const msSince = (start) => Number(process.hrtime.bigint() - start) / 1e6;

function createApp(overrides) {
  const cfg = { ...loadConfig(), ...(overrides || {}) };
  const log = (...a) => { if (cfg.logLevel !== 'silent') console.log('[verification]', ...a); };

  // Read the anchored root record for (scopeId, batchId). Anchoring reads it
  // through the gateway's internal endpoint (bearer-authed); Parallel-Anchored
  // reads it from the anchor-client. Returns the merkleRoot string.
  async function readAnchoredRoot(scopeId, batchId) {
    if (cfg.variant === 'parallel-anchored') {
      const resp = await fetch(
        `${cfg.anchorClientUrl}/roots/${encodeURIComponent(scopeId)}/${encodeURIComponent(batchId)}`,
      );
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`anchor-client /roots -> ${resp.status}`);
      return (await resp.json()).merkleRoot;
    }
    const resp = await fetch(
      `${cfg.gatewayUrl}/internal/anchor-root/${encodeURIComponent(scopeId)}/${encodeURIComponent(batchId)}`,
      { headers: { authorization: `Bearer ${cfg.token}` } },
    );
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`gateway /internal/anchor-root -> ${resp.status}`);
    return (await resp.json()).merkleRoot;
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/verify/:eventId', async (req, res) => {
    const { eventId } = req.params;
    const steps = { fetchMs: 0, recomputeMs: 0, compareRootMs: 0 };

    // 1) fetch the receipt (the witness).
    let receipt;
    const t0 = process.hrtime.bigint();
    try {
      const r = await fetch(`${cfg.receiptStoreUrl}/receipts/${encodeURIComponent(eventId)}`);
      steps.fetchMs = msSince(t0);
      if (r.status === 404) {
        return res.status(404).json({ ok: false, reason: 'missing-receipt', latencyMs: steps.fetchMs, steps });
      }
      if (!r.ok) {
        return res.status(502).json({ ok: false, reason: 'receipt-store-error', latencyMs: steps.fetchMs, steps });
      }
      receipt = await r.json();
    } catch (err) {
      steps.fetchMs = msSince(t0);
      log(`fetch receipt ${eventId} failed: ${err.message}`);
      return res.status(502).json({ ok: false, reason: 'receipt-store-error', latencyMs: steps.fetchMs, steps });
    }

    // 2) recompute the root implied by leafHash + siblingPath.
    const t1 = process.hrtime.bigint();
    const recomputedRoot = computeRoot(receipt.leafHash, receipt.siblingPath || []);
    steps.recomputeMs = msSince(t1);

    // 3) read the anchored root and compare.
    const scopeId = receipt.rootRef ? receipt.rootRef.scopeId : undefined;
    const batchId = receipt.rootRef ? receipt.rootRef.batchId : receipt.batchId;
    const t2 = process.hrtime.bigint();
    let anchoredRoot;
    try {
      anchoredRoot = await readAnchoredRoot(scopeId, batchId);
      steps.compareRootMs = msSince(t2);
    } catch (err) {
      steps.compareRootMs = msSince(t2);
      log(`read anchored root ${scopeId}/${batchId} failed: ${err.message}`);
      return res.status(502).json({ ok: false, reason: 'anchor-read-error', latencyMs: steps.fetchMs + steps.recomputeMs + steps.compareRootMs, steps });
    }

    const latencyMs = steps.fetchMs + steps.recomputeMs + steps.compareRootMs;
    if (anchoredRoot == null) {
      return res.status(404).json({ ok: false, reason: 'missing-anchor-root', latencyMs, steps });
    }
    const ok = anchoredRoot === recomputedRoot;
    // A mismatch is a tamper signal, not a server error -> 200 with ok:false.
    return res.status(200).json({ ok, reason: ok ? undefined : 'root-mismatch', latencyMs, steps });
  });

  app.locals.config = cfg;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const cfg = app.locals.config;
  app.listen(cfg.port, () => {
    console.log(`[verification] listening on :${cfg.port} variant=${cfg.variant}`);
  });
}

module.exports = { createApp };
