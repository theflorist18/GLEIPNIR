# GLEIPNIR Evidence-Library Expansion — Chunked Plan

> **Historical planning document (M12–M16, landed 2026-07-16).** Wire shapes
> quoted below reflect the contracts as of M16; the M17 rename of the User
> field `displayName` → `name` (CONTRACTS §12-8) supersedes those mentions.

Full context and rationale for every decision below lives in the original plan
(see the "Context" and "Architecture shape" sections you already have). This
file breaks that plan into 7 standalone chunks, each scoped to be handed to a
fresh session one at a time, in order — every chunk depends on the ones before
it having landed.

---

## Chunk 1 — M12: Auth & roles (gateway)

**Goal:** real login + server-enforced roles (admin / investigator), while the
existing static `GLEIPNIR_TOKEN` service path keeps working unchanged.

- New `gateway/src/users.js` — JSON-file user store mirroring `runsStore.js`'s
  pattern: `{id, username, passwordHash, displayName, role, active, createdAt,
  updatedAt}` at `AUTH_DATA_DIR/users.json` (new named volume
  `gateway-auth-data:/data/auth`). Password hashing via
  `node:crypto.scryptSync` — no new dependency.
- New `gateway/src/sessions.js` — opaque tokens
  (`crypto.randomBytes(32).toString('hex')`), store-and-check.
- New `gateway/src/auth.js` — `authenticate` middleware + `requireRole(role)`
  helper. Replaces the inline bearer-check at `gateway/src/app.js:71-76`:
  ```js
  if Authorization == "Bearer <GLEIPNIR_TOKEN>": req.principal = { kind: 'service' }   // unchanged today
  else: verify session token -> req.principal = { kind: 'user', userId, username, role }
  else: 401
  ```
  This must keep authenticating **every** route unchanged for the service
  token, including internal ones (`docs/CONTRACTS.md` §6: the token "guards
  everything after `/healthz`, internal routes included" — `merkle-batcher`
  and `verification` both use it to call the gateway).
- New routes (`/api/v1`):

  | Method | Path | Auth | Purpose |
  |---|---|---|---|
  | POST | `/auth/login` | none | `{username,password}` → `200 {token,user}` / `401` |
  | POST | `/auth/logout` | session | → `204` |
  | GET | `/auth/me` | session | → current user |
  | GET | `/admin/users` | admin | list users |
  | POST | `/admin/users` | admin | create user |
  | PATCH | `/admin/users/:id` | admin | update role/displayName/active |
  | POST | `/admin/users/:id/reset-password` | admin | reset password |

- Admin-gated routes (user management, case creation, `POST /api/v1/runs`)
  require `kind:'user', role:'admin'` — the service token is never sufficient.
- Deactivate rather than delete users (`active:false`) — audit-trail `actor`
  attribution must keep resolving to a real username.
- Seed one admin at first boot from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars.
- **Actor attribution tightening:** for user-session routes, ignore any
  client-supplied `actor`/`identity.subject` for logging — use the
  authenticated username. The service-token path (Caliper, smoke tests) is
  unchanged: client-supplied actors are needed for load-test realism.
- Wire `users`/`sessions` stores into `gateway/src/index.js` alongside the
  existing `fabric`/`batcher`/`runsStore` deps (same injection pattern,
  `index.js:17-27`).

**Verify:** `gateway/test` suite green (new `auth.test.js` covering login,
401/403, admin-gating) + `orchestration/smoke-standard.sh` still passes
unmodified against the service-token path.

---

## Chunk 2 — M13a: case-registry service

**Goal:** new off-chain service (port 4005) owning the Case entity and the
evidence search read-model.

- `services/case-registry/` — Dockerfile `FROM node:20.19-slim` (not alpine —
  every other service uses `node:20.19-alpine`; this is a deliberate deviation
  because prebuilt `better-sqlite3` native binaries are far more reliable
  against glibc). Document the deviation explicitly in the README.
