# services/evidence-store

**Responsibility:** persists evidence **binaries** off-chain (M13b) and
computes the RFC 6920 ni-URI integrity proof the ledger records. This is the
storage side of the semantic invariant that holds across all four variants:
evidence bytes never go on-chain — only their hash does. Blobs are
**immutable**: one `PUT` per `evidenceId`, ever; a second `PUT` is `409`,
because re-uploading different bytes under the same id would silently break
the on-chain proof.

Port **4006**. Node 20, Express. Filesystem only: `DATA_DIR/<evidenceId>`
blob + `DATA_DIR/<evidenceId>.meta.json` sidecar (named volume
`evidence-blob-data`). No database — search lives in case-registry. Direct
architectural sibling of `services/receipt-store` (same file-per-item
persistence, same path-traversal guard). Internal-only: reached exclusively
through the gateway, guarded by the shared `X-Gleipnir-Internal-Token` header.

The `niUri()` hash is copied **byte-identically** from `gateway/src/ni.js`
(docs/CONTRACTS.md §4 discipline: one canonical hash construction, no
reinvention): `ni:///sha-256;<base64url(sha256(bytes))>`, no padding.

## Public interface (REST, internal token required after `/healthz`)

| Method | Path | Result |
|---|---|---|
| `PUT` | `/blobs/:evidenceId` | store raw body (+ `X-Content-Type`/`X-Original-Filename` headers) → `201 {integrityProof, sizeBytes, storedAt}`; `409` if it exists (immutable); `413` over `MAX_UPLOAD_BYTES` |
| `GET` | `/blobs/:evidenceId` | stream bytes back, `Content-Disposition: attachment` |
| `GET` | `/blobs/:evidenceId/meta` | sidecar JSON |
| `GET` | `/blobs/:evidenceId/verify?expected=<ni-uri>` | recompute hash from stored bytes → `{ok, expected, actual, sizeBytes}`; `expected` defaults to the ingest-time proof |
| `DELETE` | `/blobs/:evidenceId` | orphan cleanup ONLY (gateway rolls back a blob whose on-chain CreateEvidence failed) → `204` |

## Inputs / outputs

- **In:** raw bytes + metadata headers from the gateway; env config.
- **Out:** blob + sidecar files under `DATA_DIR`.

Env: `PORT=4006`, `DATA_DIR=/data`, `GLEIPNIR_INTERNAL_TOKEN`,
`MAX_UPLOAD_BYTES=26214400`, `LOG_LEVEL`.

## Does NOT — and MUST NOT

- Write anything on-chain, know about cases, or index/search anything —
  case-registry owns discovery metadata; the ledger owns the proof.
- Mutate or overwrite a stored blob (immutability is enforced with an
  exclusive-create write, not an application-level check).
- Delete committed evidence — `DELETE` exists solely for the gateway's
  ingest-failure rollback.

## Failure modes

- `401` — missing/wrong `X-Gleipnir-Internal-Token`.
- `400` — evidenceId outside `^[A-Za-z0-9._:-]+$`, an id ending in
  `.meta.json` (would collide with a sidecar), or an empty body.
- `404` — unknown evidenceId.
- `409` — blob already exists.
- `413` — body over `MAX_UPLOAD_BYTES`.
- `500` — filesystem error (disk full, permissions).

## Test

```bash
npm install && npm test    # node:test — roundtrip, immutability, verify/tamper, traversal, 413
```
