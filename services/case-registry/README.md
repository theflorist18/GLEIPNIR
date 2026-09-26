# services/case-registry

**Responsibility:** the OFF-CHAIN case layer of the evidence library (M13a). It
owns the Case entity (name, status, participant roster) and the evidence
search read-model (`evidence_index`). Case-evidence linkage lives here and
only here — nothing on-chain, no Codex-Entry schema change, no chaincode
change. Case ids are `CASE-<uuid>`, deliberately disjoint from the Parallel
variants' channel routing key (`case-NNN`) so the two "case" concepts can
never collide.

Port **4005**. Node 20, Express, SQLite (better-sqlite3) at
`DATA_DIR/case-registry.db`. Internal-only: reached exclusively through the
gateway, guarded by the shared `X-Gleipnir-Internal-Token` header (the gateway
enforces *who* may ask; this service enforces *that only the gateway asks*).

**Docker base deviation (deliberate):** `node:20.19-slim`, not the
`node:20.19-alpine` every other service uses. better-sqlite3 v12 publishes
**no prebuilt binary for Node 20 (ABI 115)** — only Node 22+ — so the native
module is compiled from source at image build; Debian slim provides a glibc
toolchain that node-gyp supports cleanly (installed and purged in one layer,
so the runtime image stays lean). Same Node version pin, different libc.

## Public interface (REST/JSON, internal token required after `/healthz`)

| Method | Path | Result |
|---|---|---|
| `POST` | `/cases` | `201` case (`{id: CASE-<uuid>, name, description, status, createdBy, ...}`) |
| `GET` | `/cases?participant=&status=&q=` | list; `participant` scopes to that user's cases |
| `GET` | `/cases/:caseId` | case + `participants[]` + `evidence[]` roster + `categories[]`; `404` |
| `PATCH` | `/cases/:caseId` | update name/description/status (`OPEN\|CLOSED\|ARCHIVED`) |
| `POST` | `/cases/:caseId/participants` | grant `{userId, roleInCase: viewer\|contributor\|lead}` (M18); `409` dup |
| `PATCH` | `/cases/:caseId/participants/:userId` | in-place role change (M25); enum-validated; `404` unknown; policy (caller, last-lead, global-lead targets) lives in the gateway |
| `POST`/`PATCH`/`DELETE` | `/cases/:caseId/categories[/:categoryId]` | per-case taxonomy (M19; read via `GET /cases/:caseId` `.categories`); name unique per case (`409`); delete refused `409` while referenced. New cases are seeded with the preset file-type categories (Image, Video, Audio, Text, Document, PDF, Spreadsheet, Archive, Other — M25); seeded rows are ordinary categories, fully lead-editable |
| `POST`/`GET` | `/evidence-index/:evidenceId/notes` | examiner notes (M20) — append-only; deliberately NO update/delete routes |
| `GET` | `/cases/:caseId/activity?limit=` | activity feed — since M25b the persistent, append-only `case_audit_log` (ts-DESC): one actor-attributed row per management action (participants add/remove/role-change, categories CRUD, evidence add/assign/unassign/remove, details, flag, notes), written in the SAME transaction as the mutation; actor from the gateway's `X-Gleipnir-Actor` header (session-derived). Immutable-by-API — no update/delete routes. Evidence ACCESS stays on-chain (never duplicated here) |
| `DELETE` | `/cases/:caseId/participants/:userId` | revoke; `404` |
| `POST` | `/cases/:caseId/evidence` | categorize `{evidenceId}`; idempotent same-case; `409` cross-case |
| `DELETE` | `/cases/:caseId/evidence/:evidenceId` | uncategorize (`case_id -> NULL`) |
| `POST` | `/evidence-index` | register a row at ingest; `409` dup |
| `GET` | `/evidence-index?caseId=&q=&uploadedBy=&type=&from=&to=&visibleToUserId=` | search; `visibleToUserId` = participant cases + own uncategorized uploads |
| `PATCH` | `/evidence-index/:evidenceId` | sync cached `status` (`ACTIVE` / `DISPOSED` since M26; legacy `REMOVED` rows are read as `DISPOSED`-equivalent — the `EVIDENCE_REMOVED` activity type is the library's own "left the roster" concept, not the chaincode op) |
| `GET` | `/internal/authz?userId=&evidenceId=` | `{allowed, caseId, roleInCase}` — the gateway's per-evidence pre-flight |

Authz decision matrix: participant of the evidence's case → allowed (with the
case role); uncategorized evidence → uploader only; unknown evidence → denied
(`reason: unknown-evidence`). Admin short-circuits happen in the **gateway**
(it never calls authz for admins or the service token).

## Inputs / outputs

- **In:** REST/JSON from the gateway; env config.
- **Out:** SQLite file under `DATA_DIR` (named volume `case-registry-data`).

Env: `PORT=4005`, `DATA_DIR=/data`, `GLEIPNIR_INTERNAL_TOKEN`.

## Does NOT — and MUST NOT

- Authenticate end users — that is the gateway's job; this service only checks
  the shared internal token.
- Store evidence binaries — that is evidence-store's job.
- Talk to Fabric, ever. No chaincode, no channels, no Codex-Entry fields.

**Cache caveat:** `evidence_index` is a read-model, **never authoritative** for
evidence status or custodian — the ledger is. A stale row is a display glitch,
not an integrity problem; the gateway re-syncs `status` after on-chain writes.

## Failure modes

- `401` — missing/wrong `X-Gleipnir-Internal-Token`.
- `400` — invalid field (bad status/role, empty name, unsafe evidenceId).
- `404` — unknown case / evidence row / participant.
- `409` — duplicate participant, duplicate evidence row, cross-case assign.

## Test

```bash
npm install && npm test    # node:test — CRUD, scoping, authz matrix, persistence, token guard
```