- Datastore: SQLite via `better-sqlite3`, one file at
  `DATA_DIR/case-registry.db` (named volume `case-registry-data:/data`).
  ```sql
  cases(id TEXT PK, name, description, status, created_by, created_at, updated_at)
  case_participants(case_id FK, user_id, role_in_case, added_by, added_at, PRIMARY KEY(case_id,user_id))
  evidence_index(evidence_id TEXT PK, case_id TEXT NULL, original_filename, mime_type,
                  size_bytes, integrity_proof, uploaded_by, uploaded_at, status, last_synced_at)
  ```
  `evidence_index` is a **read-model/cache**, not source of truth — the chain
  stays authoritative for status/custodian; a stale row is a display glitch,
  not an integrity problem. State this explicitly in the README.
- Endpoints (internal only, reached via gateway proxy, never directly by the
  frontend), guarded by a shared `X-Gleipnir-Internal-Token` header:

  | Method | Path | Purpose |
  |---|---|---|
  | POST | `/cases` | create |
  | GET | `/cases?participant=&status=&q=` | list/search (`all=true` for admin) |
  | GET | `/cases/:caseId` | case + participants + evidence roster |
  | PATCH | `/cases/:caseId` | update name/description/status |
  | POST/DELETE | `/cases/:caseId/participants[/:userId]` | grant/revoke |
  | POST/DELETE | `/cases/:caseId/evidence[/:evidenceId]` | categorize/uncategorize |
  | POST | `/evidence-index` | register a new evidence row (called once at ingest) |
  | GET/PATCH | `/evidence-index/:evidenceId` | read row / sync status |
  | GET | `/evidence-index?caseId=&q=&uploadedBy=&type=&from=&to=` | search |
  | GET | `/internal/authz?userId=&evidenceId=` | `{allowed, caseId, roleInCase}` — gateway's per-evidence pre-flight |

- README non-goals, stated explicitly: not auth, not blob storage, not Fabric,
  cache not authoritative for status/custodian.
- Tests mirror `services/receipt-store/test/index.test.js`'s style (node:test,
  `listen()` helper, tmp data dir).

**Verify:** `services/case-registry` test suite green; `docker build` succeeds
locally (or note if native-module build can't be verified in this
environment).

---

## Chunk 3 — M13b: evidence-store service

**Goal:** new off-chain service (port 4006) persisting evidence binaries.

- `services/evidence-store/` — direct architectural sibling of
  `services/receipt-store/src/index.js`: reuse its file-per-item persistence
  style and its path-traversal guard pattern (`receipt-store/src/index.js:26`,
  regex `^[A-Za-z0-9._:-]+$`).
- Datastore: filesystem only — `DATA_DIR/<evidenceId>` blob +
  `DATA_DIR/<evidenceId>.meta.json` sidecar (named volume
  `evidence-blob-data:/data`). No DB — search lives in case-registry.
- Endpoints:

  | Method | Path | Purpose |
  |---|---|---|
  | PUT | `/blobs/:evidenceId` | store bytes (raw body + `X-Content-Type`/`X-Original-Filename` headers) → `201 {integrityProof,sizeBytes,storedAt}`; `409` if already exists (blobs are immutable) |
  | GET | `/blobs/:evidenceId` | stream back with `Content-Disposition: attachment` |
  | GET | `/blobs/:evidenceId/meta` | sidecar JSON |
  | GET | `/blobs/:evidenceId/verify?expected=<ni-uri>` | recompute hash, compare |

- Reuse `gateway/src/ni.js`'s `niUri()` hash algorithm byte-identically (same
  discipline `docs/CONTRACTS.md` §4 already requires between merkle-batcher
  and verification) — copy the function, don't invent a new hashing scheme.
- Dockerfile `FROM node:20.19-alpine` (matches the other five services — no
  native deps here, unlike case-registry).
- Tests mirror `services/receipt-store/test/index.test.js`.

**Verify:** test suite green; manual `PUT` + `GET` + `verify` roundtrip.

---

## Chunk 4 — M13c: gateway wiring for upload + case proxying

**Goal:** connect the gateway to the two new services and add real file
upload. **Depends on Chunks 1–3 being in place.**

