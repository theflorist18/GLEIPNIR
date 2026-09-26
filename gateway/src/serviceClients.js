'use strict';

// Thin HTTP clients to the gateway's off-chain services: merkle-batcher,
// receipt-store, and the two library services (M13c) case-registry and
// evidence-store. Injected into createApp so every route is unit-testable
// offline with fakes. The library services authenticate the gateway with the
// shared X-Gleipnir-Internal-Token header — end-user authz decisions stay in
// the gateway; the internal token only proves "this call came from the gateway".

// Batcher / receipt-store: a non-2xx answer is a 502 to the caller.
async function okJson(resp, what) {
  if (resp.ok) return resp.json();
  const err = new Error(`${what} -> ${resp.status} ${await resp.text().catch(() => '')}`);
  err.status = 502;
  throw err;
}

// merkle-batcher enqueue: the Anchoring / Parallel-Anchored write path
// (docs/CONTRACTS.md §6, §9).
function makeBatcherClient(batcherUrl) {
  return {
    async enqueue(event) {
      return okJson(await fetch(`${batcherUrl}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      }), 'batcher /events');
    },
  };
}

// receipt-store per-evidence index (M26): the READ path of the batched
// variants, whose audit events never land on the app channel as records — a
// trail is reassembled from the receipts (each carries the CoC `event` it
// witnesses).
function makeReceiptsClient(receiptStoreUrl) {
  return {
    // -> JSON array of receipts in index (enqueue) order; [] when none.
    async listByEvidence(evidenceId) {
      return okJson(await fetch(`${receiptStoreUrl}/receipts?evidenceId=${encodeURIComponent(evidenceId)}`), 'receipt-store /receipts?evidenceId');
    },
  };
}

function makeCaseRegistryClient(baseUrl, internalToken) {
  // Generic pass-through: the gateway's proxy routes translate/forward the
  // registry's own status codes, so this returns {status, body} instead of
  // throwing on non-2xx. opts.actor (M25b) carries the session-attributed
  // username to the registry's case audit log via X-Gleipnir-Actor.
  async function request(method, path, body, opts) {
    const actor = opts && opts.actor;
    const resp = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'x-gleipnir-internal-token': internalToken,
        ...(actor ? { 'x-gleipnir-actor': actor } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: resp.status, body: parsed };
  }
  return { request };
}

function makeEvidenceStoreClient(baseUrl, internalToken) {
  const headers = { 'x-gleipnir-internal-token': internalToken };

  async function put(evidenceId, bytes, { contentType, originalFilename } = {}) {
    const resp = await fetch(`${baseUrl}/blobs/${encodeURIComponent(evidenceId)}`, {
      method: 'PUT',
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        ...(contentType ? { 'x-content-type': contentType } : {}),
        // Percent-encode: the recovered filename may hold non-latin1 code
        // points (e.g. CJK/emoji), which are illegal in an HTTP header value
        // and would otherwise throw when the request is built (B1). evidence-
        // store percent-decodes it back.
        ...(originalFilename ? { 'x-original-filename': encodeURIComponent(originalFilename) } : {}),
      },
      body: bytes,
    });
    const body = await resp.json().catch(() => ({}));
    return { status: resp.status, body };
  }

  // Returns the raw fetch Response so the gateway can stream the body and
  // forward content headers without buffering the blob.
  function fetchBlob(evidenceId) {
    return fetch(`${baseUrl}/blobs/${encodeURIComponent(evidenceId)}`, { headers });
  }

  // rollbackToken (from the blob's PUT response) is required by evidence-store's
  // DELETE (S9, rollback-only). Orphan cleanup has it from the just-completed PUT.
  async function del(evidenceId, rollbackToken) {
    const resp = await fetch(`${baseUrl}/blobs/${encodeURIComponent(evidenceId)}`, {
      method: 'DELETE',
      headers: { ...headers, ...(rollbackToken ? { 'x-gleipnir-rollback-token': rollbackToken } : {}) },
    });
    return { status: resp.status };
  }

  return { put, fetchBlob, del };
}

module.exports = { makeBatcherClient, makeReceiptsClient, makeCaseRegistryClient, makeEvidenceStoreClient };
