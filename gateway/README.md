# gateway

**Responsibility:** the backend-for-frontend (BFF). It holds the only
`@hyperledger/fabric-gateway` sessions to the **application** channels (`coc-main`,
`case-*`), computes evidence `integrity_proof` ni-URIs, and encapsulates **variant
routing**. Used by **all four variants**; the frontend and Caliper's REST path talk only to
this service, never to Fabric directly.

Port **3000**. Node 20, Express.

## Auth (M12): two kinds of principal

- **Service token** — static bearer (`GLEIPNIR_TOKEN`, default `dev-token`),
  **non-production**, unchanged contract: it authenticates every route after
  `/healthz`, internal routes included (merkle-batcher, verification, Caliper's
  REST connector, smoke scripts). Client-supplied `actor`/`identity.subject`
  fields are honoured on this path (load-test realism).
- **User session** — `POST /api/v1/auth/login` exchanges `{username,password}`
  (JSON body only; never query params, never logged) for an opaque token
  (in-memory, TTL `SESSION_TTL_SECONDS`; a gateway restart logs everyone out).
  Roles: `admin` | `investigator`, enforced server-side. Login is throttled
  per (client IP, username): `LOGIN_MAX_ATTEMPTS` (5) failures within
  `LOGIN_WINDOW_SECONDS` (60) → `429` + `Retry-After`, even for correct
  credentials, until the window expires; success clears the counter. Unknown
  usernames still do full scrypt work against a dummy hash, so response
  timing cannot enumerate accounts.
  Under a user session the audit **actor is always the authenticated username**;
  client-supplied actors are ignored. Users live in `AUTH_DATA_DIR/users.json`
  (scrypt password hashes); they are deactivated, never deleted, so audit-trail
  actors keep resolving. First admin is seeded from `ADMIN_USERNAME`/
  `ADMIN_PASSWORD` when the store is empty.

Admin-only routes (user management, `POST /runs`) require an **admin session**
— the service token is never sufficient there.

## Public interface (`/api/v1`, JSON)

| Method | Path | Maps to |
|---|---|---|
| `POST` | `/auth/login` | unauthenticated: credentials → session token |
| `POST` | `/auth/logout` | session: invalidate token |
| `GET` | `/auth/me` | session: current user |
| `GET`/`POST` | `/admin/users` | admin session: list / create users |
| `PATCH` | `/admin/users/:id` | admin session: role/name/active |
| `POST` | `/admin/users/:id/reset-password` | admin session |
| `POST` | `/evidence` | `CreateEvidence` (or batcher enqueue). Also accepts `multipart/form-data` (M13c): `file` part → evidence-store blob PUT → head committed with the store's ni-URI proof → evidence-index row. The library `caseId` never reaches the chain (linkage is off-chain only) |
| `POST` | `/evidence/:id/transfer` | `TransferCustody` (or enqueue); user sessions need a writing role |
| `POST` | `/evidence/:id/access` | `AccessLog` (or enqueue); user sessions need a writing role |
| `DELETE` | `/evidence/:id` | `RemoveEvidence` (or enqueue); best-effort evidence-index status sync |
| `GET` | `/evidence/:id` | `ReadEvidence`; user sessions: authz-gated + auto `AccessLog(view)` |
| `GET` | `/evidence/:id/download` | stream bytes from evidence-store; user sessions: authz-gated + auto `AccessLog(download)` |
| `GET` | `/evidence/:id/export` | `{record, auditTrail}` JSON bundle; user sessions: authz-gated + auto `AccessLog(export)` |
| `GET` | `/evidence/:id/audit` | `GetAuditTrail`; authz-gated, NOT auto-logged |
| `GET` | `/evidence/:id/verify?eventId=` | proxy → verification service |
| `GET` | `/evidence/search?caseId=&q=&uploadedBy=&type=&from=&to=` | evidence-index search, participant-scoped unless admin |
| `POST`/`GET`/`PATCH` | `/cases`, `/cases/:id`, `/cases/search` | proxy → case-registry; create/update admin-only; list/detail participant-scoped unless admin |
| `POST`/`DELETE` | `/cases/:id/participants[/:userId]` | proxy, admin-only |
| `POST`/`DELETE` | `/cases/:id/evidence[/:evidenceId]` | categorize/uncategorize, admin-only |
| `POST`/`GET` | `/runs`, `/runs/:id` | run-request store (execution is host-side); `POST` is admin-session-only |

