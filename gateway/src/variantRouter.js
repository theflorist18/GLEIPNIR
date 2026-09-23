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
// Reads differ too (M26): the batched variants keep no per-event record on
// the app channel (only the Merkle root goes on-chain), so ReadEvidence /
// GetAuditTrail are served from the OFF-CHAIN trail — the receipt-store's
// per-evidence index, each receipt carrying the CoC event it witnesses. The
// direct variants evaluate the chaincode as before.
//
// This module is pure: it takes injected deps ({fabric, batcher, receipts,
// defaultChannel}) so it is unit-tested across all four variants without a
// live Fabric or receipt-store.

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

// Off-chain trail of one evidence: the CoC events in receipt (enqueue) order.
// Receipts without an `event` copy (pre-M26 witnesses) carry no trail entry
// and are skipped. withProofs attaches each event's Merkle witness so a
// reconstruction client can recompute the branch and check the root.
async function offChainTrail(evidenceId, withProofs, deps) {
  if (!deps.receipts) throw new RequestError(503, 'receipt store client not configured');
  const receipts = await deps.receipts.listByEvidence(evidenceId);
  return receipts.filter((r) => r && r.event).map((r) => (withProofs
    ? { ...r.event, proof: { leafHash: r.leafHash, siblingPath: r.siblingPath, batchId: r.batchId, leafIndex: r.leafIndex, rootRef: r.rootRef } }
    : r.event));
}

// Fold a trail into a head-like record (the shape ReadEvidence returns on the
// direct variants, minus the chaincode-only fields), flagged offChain so a
// consumer never mistakes it for a ledger read.
function foldHead(evidenceId, events) {
  const create = events.find((e) => e.op === 'CREATE');
  const lastTransfer = [...events].reverse().find((e) => e.op === 'TRANSFER');
  const createActor = create ? create.actor : '';
  return {
    id: evidenceId,
    version: '1.0',
    storage: (create && create.detail && create.detail.storage) || {},
    identity: { subject: createActor },
    custodian: (lastTransfer && lastTransfer.detail && lastTransfer.detail.newCustodian) || createActor,
    status: events.some((e) => e.op === 'DISPOSE' || e.op === 'REMOVE') ? 'DISPOSED' : 'ACTIVE', // REMOVE = pre-rename rows
    offChain: true,
  };
}

// Route a read. spec = { variant, fn, args, caseId, withProofs }. Direct
// variants evaluate the chaincode; batched variants read the off-chain trail.
// Returns a JSON string in both cases (what fabric.evaluate returns).
async function routeRead(spec, deps) {
  const channel = channelFor(spec.variant, spec.caseId, deps.defaultChannel); // Parallel* caseId validation, every variant
  if (!isBatched(spec.variant)) return deps.fabric.evaluate(channel, spec.fn, spec.args);
  const evidenceId = spec.args[0];
  const events = await offChainTrail(evidenceId, spec.withProofs, deps);
  if (spec.fn === 'GetAuditTrail') return JSON.stringify(events);
  if (spec.fn !== 'ReadEvidence') throw new RequestError(400, `unsupported off-chain read: ${spec.fn}`);
  if (events.length === 0) throw new RequestError(404, `evidence ${evidenceId} not found (no off-chain events)`);
  return JSON.stringify(foldHead(evidenceId, events));
}

module.exports = { CASE_RE, RequestError, isBatched, isParallel, channelFor, routeWrite, routeRead, foldHead };
