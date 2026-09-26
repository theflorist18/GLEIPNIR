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
  Roles: `admin` | `lead` | `investigator`, enforced server-side (M18: leads
  create cases and manage the cases they lead; admins read metadata and audit
  trails everywhere but download blob content only as a case participant —
  CONTRACTS §12-8). Login is throttled
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

Admin-only routes (user management) require an **admin session** — the
service token is never sufficient there.

## Public interface (`/api/v1`, JSON)

| Method | Path | Maps to |
|---|---|---|
| `POST` | `/auth/login` | unauthenticated: credentials → session token |
| `POST` | `/auth/logout` | session: invalidate token |
| `GET` | `/auth/me` | session: current user |
| `GET`/`POST` | `/admin/users` | admin session: list / create users |
| `PATCH` | `/admin/users/:id` | admin session: role/name/active |
| `POST` | `/admin/users/:id/reset-password` | admin session |
| `GET` | `/users/directory` | admin-or-lead session: active users, read-only roster picker (M25); no management surface |
| `POST` | `/evidence` | `CreateEvidence` (or batcher enqueue). Also accepts `multipart/form-data` (M13c): `file` part → evidence-store blob PUT → head committed with the store's ni-URI proof → evidence-index row. The library `caseId` never reaches the chain (linkage is off-chain only) |
| `POST` | `/evidence/:id/transfer` | `TransferCustody` (or enqueue); user sessions need a writing role |
| `POST` | `/evidence/:id/access` | `AccessLog` (or enqueue); user sessions need a writing role |
| `DELETE` | `/evidence/:id` | `DisposeEvidence` (or enqueue; op `DISPOSE`) — a terminal status transition to `DISPOSED`, never a deletion; best-effort evidence-index status sync. M25 role ladder: user sessions need the case-lead role (uploader keeps it for own uncategorized evidence; contributors/viewers 403) |
| `GET` | `/evidence/:id` | `ReadEvidence` (batched variants: head folded from the off-chain trail, `offChain: true`; 404 when no events); user sessions: authz-gated + auto `AccessLog(view)` |
| `GET` | `/evidence/:id/download` | stream bytes from evidence-store; user sessions: authz-gated + auto `AccessLog(download)`; blob content is participant-only — the admin bypass does NOT apply here (M18) |
| `GET` | `/evidence/:id/export` | `{record, auditTrail}` JSON bundle; user sessions: authz-gated + auto `AccessLog(export)` |
| `GET` | `/evidence/:id/audit?proofs=1` | `GetAuditTrail` (batched variants: CoC events from the receipt store in receipt order; `?proofs=1` adds each event's `proof {leafHash, siblingPath, batchId, leafIndex, rootRef}` — ignored on direct variants); authz-gated, NOT auto-logged |
| `GET` | `/evidence/:id/verify?eventId=` | proxy → verification service |
| `GET` | `/anchor-roots/:scopeId/:batchId` | anchor-root record for audit reconstruction (M26); any authenticated principal. anchoring → `ReadAnchorRoot` on `coc-main`; parallel-anchored → proxy anchor-client `GET /roots/:scopeId/:batchId` (status passed through); standard/parallel → `404 {error:'no anchor roots in this variant'}` |
| `GET` | `/evidence/search?caseId=&q=&uploadedBy=&type=&from=&to=` | evidence-index search, participant-scoped unless admin |
| `POST`/`GET`/`PATCH` | `/cases`, `/cases/:id`, `/cases/search` | proxy → case-registry; create admin-or-lead (lead creator auto-added as case lead; admin may pass `leadUserId`), update admin-or-case-lead; list/detail participant-scoped unless admin |
| `POST`/`PATCH`/`DELETE` | `/cases/:id/participants[/:userId]` | proxy, admin-or-case-lead; `roleInCase: lead` grants require a global-`lead` target; removing (or PATCH-demoting, M25) the last case lead is 409 (admin may) |
| `POST`/`DELETE` | `/cases/:id/evidence[/:evidenceId]` | categorize/uncategorize, admin-or-case-lead |
| `POST`/`GET`/`PATCH`/`DELETE` | `/cases/:id/categories[/:categoryId]` | evidence taxonomy (M19); read = case visibility, manage = admin-or-case-lead |
| `PATCH` | `/evidence/:id/details` | M19 metadata (label/category/seizedAt/location/hand-off) → evidence-index; write-gated, never auto-logged |
| `GET`/`POST` | `/evidence/:id/notes` | examiner notes (M20): append-only, immutable-by-API; read/write gates; sessions stamp the author |
| `PUT` | `/evidence/:id/flag` | one strict-enum triage flag or null (M20); write-gated |
| `GET` | `/cases/:id/activity?limit=` | case audit log (M20 feed; persistent since M25b — the gateway forwards the session username via `X-Gleipnir-Actor` on every registry mutation); case-visibility gate; never auto-logged |
| `GET` | `/cases/:id/coc-report?format=csv\|json` | per-case CoC report (M24): all exhibit trails + metadata; sessions auto-log one `AccessLog('coc-report')` per exhibit after assembly (never the service token); CSV is hand-rolled RFC 4180 |

Auto-AccessLog is **synchronous**: a user-session view/download/export succeeds
only if the log write succeeds. It **never** fires for the service token —
Caliper read workloads must not mutate the ledger. Per-evidence authz
(case-registry `/internal/authz`) applies to user sessions only; the service
token bypasses it entirely, and admins bypass it for metadata/trails but not
for blob content (`/download` — M18, CONTRACTS §12-8).

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

Reads (M26): **standard / parallel** evaluate the chaincode directly, on `coc-main` or
the `?caseId=` case channel. **anchoring / parallel-anchored** keep no per-event
record on the app channel (only the Merkle root is committed), so `ReadEvidence` and
`GetAuditTrail` are served from the **off-chain trail**: `serviceClients.js` lists the
receipt store's per-evidence index (`GET /receipts?evidenceId=`), each receipt carrying
the CoC `event` it witnesses. The trail is those events in receipt order; the head is
folded from them (`id`, `version`, `storage` from CREATE, `identity.subject` = CREATE
actor, `custodian` = last TRANSFER `newCustodian` else CREATE actor, `status`
`DISPOSED`|`ACTIVE`, `offChain: true`). Pre-M26 receipts without an `event` copy
contribute no entry. The Parallel* `caseId` validation is unchanged on reads.
The off-chain trail is exactly as trustworthy as the receipt store (un-hardened by
design): a verifier must recompute each event's leaf and check it against the
on-chain root (`?proofs=1` + `/anchor-roots`) — the gateway does not do that.

## Inputs / outputs

- **In:** REST/JSON requests; env config.
- **Out:** Fabric submit/evaluate on app channels; enqueue POSTs to the batcher;
  receipt-store index reads (batched variants); anchor-client root reads
  (parallel-anchored); verification proxy.

Env: `PORT=3000`, `GLEIPNIR_TOKEN`, `VARIANT`, `BATCHER_URL`, `VERIFICATION_URL`,
`RECEIPT_STORE_URL=http://receipt-store:4002`, `ANCHOR_CLIENT_URL=http://anchor-client:4003`,
`PEER_ENDPOINT`, `PEER_HOST_ALIAS`, `MSP_ID`, `CRYPTO_PATH`, `TLS_CERT_PATH`,
`DEFAULT_CHANNEL=coc-main`, `CC_NAME=evidence`,
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
- Verify Merkle branches or roots itself — `?proofs=1` and `/anchor-roots` only hand the
  witness and the root to the caller (verification service / `benchmark/audit`).
- Execute or track benchmark runs — there is no runs API; the benchmark is driven
  host-side by the desktop app `orchestration/benchapp.pyw` (`orchestration/experiment.py`).

## Failure modes

- `401` — missing/invalid bearer token, bad login credentials, expired session,
  or a session whose user was deactivated.
- `429` — login throttled after repeated failures (`Retry-After` header set).
- `403` — role gate: non-admin (or service-token) caller on an admin route.
- `400` — parallel variant without a valid `caseId`; invalid user fields;
  multipart without a `file` part; unsafe evidenceId.
- `409` — duplicate username; multipart ingest of an existing evidenceId.
- `413` — multipart file over `MAX_UPLOAD_BYTES`.
- `503` — login attempted while the users store is unavailable.
- `404` — read of an unknown key (mapped from the chaincode not-found error); batched
  variant `ReadEvidence` with no off-chain events; `/anchor-roots` on a direct variant
  (no roots exist) or an unknown `(scopeId, batchId)`.
- `502` — Fabric submit/evaluate error, batcher / receipt-store / anchor-client
  unreachable, or verification proxy error.

## Test

```bash
npm install && npm test    # node:test — variant matrix, ni-URI vector, auth 401, create-vs-enqueue,
                           # off-chain reads (trail/proofs/fold/404), anchor-roots per variant
```
