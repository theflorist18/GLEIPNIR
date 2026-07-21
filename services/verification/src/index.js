'use strict';

// GLEIPNIR verification service (port 4004) — THE audit-latency metric path.
//
// GET /verify/:eventId times three steps with process.hrtime.bigint():
//   fetchMs        = GET the receipt (off-chain witness) from the receipt-store,
//                    INCLUDING body download + JSON parse — the body scales
//                    with the O(log N) sibling path, so excluding it would
//                    undercount exactly the N-dependent cost RQ2 measures (F55)
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
const fsp = require('fs/promises');
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
    // RQ2: where to append the per-request step breakdown. Empty (the default)
    // disables it — only the sweep sets it, so unit tests and ad-hoc runs write
    // nothing. sweep.py truncates the file before each verify run; collect.py
    // reads it after and summarises percentiles into the run manifest.
    metricsPath: process.env.VERIFY_METRICS_PATH || '',
  };
}

// Append one metric line per completed 3-step verify. Fire-and-forget and OFF
// the timed path: the step values are already captured (process.hrtime) before
// this runs, and the async append never blocks the event loop, so it cannot
// perturb the latency it records. Failures (e.g. no volume mounted) are ignored.
function recordVerifyMetric(cfg, line) {
  if (!cfg.metricsPath) return;
  fsp.appendFile(cfg.metricsPath, `${JSON.stringify(line)}\n`).catch(() => {});
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

    // 1) fetch the receipt (the witness). fetchMs spans headers + body + parse:
    // the body is the sibling path, whose size is the N-dependent quantity (F55).
    let receipt;
    const t0 = process.hrtime.bigint();
    try {
      const r = await fetch(`${cfg.receiptStoreUrl}/receipts/${encodeURIComponent(eventId)}`);
      if (r.status === 404) {
        steps.fetchMs = msSince(t0);
        return res.status(404).json({ ok: false, reason: 'missing-receipt', latencyMs: steps.fetchMs, steps });
      }
      if (!r.ok) {
        steps.fetchMs = msSince(t0);
        return res.status(502).json({ ok: false, reason: 'receipt-store-error', latencyMs: steps.fetchMs, steps });
      }
      receipt = await r.json();
      steps.fetchMs = msSince(t0);
    } catch (err) {
      steps.fetchMs = msSince(t0);
      log(`fetch receipt ${eventId} failed: ${err.message}`);
      return res.status(502).json({ ok: false, reason: 'receipt-store-error', latencyMs: steps.fetchMs, steps });
    }

    // 1b) validate the witness shape BEFORE touching it — the receipt-store is
    // deliberately un-hardened and stores any JSON, so a corrupt witness must
    // yield a graceful verdict, not an unhandled throw that kills the process
    // (F54). Deliberately OFF the timed path: shape checking is not part of the
    // Merkle verification cost RQ2 isolates.
    const HEX64 = /^[0-9a-f]{64}$/;
    const pathOk = receipt && (receipt.siblingPath == null || (
      Array.isArray(receipt.siblingPath) &&
      receipt.siblingPath.every(
        (s) => s && typeof s === 'object' && (s.pos === 'L' || s.pos === 'R') &&
          typeof s.hash === 'string' && HEX64.test(s.hash),
      )
    ));
    if (
      !receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      typeof receipt.leafHash !== 'string' || !HEX64.test(receipt.leafHash) || !pathOk
    ) {
      return res.status(422).json({ ok: false, reason: 'malformed-receipt', latencyMs: steps.fetchMs, steps });
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
    // RQ2: record the complete 3-step measurement (only the 200 path ran all
    // three steps; error paths have partial timings and are not recorded).
    recordVerifyMetric(cfg, {
      ts: new Date().toISOString(),
      eventId,
      ok,
      fetchMs: steps.fetchMs,
      recomputeMs: steps.recomputeMs,
      compareRootMs: steps.compareRootMs,
      latencyMs,
    });
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
