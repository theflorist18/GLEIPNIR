'use strict';

// Thin HTTP clients to the two library services (M13c): case-registry and
// evidence-store. Injected into createApp like batcherClient so every library
// route is unit-testable offline with fakes. Both services authenticate the
// gateway with the shared X-Gleipnir-Internal-Token header — end-user authz
// decisions stay in the gateway; the internal token only proves "this call
// came from the gateway".

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

module.exports = { makeCaseRegistryClient, makeEvidenceStoreClient };
