'use strict';

// Variant routing — the one place that knows how each variant writes to the
// ledger (docs/CONTRACTS.md §9). The chaincode interface, client API, and
// workloads are identical across variants; only the write PATH differs:
//
//   standard          -> submit on coc-main
//   anchoring         -> enqueue to the merkle-batcher (root committed at boundary)
//   parallel          -> submit on case-<id>
//   parallel-anchored -> enqueue to the merkle-batcher (per-case, root -> anchor channel)
//
// This module is pure: it takes injected deps ({fabric, batcher, defaultChannel})
// so it is unit-tested across all four variants without a live Fabric.

const CASE_RE = /^case-\d{3}$/;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isBatched(variant) {
  return variant === 'anchoring' || variant === 'parallel-anchored';
}

function isParallel(variant) {
  return variant === 'parallel' || variant === 'parallel-anchored';
}

// Resolve the target channel. Parallel variants require a case-NNN id; the
// others use the shared default channel (coc-main).
function channelFor(variant, caseId, defaultChannel) {
  if (isParallel(variant)) {
    if (!CASE_RE.test(caseId || '')) {
      throw new RequestError(400, 'caseId (case-NNN) is required for parallel variants');
    }
    return caseId;
  }
  return defaultChannel;
}

// Route a write. spec = { variant, fn, ccArgs, event, caseId }.
// Batched variants enqueue the CoC event (202); direct variants submit (201).
async function routeWrite(spec, deps) {
  const { variant, fn, ccArgs, event, caseId } = spec;
  if (isBatched(variant)) {
    // Per-case variants require a valid caseId on the batched path too (F57):
    // without this check a missing caseId would be silently defaulted to the
    // "shared" scope — events from different cases pooled into one batch —
    // where the direct parallel path correctly answers 400.
    if (isParallel(variant)) channelFor(variant, caseId, deps.defaultChannel);
    const placement = await deps.batcher.enqueue(event);
    return {
      status: 202,
      body: { batched: true, evidenceId: event.evidenceId, eventId: event.eventId, ...placement },
    };
  }
  const channel = channelFor(variant, caseId, deps.defaultChannel);
  const txId = await deps.fabric.submit(channel, fn, ccArgs);
  return { status: 201, body: { txId, evidenceId: event.evidenceId, eventId: event.eventId } };
}

// Route a read (evaluate) — always direct, every variant. spec = { variant, fn, args, caseId }.
async function routeRead(spec, deps) {
  const channel = channelFor(spec.variant, spec.caseId, deps.defaultChannel);
  return deps.fabric.evaluate(channel, spec.fn, spec.args);
}

module.exports = { CASE_RE, RequestError, isBatched, isParallel, channelFor, routeWrite, routeRead };