- Add `multer` (memory storage, `MAX_UPLOAD_BYTES`-limited) to the gateway.
- Extend `POST /api/v1/evidence` (`gateway/src/app.js:87-95`,
  `buildHead`/`buildEvent`) to accept `multipart/form-data` in addition to the
  existing JSON body:
  1. Parse multipart → buffer (skip if plain JSON body — existing path
     unchanged).
  2. `PUT evidence-store/blobs/:evidenceId` → `integrityProof`.
  3. Build the Codex-Entry head via `buildHead`, with
     `storage.protocol='gleipnir-evidence-store'`,
     `storage.location='evidence-store://<evidenceId>'`,
     `storage.integrity_proof` from step 2.
  4. `CreateEvidence` on-chain — unchanged call via
     `routeWrite`/`fabric.submit` (`variantRouter.js`).
  5. `POST case-registry/evidence-index` to register the read-model row (+
     `caseId` if supplied).
  6. Return `{evidenceId, eventId, integrityProof}`.
  - If step 4 fails after step 2 succeeded, best-effort `DELETE` the orphaned
    blob.
  - **Backward compatibility is load-bearing:** the JSON-body path
    (`payloadBase64` hash-then-discard, `app.js:22-27`) must keep working
    completely unchanged — it's what
    `benchmark/connectors/rest/index.js` and `orchestration/smoke-standard.sh`
    use.
- New/modified routes:

  | Method | Path | Change |
  |---|---|---|
  | POST | `/api/v1/evidence` | extended: accepts `multipart/form-data` in addition to JSON body |
  | GET | `/api/v1/evidence/:id` | unchanged read, **plus** auto-fires `AccessLog(action='view')` under a user session |
  | GET | `/api/v1/evidence/:id/download` | new — streams bytes from evidence-store; fires `AccessLog(action='download')` |
  | GET | `/api/v1/evidence/:id/export` | new — `{record, auditTrail}` JSON bundle; fires `AccessLog(action='export')` |
  | POST/GET/PATCH | `/api/v1/cases[/:id]` | proxy to case-registry, admin-gated for create/update |
  | POST/DELETE | `/api/v1/cases/:id/participants[/:userId]` | proxy, admin-gated |
  | POST/DELETE | `/api/v1/cases/:id/evidence[/:evidenceId]` | proxy, admin-gated (categorization) |
  | GET | `/api/v1/cases/search`, `/api/v1/evidence/search` | proxy, scoped to caller's participant cases unless admin |

- Per-case access enforcement: before any evidence read/write/download/export
  proceeds, the gateway calls case-registry's `GET /internal/authz`.
- The existing `CASE_RE = /^case-\d{3}$/` in `variantRouter.js:15`
  (Parallel-only routing key) is untouched. The new Case entity gets its own
  ID format from case-registry (`CASE-<uuid>`, never matching `CASE_RE`) so
  the two concepts can never collide.
- `AccessLog` auto-fire is **synchronous**: a view/download/export request
  only succeeds if the log write succeeds.

**Verify:** `orchestration/smoke-standard.sh` still passes unmodified (JSON
path untouched); new gateway tests for multipart ingest + download/export +
per-case authz denial.

---

## Chunk 5 — M14: Frontend rebuild — pages & routing

**Goal:** replace the single-page demo with a real multi-page app.
**Depends on Chunks 1–4** (needs the auth + case/evidence endpoints to call).

- Add `react-router-dom` v6 — `frontend/nginx.conf` already does
  `try_files $uri $uri/ /index.html`, so this is a zero-infra-change drop-in
  replacing the `useState<Scope>` toggle in `frontend/src/App.tsx:6,11`.