Auto-AccessLog is **synchronous**: a user-session view/download/export succeeds
only if the log write succeeds. It **never** fires for the service token —
Caliper read workloads must not mutate the ledger. Per-evidence authz
(case-registry `/internal/authz`) applies to user sessions only; admins and
the service token bypass it.

Internal (no `/api/v1` prefix, still bearer-authed): `POST /internal/anchor-root` and
`GET /internal/anchor-root/:scopeId/:batchId` — the Anchoring variant's root sink on
`coc-main`. `GET /healthz` is unauthenticated.

## Variant routing (docs/CONTRACTS.md §9)

`src/variantRouter.js` decides per active `VARIANT`:
- **standard** → `submit` on `coc-main`.
- **anchoring** → enqueue the CoC event to the merkle-batcher (`202`); root committed at the
  batch boundary via `/internal/anchor-root`.
- **parallel** → `submit` on `case-<id>` (from `caseId`; validated `^case-\d{3}$`).
- **parallel-anchored** → enqueue per-case to the merkle-batcher (`202`).

Reads always evaluate directly, on `coc-main` or the `?caseId=` case channel.

## Inputs / outputs

- **In:** REST/JSON requests; env config.
- **Out:** Fabric submit/evaluate on app channels; enqueue POSTs to the batcher;
  verification proxy; run-request files under `RESULTS_DIR`.

Env: `PORT=3000`, `GLEIPNIR_TOKEN`, `VARIANT`, `BATCHER_URL`, `VERIFICATION_URL`,
`PEER_ENDPOINT`, `PEER_HOST_ALIAS`, `MSP_ID`, `CRYPTO_PATH`, `TLS_CERT_PATH`,
`DEFAULT_CHANNEL=coc-main`, `CC_NAME=evidence`, `RESULTS_DIR=/results`,
`AUTH_DATA_DIR=/data/auth`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
`SESSION_TTL_SECONDS=28800`, `CASE_REGISTRY_URL=http://case-registry:4005`,
`EVIDENCE_STORE_URL=http://evidence-store:4006`, `GLEIPNIR_INTERNAL_TOKEN`,
`MAX_UPLOAD_BYTES=26214400`. If `AUTH_DATA_DIR` is unavailable the gateway
still starts with user login disabled (service token unaffected).

## Does NOT

- Persist evidence binaries itself — multipart uploads are handed to
  **evidence-store** (which owns the bytes); the JSON path's `payloadBase64`
  is hashed to an ni-URI then **discarded**, unchanged.
- Write the library `caseId` on-chain — case linkage is case-registry's,
  off-chain only.
- Build Merkle trees, verify proofs, or write the anchor channel (batcher / verification /
  anchor-client own those).
- Execute benchmark runs — `POST /runs` only records a request; `orchestration/sweep.py`
  runs Caliper and writes the manifest the UI polls.

## Failure modes

- `401` — missing/invalid bearer token, bad login credentials, expired session,
  or a session whose user was deactivated.
- `429` — login throttled after repeated failures (`Retry-After` header set).
- `403` — role gate: non-admin (or service-token) caller on an admin route.
- `400` — parallel variant without a valid `caseId`; invalid user fields;
  multipart without a `file` part; unsafe evidenceId.
- `409` — duplicate username; multipart ingest of an existing evidenceId.
- `413` — multipart file over `MAX_UPLOAD_BYTES`.
- `503` — login attempted while the users store is unavailable; library route
  without the case-registry/evidence-store clients configured.
- `404` — read of an unknown key (mapped from the chaincode not-found error).
- `502` — Fabric submit/evaluate error, batcher unreachable, or verification proxy error.

## Test

```bash
npm install && npm test    # node:test — variant matrix, ni-URI vector, auth 401, create-vs-enqueue
```