- New structure under `frontend/src/`:
  ```
  auth/AuthContext.tsx, LoginPage.tsx, RequireAuth.tsx, RequireRole.tsx
  api/gatewayClient.ts (api.ts extended in place: auth/cases/search/upload/download), types.ts (extended)
  components/EvidenceCard.tsx, AuditTrail.tsx, MerkleBadge.tsx   # promoted verbatim from demo.tsx
  components/Layout/TopBar.tsx, Sidebar.tsx                       # role-aware nav
  pages/admin/UsersPage.tsx, CasesAdminPage.tsx, DashboardPage.tsx  # DashboardPage = dashboard.tsx content, now RequireRole('admin')
  pages/investigator/IngestPage.tsx        # real file input, built from CreateEvidenceForm
  pages/investigator/MyCasesPage.tsx
  pages/investigator/CaseDetailPage.tsx    # metadata + evidence roster: type, upload date, uploader, status
  pages/investigator/EvidenceDetailPage.tsx # EvidenceCard+AuditTrail+MerkleBadge+download/export+Transfer/AccessLog forms
  pages/investigator/SearchPage.tsx
  pages/shared/UnauthorizedPage.tsx, NotFoundPage.tsx
  settings.tsx   # trimmed to `variant` only; token/user moves into AuthContext
  styles.css     # extended, not replaced — .card/.form/.pill/.badge/.chips/.runs/.mono/.hint/.err reused as-is
  ```
- **Reused verbatim** (currently module-private functions in `demo.tsx`,
  export them into their own files unchanged): `EvidenceCard` (`demo.tsx:130`),
  `AuditTrail` (`demo.tsx:151`), `MerkleBadge` (`demo.tsx:197`); the
  `GatewayClient`/`GatewayError` pattern in `api.ts` (extend in place with
  `login`, `listCases`, `getCase`, `uploadEvidence(formData)`,
  `downloadEvidence`, `searchCases`, `searchEvidence`); the `useErr()` hook
  pattern (`demo.tsx:28-40`).
- **Rewritten/relocated:** `CreateEvidenceForm` (`demo.tsx:50`) → base of
  `IngestPage`; `TransferCustodyForm`/`AccessLogForm` (`demo.tsx:84,107`) →
  into `EvidenceDetailPage`; `dashboard.tsx` content → unchanged, now
  admin-gated instead of a public toggle. The free-text token input in
  `App.tsx`'s topbar is removed, replaced by `LoginPage`/`AuthContext`.
- Routes:
  ```
  /login                                                             public
  /ingest, /cases, /cases/:caseId, /evidence/:evidenceId, /search    RequireAuth (any role)
  /admin/users, /admin/cases, /admin/dashboard                       RequireRole('admin')
  /unauthorized, *                                                   fallback
  ```
- Data model reference (already defined server-side by Chunks 1–4, just for
  the frontend types):
  - **Case:** `id, name, description, status('OPEN'|'CLOSED'|'ARCHIVED'), createdBy, createdAt, updatedAt, participants[{userId, roleInCase:'viewer'|'contributor', addedBy, addedAt}]` — matches the already-present-but-unused `caseId?` field on `EvidenceRecord` in `frontend/src/types.ts:59`.
  - **User:** `id, username, passwordHash, displayName, role:'admin'|'investigator', active, createdAt, updatedAt`.
  - **EvidenceIndex:** `evidenceId, caseId, originalFilename, mimeType, sizeBytes, integrityProof, uploadedBy, uploadedAt, status, lastSyncedAt`.

**Verify:** `tsc --noEmit && vite build` clean; manually walk login → ingest →
categorize → case detail → evidence detail → download in a browser for an
investigator; confirm admin sees Users/Case-Admin/Dashboard and an
investigator does not.

---

## Chunk 6 — M15: Search & access-log completeness

**Goal:** finish the search endpoints and prove the audit trail is complete.
**Depends on Chunks 1–5.**

- Wire `GET /api/v1/cases/search` and `GET /api/v1/evidence/search` to proxy
  to case-registry's SQL-backed filters, scoped server-side to the caller's
  participant cases unless admin.
- Confirm every read/download/export path added in Chunk 4 actually fires
  `AccessLog` — write/verify tests that assert audit-trail event counts grow
  by exactly one per view/download/export.

**Verify:** new integration test (or the smoke script from Chunk 7, pulled
forward) asserting: `CREATE` + `ACCESS(view)` + `ACCESS(download)` +
`ACCESS(export)` = 4 audit events for one evidence item exercised through all
three read paths.

---

## Chunk 7 — M16: Docs & verification closeout

**Goal:** bring the docs and compose config back into sync, ship the smoke
test. **Depends on all prior chunks.**

- **`network/compose/compose-services.yaml`**: add `case-registry` and
  `evidence-store` services with no `profiles:` key (base profile, matching
  `gateway`/`frontend`), the two new named volumes
  (`case-registry-data`, `evidence-blob-data`, plus `gateway-auth-data` for
  the gateway from Chunk 1), and `X-Gleipnir-Internal-Token` env wiring on
  both new services and the gateway.
- **`docs/audit/chunk-7-build-images.sh`**: add `gen_node` calls for the two
  new Dockerfiles (`case-registry`, `evidence-store`) alongside the existing
  six.
- **CLAUDE.md**: annotate the auth "Do NOT build" line as
  reopened-for-this-feature (link to ARCHITECTURE §6); update "Frontend" to
  point at the new multi-page structure; add a line under "Semantic
  invariants" that case-evidence linkage is off-chain only and the
  chaincode/Codex-Entry schema was never touched.
- **docs/ARCHITECTURE.md**: new §4.8 (case-registry) / §4.9 (evidence-store)
  module sections in the existing Responsibility/Interface/Does-NOT/Failure-modes
  format; §5 frontend spec reframed; §6 gateway spec gets the new endpoint
  table + rewritten auth paragraph; §2 repo tree gets the two new service
  dirs + frontend's new subdirs; §3 compose/volumes table gets the three new
  volumes; §9 milestone table appends M12–M16.
- **docs/CONTRACTS.md**: §6 gets case-registry(4005)/evidence-store(4006) rows
  + extended gateway endpoints + rewritten auth paragraph; new subsection
  pinning Case/User/EvidenceIndex wire shapes; §7 gets new env vars
  (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `AUTH_DATA_DIR`,
  `GLEIPNIR_INTERNAL_TOKEN`, `CASE_REGISTRY_URL`, `EVIDENCE_STORE_URL`,
  `MAX_UPLOAD_BYTES`, `SESSION_TTL_SECONDS`, plus each new service's
  `PORT`/`DATA_DIR`); §8 new volumes; §11 new `orchestration/smoke-library.sh`
  line; §12 new decision-record entry documenting the `caseId` naming
  resolution and the Standard/Anchoring-only scoping.
- **docs/AS-BUILT.md**: refresh — new modules in the §1 diagram and §3
  participation matrix, new pinned deps (`multer`, `better-sqlite3`), §9 repo
  tree.
- New `orchestration/smoke-library.sh`, styled like
  `orchestration/smoke-standard.sh` (`set -euo pipefail`, curl+jq, PASS/FAIL,
  nonzero exit on failed assertion), run against `up.sh --variant standard`:
  1. Admin login → token. Admin creates an investigator user → login → token.
  2. Admin creates a case, grants the investigator as participant.
  3. Investigator uploads real file bytes via multipart
     `POST /api/v1/evidence` → assert `evidenceId` + `integrityProof`.
  4. Assign evidence to the case; `GET /cases/:id` → assert roster shows
     correct filename/type/uploader.
  5. Case search and evidence search → assert both found.
  6. `GET /evidence/:id` (view) → `GET /evidence/:id/audit` → assert trail
     grew by one `ACCESS`.
  7. `GET /evidence/:id/download` → assert downloaded bytes hash-match the
     upload → assert trail grew again.
  8. `GET /evidence/:id/export` → `200` → assert trail grew again.
  9. Negative: a third, non-participant user → `403`/`404` on case/evidence
     routes.
  10. Negative: investigator token against `POST /admin/users` → `403`.
  11. Final count assertion: total audit events = CREATE + ACCESS(view) +
      ACCESS(download) + ACCESS(export) = 4.

**Regression gate — run before declaring this whole feature done:**
`orchestration/smoke-standard.sh` must still pass unmodified against the
service-token path, and the other three variants must still pass their
functional gate, which today is `sweep.py --variant <v> --regime smoke` (see
`docs/audit/step-2-variant-smokes.md` — there are no separate per-variant
smoke *scripts*). This feature must not break the benchmark machine path the
thesis's measurements depend on.
