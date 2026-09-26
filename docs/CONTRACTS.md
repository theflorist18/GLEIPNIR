# GLEIPNIR — Integration Contracts

This file pins every **cross-module** name, port, schema, and algorithm so that modules
written independently compose without drift. It is subordinate to `docs/ARCHITECTURE.md`
(binding module contracts) and `CLAUDE.md` (rulebook); where those documents are silent
or ambiguous, **this file is the decision record**. Deviations from the architecture
tables are listed in §12 with rationale — they extend, never contradict, the binding
interface signatures.

---

## 1. Organizations, MSPs, hosts, ports

| Component | MSP ID | Hostname (compose service name) | Listen | Admin/CC | Operations |
|---|---|---|---|---|---|
| Orderer 0 | OrdererMSP | `orderer0.example.com` (`orderer0`) | 7050 | 7053 (osnadmin) | 9443 |
| Orderer 1 | OrdererMSP | `orderer1.example.com` (`orderer1`) | 8050 | 8053 (osnadmin) | 9444 |
| Orderer 2 | OrdererMSP | `orderer2.example.com` (`orderer2`) | 9050 | 9053 (osnadmin) | 9445 |
| Peer, Org1 | Org1MSP | `peer0.org1.example.com` (`peer0-org1`) | 7051 | 7052 (chaincode) | 9446 |
| Peer, Org2 | Org2MSP | `peer0.org2.example.com` (`peer0-org2`) | 9051 | 9052 (chaincode) | 9447 |
| Peer, Anchor org† | AnchorClientMSP | `peer0.anchor.example.com` (`peer0-anchor`) | 11051 | 11052 (chaincode) | 9448 |
| CA, Org1 | — | `ca-org1` | 7054 | — | — |
| CA, Org2 | — | `ca-org2` | 8054 | — | — |
| CA, Anchor org† | — | `ca-anchor` | 9054 | — | — |
| CA, Orderer org | — | `ca-orderer` | 10054 | — | — |

† Only started under compose profile `parallel-anchored` (see §8). See §12 for why the
anchor org exists and why there are 4 CAs, not 2.

Host ports = container ports (single host, no remapping). All Fabric traffic is TLS.
Crypto material is produced by **Fabric CA 1.5.19 enrollment** (`network/crypto/`
scripts, test-network `registerEnroll.sh` idiom, NodeOUs enabled). No cryptogen.
Crypto output root: `network/organizations/` (gitignored).

The **anchor-client service identity** is a fixed client identity registered once with
`ca-anchor`: enroll ID `anchorclient`, type `client`, MSP `AnchorClientMSP`. It never
changes between runs (held-constant experimental control, ARCHITECTURE §4.4).

## 2. Channels

| Channel | Members | Used by variants | Purpose |
|---|---|---|---|
| `coc-main` | Org1MSP, Org2MSP | Standard, Anchoring | shared CoC channel; in Anchoring, also receives `CommitAnchorRoot` |
| `case-001` … `case-NNN` | Org1MSP, Org2MSP | Parallel, Parallel-Anchored | one channel per case (C ≤ 50, the E2 `channel_counts` / E3b `case_counts` grids, §10), provisioned by `orchestration/provision-channel.sh` (experiment.py provisions the missing ones) |
| `anchor-main` | AnchorClientMSP | Parallel-Anchored | the **anchor channel** (never call it anything else); root sink written only by the anchor-client |

Channel creation is channel-participation only: `configtxgen` app-channel genesis block →
`osnadmin channel join` against **all three** orderer admin endpoints (assert HTTP 201) →
peers join → chaincode commit.

## 3. Chaincode

- Name: `evidence` (same package on every channel, including `anchor-main`).
- Language: Go **1.25.5**, `fabric-contract-api-go`. Deployment: **Chaincode-as-a-Service
  (ccaas)** — the chaincode runs as its own compose service (`ccaas-evidence`, port 9999,
  `CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999`), built from `golang:1.25.5` in
  `chaincode/evidence/Dockerfile`. Rationale in §12. One ccaas process per peer serves
  all of that peer's channels. Peer external builder: the `ccaas` builder shipped in the
  `hyperledger/fabric-peer:2.5` image — `network/core.yaml` MUST keep the
  `chaincode.externalBuilders` entry for it.
- Endorsement policies (explicit, constant across all runs):
  - app channels (`coc-main`, `case-*`): `OR('Org1MSP.peer','Org2MSP.peer')` — 1-of-any,
    matching the LF baseline envelope (ARCHITECTURE Key Finding 7).
  - `anchor-main`: `AND('AnchorClientMSP.member')` (ARCHITECTURE §4.4, verbatim).
- Functions — the binding signatures from ARCHITECTURE §4.1, plus the read op §4.5
  references:

```go
CreateEvidence(ctx, evidenceId, codexEntryJSON string) error
TransferCustody(ctx, evidenceId, newCustodian, reason string) error
AccessLog(ctx, evidenceId, actor, action string) error
DisposeEvidence(ctx, evidenceId, reason string) error   // M26: was RemoveEvidence (§12-10)
CommitAnchorRoot(ctx, batchId, merkleRoot, metaJSON string) error
ReadEvidence(ctx, evidenceId) (string, error)
GetAuditTrail(ctx, evidenceId) (string, error)
ReadAnchorRoot(ctx, scopeId, batchId) (string, error)   // scopeId: caseId, or "shared"
```

- **State key design** (the MVCC-critical part):
  - head record: `CreateCompositeKey("evd", [evidenceId])` — holds Codex-Entry metadata,
    current custodian, status (`ACTIVE`/`DISPOSED` — disposition is a terminal status
    transition; nothing is deleted). Written ONLY by `CreateEvidence`,
    `TransferCustody`, `DisposeEvidence` (semantically serial per evidence — custody is a
    chain). **`AccessLog` never reads or writes the head.**
  - event records: `CreateCompositeKey("evt", [evidenceId, sortKey])`, append-only, where
    `sortKey = fmt.Sprintf("%019d", txTimestampUnixNanos) + "-" + txID[:12]` (19-digit zero
    pad = the width of MaxInt64). Both components come
    from the signed proposal, so they are deterministic across endorsers, unique per tx,
    and require **no shared counter key**. This realizes ARCHITECTURE §4.1's
    "client-derived monotonic counter" without adding a counter argument to the binding
    signatures. Concurrent `AccessLog` to the same evidence therefore writes distinct
    keys — zero `MVCC_READ_CONFLICT` by construction.
  - anchor roots: `CreateCompositeKey("root", [scopeId, batchId])` where `scopeId` is
    taken from `metaJSON.caseId`, defaulting to `"shared"` (Anchoring variant).
  - `GetAuditTrail` = `GetStateByPartialCompositeKey("evt", [evidenceId])`, returns a JSON
    array ordered by sortKey (iterator order).
- Each of the four CoC ops carries its ISO/IEC 27037 clause annotation as a Go comment
  (`DisposeEvidence`: Preservation — disposition; "nothing is deleted: a status transition").
- `CC_VERSION` stays `1.0` across the M26 rename: the chaincode runs as ccaas, so the rebuilt
  binary is served under the same package id and the cited git SHA pins which code ran.
  Ledgers written before the rename may carry `op: "REMOVE"` / `status: "REMOVED"` rows; readers
  (gateway fold, SPA pills) treat them as `DISPOSE` / `DISPOSED`; the chaincode never writes them
  again.

## 4. Canonical JSON, hashing, Merkle spec (MUST be byte-identical in batcher and verification)

The byte-identity requirement applies to the implementation file itself:
`services/merkle-batcher/src/merkle.js` and `services/verification/src/merkle.js` are
the same file, and **each service's unit suite asserts byte equality** (drift fails the
tests before it can fail a verification).

- **Canonical JSON**: recursively sort object keys lexicographically (code-unit order);
  arrays keep order; no insignificant whitespace; UTF-8; numbers as produced by
  `JSON.stringify` (events only ever carry strings + safe integers — never floats).
  Example: `{"b":2,"a":{"d":4,"c":3}}` → `{"a":{"c":3,"d":4},"b":2}`.
- **Leaf hash** = SHA-256 over the UTF-8 bytes of the canonical event JSON, lowercase hex.
- **Interior node** = SHA-256 over the concatenated *raw bytes* (hex-decoded) of
  `left || right`.
- **Odd node rule: promote** — an unpaired node moves up unchanged (no duplication).
  Root of a single leaf = the leaf hash.
- **Sibling path**: bottom-up array of `{"pos": "L"|"R", "hash": hex}` where `pos` is the
  side **the sibling sits on**. Verify: `cur = leafHash`; for each step
  `cur = pos=="L" ? H(sib||cur) : H(cur||sib)`; compare `cur == root`.

**Test vectors (normative — batcher and verification MUST each have a unit test pinning
these exact values):**

- V1 single leaf, doc `{"a":1}` → leaf = root =
  `015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862`
- V2 three leaves, docs `{"i":0}`, `{"i":1}`, `{"i":2}`:
  - L0 `e9f74e715a1806aa651489dcf176e77013b3c851dbc114cc9c24f2fe9d411d65`
  - L1 `0b549edd218c251f511934cc2f3bc5c7f4780e27af6b8ab4ae8d92cd94121b4a`
  - L2 `38f38fbef725fffb9fa39683d9e50f05ca8c61130c2da2322f9e9021007a2abf`
  - parent(L0,L1) `4a89ef3715145c84282de7016b554021cd5019c03446f069e6061efbac670266`
  - root `c859dbaf0c89a0c3d8acd14558d491171dd4381073d79935182301300d296d2f`
  - sibling path of L1: `[{"pos":"L","hash":L0},{"pos":"R","hash":L2}]`

SHA-256 only. No Poseidon, no ZK, per CLAUDE.md.

## 5. Event & record shapes

There are **two event shapes** (they differ deliberately — determinism forbids the
chaincode from accepting a gateway wall-clock timestamp or an off-chain uuid):

**CoC event** (gateway-built; the batcher enqueue unit and the Merkle **leaf** in
Anchoring/Parallel-Anchored):

```json
{
  "eventId": "evt-<uuidv4>",
  "evidenceId": "<uuidv4>",
  "caseId": "case-001 | shared",
  "op": "CREATE | TRANSFER | ACCESS | DISPOSE",
  "actor": "string",
  "detail": { "op-specific": "fields (newCustodian/reason/action/...)" },
  "ts": "RFC3339 UTC, assigned by gateway"
}
```

**On-chain event record** (chaincode-built under the `"evt"` key in Standard/Parallel;
`ts`/`txId` come from the signed proposal so the record is byte-identical across
endorsers): `{"evidenceId","op","actor","detail?","txId","ts"}` — no `eventId`, no
`caseId` (the channel itself scopes the case), `txId` instead.

**Evidence head record** stored on-chain is the Codex-Entry-inspired mapping from
ARCHITECTURE §1a (`id`,`version`,`storage{...}`,`encryption?`,`identity{...}`,
`anchor{...}`,`signatures[]`,`previous_id?`) plus `custodian` and `status`.
`storage.integrity_proof` is an RFC 6920 ni-URI computed by the **client** — the
gateway on the REST path, the Caliper workload in fabric mode — **never by chaincode**.

**Receipt** (receipt-store): `{"eventId","evidenceId","event",
"leafHash","siblingPath":[{"pos","hash"}],"batchId","leafIndex",
"rootRef":{"scopeId","batchId","txId"}}`. M26 (§12-11): `evidenceId` keys the
receipt-store's per-evidence index and `event` is the CoC event **exactly as enqueued** —
the off-chain trail copy; `leafHash` is unchanged (= SHA-256 of the canonical `event`), so
a verifier recomputes the leaf from `event` rather than trusting the stored hash. Pre-M26
receipts lack both fields and contribute no trail entry. `txId` may be filled in
by a follow-up PUT after the root commit returns. `batchId` is an **opaque string**,
unique per (scope, batcher lifetime) — currently `<scopeId>-<epoch>-b<seq>`, where the
epoch (BATCH_EPOCH env or batcher start time) keeps ids from colliding with roots an
earlier batcher process already committed to the persistent ledger. Duplicate-eventId
enqueues are rejected 409 **within the open batch only**; a retry after the boundary
lands in the next batch and its receipt PUT overwrites the previous witness
(at-most-once per batch, not per ledger).

**Anchor root record** (on-chain): `{"scopeId","batchId","merkleRoot","leafCount",
"meta":{...},"txTimestamp"}`.

**Batch record** (batcher `GET /status`.`batches[]`, in-memory for the process lifetime;
the source of the **anchoring delay** metric, M26): `{"batchId","scopeId","leafCount",
"root","receiptStatus","rootStatus","txId","degraded","error","openedAt","closedAt",
"committedAt","forced","delayMs":{"min","mean","max"}}`. Timestamps are ISO-8601:
`openedAt` = first enqueue, `closedAt` = boundary, `committedAt` = the root submission
*returned* to the batcher (the gateway / anchor-client await the Fabric commit, so the
delay includes the submit round-trip — confirm with D that this is the paper's
definition; `null` if the submit failed). `forced` = closed by `POST /flush` or the
`BATCH_FLUSH_MS` timer rather than by size. `delayMs` = `committedAt − enqueue time` over
the batch's events (`null` when not committed).

## 6. Service ports & REST APIs (all JSON; all expose `GET /healthz` → `{"ok":true}`; the gateway's healthz adds a `variant` field)

| Service | Port | Endpoints |
|---|---|---|
| gateway (BFF) | **3000** | public API below; plus internal: `POST /internal/anchor-root` `{batchId,merkleRoot,meta}` → submits `CommitAnchorRoot` on `coc-main` (Anchoring variant only); `GET /internal/anchor-root/:scopeId/:batchId` → evaluates `ReadAnchorRoot` on `coc-main` |
| merkle-batcher | **4001** | `POST /events` (CoC event) → `202 {batchId,leafIndex}`; `POST /flush` → force batch boundary on every open queue (partial-batch policy at run end; returns the `/status` body after settling); `GET /status` → `{variant, batchSize, flushTimeoutMs, queues:{scopeId:depth}, counters:{openScopes, closedBatches, committed, failed, forced, receiptDegraded, degraded}, degraded, batches:[batch record, §5]}` |
| receipt-store | **4002** | `PUT /receipts/:eventId` (indexes into `DATA_DIR/idx/<evidenceId>.txt` when the body carries a valid `evidenceId`; 400 on an invalid one); `GET /receipts/:eventId` (404 if missing); **M26** `GET /receipts?evidenceId=X` → JSON array of full receipts in first-PUT (leaf) order, `[]` if none, 400 `{error:'evidenceId query required'}` if missing/invalid |
| anchor-client | **4003** | `POST /roots` `{caseId,batchId,merkleRoot,meta}` → `201 {txId}` (submit on `anchor-main`); `GET /roots/:caseId/:batchId` (evaluate on `anchor-main`) |
| verification | **4004** | `GET /verify/:eventId` → `{ok,reason?,latencyMs,leafSource:"event"\|"receipt",steps:{fetchMs,recomputeMs,compareRootMs}}`; **M26**: when `receipt.event` is present the leaf is recomputed from it inside `recomputeMs` (`leafSource:"event"`), else the stored `leafHash` is used (`"receipt"`, legacy); `reason`: `root-mismatch` (200, tamper signal), `missing-receipt`/`missing-anchor-root` (404, not yet anchored), `malformed-receipt` (422 — the un-hardened witness stored junk; the `leafHash` hex-64 shape check still runs even when `event` is present), 502 upstream. With `VERIFY_METRICS_PATH` set, one JSONL line per completed verify: `{ts,eventId,ok,leafSource,fetchMs,recomputeMs,compareRootMs,latencyMs}` |
| case-registry | **4005** | internal-only (via gateway; `X-Gleipnir-Internal-Token` after `/healthz`): `POST/GET/PATCH /cases[/:caseId]`, `POST/PATCH/DELETE /cases/:caseId/participants[/:userId]` (PATCH = M25 in-place role change; policy in the gateway), `POST/DELETE /cases/:caseId/evidence[/:evidenceId]` (categorize; idempotent same-case, 409 cross-case; un-assign also clears `categoryId`), `POST/PATCH/DELETE /cases/:caseId/categories[/:categoryId]` (M19 taxonomy; name unique per case → 409; delete refused 409 while referenced; categories are read via `GET /cases/:caseId`, its `.categories` array), `POST /evidence-index` + `PATCH /evidence-index/:evidenceId` (accept the M19 metadata fields; `categoryId` must belong to the evidence's case; no single-row GET — rows are read through the search below), `GET /evidence-index?caseId=&q=&uploadedBy=&type=&from=&to=&visibleToUserId=`, `GET /internal/authz?userId=&evidenceId=` → `{allowed,caseId,roleInCase}`. `GET /cases` and the evidence-index search return at most 500 rows (S19 fixed cap; no `?limit`) |
| evidence-store | **4006** | internal-only (via gateway; `X-Gleipnir-Internal-Token` after `/healthz`): `PUT /blobs/:evidenceId` (raw body + `X-Content-Type`/`X-Original-Filename`) → `201 {integrityProof,sizeBytes,storedAt,rollbackToken}`, `409` if exists (immutable), `413` over `MAX_UPLOAD_BYTES`; `GET /blobs/:evidenceId` (attachment stream); `DELETE /blobs/:evidenceId` (ingest-rollback only; requires the `x-gleipnir-rollback-token` header carrying the token that blob's PUT returned — no query-string fallback) |
| frontend (nginx) | **8081** | serves SPA; `GET /healthz`; proxies `/api/*` → `gateway:3000` |

**Gateway public API** (prefix `/api/v1`, per ARCHITECTURE §6): `POST /evidence`
(JSON body — or `multipart/form-data` for library ingest: blob → evidence-store,
head committed with the store's proof, evidence-index row registered; the library
`caseId` never reaches the chain),
`POST /evidence/:id/transfer`, `POST /evidence/:id/access` (user sessions:
contributor-or-lead), `DELETE /evidence/:id` (M25 role ladder: user sessions
need the case-lead role — viewer = view/export, contributor = + write events
and annotations but never removal; the uploader keeps removal for their own
uncategorized evidence, which has no case lead),
`GET /evidence/:id`, `GET /evidence/:id/audit[?proofs=1]`, `GET /evidence/:id/download`,
`GET /evidence/:id/export`,
`GET /evidence/:id/verify?eventId=<eventId>` (the verify chain is keyed by **event**
id — receipts are per event; without the query param the gateway falls back to the
path id, which only matches when callers pass an eventId there),
**M26 (§12-12)**: on the batched variants `GET /evidence/:id` and `/audit` are served
from the **off-chain trail** (receipt-store index → each receipt's `event`, in receipt
order); `?proofs=1` (also `true`) attaches each event's `proof {leafHash, siblingPath,
batchId, leafIndex, rootRef:{scopeId,batchId,txId}}` verbatim from the receipt (ignored on
the direct variants); the folded head is `{id, version:'1.0', storage, identity:{subject},
custodian, status:'ACTIVE'|'DISPOSED', offChain:true}`, 404 when no events. `DELETE
/evidence/:id` → `DisposeEvidence` (event op `DISPOSE`; evidence-index status `DISPOSED`).
`GET /anchor-roots/:scopeId/:batchId` (any authenticated principal, 401 otherwise):
anchoring → raw `ReadAnchorRoot` JSON from `DEFAULT_CHANNEL` (chaincode not-found → 404);
parallel-anchored → proxy to anchor-client `GET /roots/:scopeId/:batchId` (upstream status +
body forwarded); standard/parallel → 404 `{error:'no anchor roots in this variant'}`. The
gateway never recomputes or verifies a branch — `benchmark/audit/reconstruct.js` does,
`GET /evidence/search`, `POST/GET/PATCH /cases[/:id]`, `GET /cases/search`,
`POST/PATCH/DELETE /cases/:id/participants[/:userId]` (PATCH is M25:
in-place role change, same policy as grant/revoke incl. the last-lead 409),
`GET /users/directory` (M25: active users for the roster picker;
admin-or-lead sessions only — investigator sessions and the service token
get 403; M25b: lead sessions never see admin accounts — admins sit above a
lead's access scope),
`POST/DELETE /cases/:id/evidence[/:evidenceId]`,
`POST/GET/PATCH/DELETE /cases/:id/categories[/:categoryId]` (M19: read =
case visibility, manage = admin-or-case-lead; M25: case-registry seeds each
new case with the preset file-type categories Image/Video/Audio/Document/Text
— ordinary rows, fully lead-editable),
`PATCH /evidence/:id/details` (M19 metadata; write-gated, never auto-logged),
`GET/POST /evidence/:id/notes` (M20; append-only, no mutation routes),
`PUT /evidence/:id/flag`, `GET /cases/:id/activity?limit=` (M20; M25b: reads
the persistent append-only `case_audit_log` — every library management
action is one actor-attributed row written in the same transaction as its
mutation, actor forwarded gateway→registry via `X-Gleipnir-Actor` and always
session-derived; evidence ACCESS events stay on-chain per evidence — the two
logs are complementary, never duplicated),
`GET /cases/:id/coc-report?format=csv|json` (M24: case-visibility gate;
assembles every exhibit's `GetAuditTrail`; user sessions synchronously
auto-append one `AccessLog('coc-report')` per exhibit AFTER assembly — the
reported trails are pre-report, mirroring `/export`; never for the service
token; CSV is hand-rolled RFC 4180, one row per CoC event; global/system
audit-log export stays deferred and CASE/UCO JSON-LD stays banned),
`POST /auth/login|logout`, `GET /auth/me`, `GET/POST /admin/users`,
`PATCH /admin/users/:id`, `POST /admin/users/:id/reset-password`.
(The M12 `POST/GET /runs` run-request store was REMOVED in M27, §12-19.)

**Auth (M12)** — two kinds of principal:
- **Service token**: static bearer (`GLEIPNIR_TOKEN`, default `dev-token`),
  documented as non-production. Contract unchanged: it guards **everything after
  `/healthz`, internal routes included** — the batcher, the verification service,
  Caliper's REST connector, and the smoke scripts all authenticate with it, and
  client-supplied `actor`/`identity.subject` fields are honored on this path.
- **User session**: opaque token from `POST /auth/login` (in-memory server-side,
  TTL `SESSION_TTL_SECONDS`); roles `admin`|`lead`|`investigator` enforced
  server-side (3-tier since M18, §12-8; UI labels "System Administrator" /
  "Lead Investigator" / "Investigator").
  Login is brute-force-throttled per (IP, username) — `LOGIN_MAX_ATTEMPTS`(5)/
  `LOGIN_WINDOW_SECONDS`(60) → `429` + `Retry-After` — and unknown usernames do
  full scrypt work against a dummy hash (no timing-based account enumeration).
  Admin-only: user management — the service token is **never**
  sufficient there. Case create is admin-or-lead (a lead creator lands on the
  roster as case `lead`; an admin may designate one via `leadUserId`); case
  update/roster/categorize is admin-or-that-case's-lead; all case management is
  session-only (the service token remains insufficient). Under a user session
  the audit actor is **always** the authenticated username; per-evidence
  reads/writes are authz-gated via case-registry `/internal/authz` (admins
  bypass for metadata/trails but NOT for blob content — `GET
  /evidence/:id/download` requires case participation even for admins, §12-8);
  and view/download/export **synchronously** auto-append `AccessLog` events
  (never for the service token — Caliper reads must not mutate the ledger).

**Library wire shapes (M13, pinned):**
- **User** `{id, username, name, role: admin|lead|investigator, active,
  createdAt, updatedAt}` — `name` was `displayName` until the M17 rename
  (§12-8);
  `passwordHash` never leaves the gateway's store; users are deactivated,
  never deleted. User identity in case-registry payloads is the immutable
  `username`.
- **Case** `{id: CASE-<uuid>, name, description, status: OPEN|CLOSED|ARCHIVED,
  createdBy, createdAt, updatedAt, myRoleInCase?}` (`myRoleInCase` = the
  caller's own case role, present only on participant-scoped listings, M18)
  + detail `participants[{userId, roleInCase: viewer|contributor|lead,
  addedBy, addedAt}]` + `evidence[EvidenceIndex]`. The case-`lead` role is
  grantable only to users whose global role is `lead`; a case that has a lead
  keeps at least one (removing the last lead is 409 for leads, admin-only).
- **EvidenceIndex** (read-model/cache — the ledger stays authoritative for
  status/custodian) `{evidenceId, caseId|null, originalFilename, mimeType,
  sizeBytes, integrityProof, uploadedBy, uploadedAt, status, lastSyncedAt,
  label|null, categoryId|null, seizedAt|null, acquisitionLocation|null,
  handedOverBy|null}` — the last five are M19 forensic metadata,
  **off-chain only** (the Codex-Entry head and CoC event are untouched).
  `label` is a human-readable item number (e.g. `ITEM-001`), deliberately
  NOT unique-enforced; the on-chain key stays the uuid `evidenceId`.
- **EvidenceCategory** (M19, per-case taxonomy) `{id: cat-<uuid>, caseId,
  name, createdBy, createdAt}` — name unique per case; managed by
  admin-or-case-lead; undeletable while referenced by evidence (409).
- **EvidenceNote** (M20) `{id: note-<uuid>, evidenceId, author, body,
  createdAt}` — **append-only, immutable by API**: no update or delete route
  exists at the gateway or the registry. Read = evidence read gate; write =
  evidence write gate; sessions always stamp the authenticated username as
  `author` (the service path honors the client author, same as audit actors).
- **Evidence flag** (M20): `EvidenceIndex.flag ∈ HIGH_PRIORITY | PROCESSED |
  NEEDS_LEAD_REVIEW | null` — one flag, strict enum, set via
  `PUT /evidence/:id/flag` (write gate); `flag=` joins the search filters.
- **CaseActivityEvent** (M20) `{type: CASE_CREATED|CASE_UPDATED|
  PARTICIPANT_ADDED|EVIDENCE_ADDED|NOTE_ADDED, ts, actor?, evidenceId?,
  detail?}` from `GET /cases/:id/activity?limit=` (case visibility gate) —
  **synthesized** ts-DESC from existing rows; there is deliberately no event
  table (per-change history is deferred with the logging mechanism), so
  CASE_UPDATED reflects only the latest update. Collaboration routes never
  auto-append `AccessLog` — they are library metadata, not evidence access.
- Multipart ingest response: `{evidenceId, eventId, integrityProof, txId|batched}`.
  Export bundle: `{evidenceId, exportedAt, record, auditTrail}` (trail as of the
  export moment; the export's own ACCESS event lands after it).

**Session ownership** (resolves the §3-table "only the gateway holds fabric-gateway
sessions" vs the anchor-client's need to write `anchor-main`): the **gateway** holds the
only sessions to the app channels (`coc-main`, `case-*`); the **anchor-client** holds
the only session to `anchor-main` (fixed AnchorClientMSP identity). The verification
service holds **no** Fabric session — it reads roots via gateway (Anchoring) or
anchor-client (Parallel-Anchored) depending on `VARIANT`. Flagged in §12.

## 7. Environment variables (exact names)

`VARIANT` ∈ `standard|anchoring|parallel|parallel-anchored` — read by gateway, batcher,
verification (the other services are variant-agnostic). `LOG_LEVEL` — read by batcher,
receipt-store, verification (default `info`; compose does not set it).
Gateway: `PORT=3000`, `GLEIPNIR_TOKEN`, `BATCHER_URL=http://merkle-batcher:4001`,
`VERIFICATION_URL=http://verification:4004`, **M26** `RECEIPT_STORE_URL=http://receipt-store:4002`
(off-chain trail reads on the batched variants; `receipts` dep on `createApp`) and
`ANCHOR_CLIENT_URL=http://anchor-client:4003` (`/anchor-roots` proxy on parallel-anchored;
passed as `deps.anchorClientUrl`, whereas `verificationUrl` lives in `config` — recorded
as-built), `PEER_ENDPOINT=peer0-org1:7051`,
`PEER_HOST_ALIAS=peer0.org1.example.com`, `MSP_ID=Org1MSP`, `CRYPTO_PATH`
(User1@org1 MSP dir), `TLS_CERT_PATH`, `DEFAULT_CHANNEL=coc-main`, `CC_NAME=evidence`,
library (M12–M15): `AUTH_DATA_DIR=/data/auth` (users.json; volume
`gateway-auth-data`), `ADMIN_USERNAME`/`ADMIN_PASSWORD` (first-boot admin seed,
empty-store only), `SESSION_TTL_SECONDS=28800`, `GLEIPNIR_INTERNAL_TOKEN`
(shared secret to case-registry/evidence-store),
`CASE_REGISTRY_URL=http://case-registry:4005`,
`EVIDENCE_STORE_URL=http://evidence-store:4006`, `MAX_UPLOAD_BYTES=26214400`.
Batcher: `PORT=4001`, **`BATCH_SIZE`** (int > 0; ONE grid for Anchoring and
Parallel-Anchored, §12-13; code and compose default 100, `.env` 50, overridden per run by
experiment.py),
**`BATCH_FLUSH_MS`** (int; `0` = size-only batching, the experiment constant; > 0 arms a
timer at the first enqueue of an open batch), `BATCH_EPOCH` (optional; namespaces
batchIds per batcher lifetime — experiment.py sets `<runId>-<unix>` per run, empty ⇒
start-time default), `GLEIPNIR_TOKEN` (bearer for the gateway's authed
`/internal/anchor-root`), `RECEIPT_STORE_URL=http://receipt-store:4002`,
`GATEWAY_URL=http://gateway:3000`, `ANCHOR_CLIENT_URL=http://anchor-client:4003`.
(`createApp` overrides use camelCase: `batchSize`, `flushMs`, `batchEpoch`.)
Receipt-store: `PORT=4002`, `DATA_DIR=/data` (receipts `<eventId>.json`; index
`idx/<evidenceId>.txt`).
Anchor-client: `PORT=4003`, `PEER_ENDPOINT=peer0-anchor:11051`,
`PEER_HOST_ALIAS=peer0.anchor.example.com`, `MSP_ID=AnchorClientMSP`, `CRYPTO_PATH`,
`TLS_CERT_PATH`, `ANCHOR_CHANNEL=anchor-main`, `CC_NAME=evidence`.
Verification: `PORT=4004`, `RECEIPT_STORE_URL`, `GATEWAY_URL`, `ANCHOR_CLIENT_URL`,
`GLEIPNIR_TOKEN` (bearer for the gateway's authed root-read endpoint),
`VERIFY_METRICS_PATH` (compose: `/verify-metrics/verify.jsonl` on the `verify-metrics`
volume; empty = off).
Case-registry: `PORT=4005`, `DATA_DIR=/data`, `GLEIPNIR_INTERNAL_TOKEN`.
Evidence-store: `PORT=4006`, `DATA_DIR=/data`, `GLEIPNIR_INTERNAL_TOKEN`,
`MAX_UPLOAD_BYTES=26214400`.
**Host-side (benchmark + orchestration, M26):** `GLEIPNIR_TXLOG_DIR` (per-round directory
the workloads append `tx-w<workerIndex>.jsonl` to; unset = no per-transaction logging),
`GATEWAY_URL` (default `http://localhost:3000`), `BATCHER_URL` (default
`http://localhost:4001`), `GLEIPNIR_TOKEN` (default `dev-token`; experiment.py falls back
to the `.env` value) — read by the REST connector, `verify.js`, `reconstruct.js` and
experiment.py; `GLEIPNIR_ALLOW_LEDGER_WIPE=1` — the only thing that lets
`reset-network.sh` (and `experiment.py`, which calls it before every run unless
`--reuse-network` is passed) remove the ledger volumes.

## 8. Compose: project, profiles, volumes

- Project name `gleipnir`, network `gleipnir-net`. Files per ARCHITECTURE §2:
  `compose-net.yaml` (orderers, peers, ccaas, cli/tools), `compose-ca.yaml` (4 CAs),
  `compose-services.yaml` (gateway, batcher, receipt-store, anchor-client, verification,
  case-registry, evidence-store, frontend).
- Profiles: base (no profile) = orderers, peers org1/org2, ccaas, cli, gateway,
  frontend, case-registry, evidence-store, **plus the three always-on CAs**
  (ca-org1, ca-org2, ca-orderer — only ca-anchor is behind a profile).
  `anchoring` = + merkle-batcher, receipt-store, verification.
  `parallel-anchored` = + merkle-batcher, receipt-store, verification, anchor-client,
  peer0-anchor, ccaas-evidence-anchor, ca-anchor.
  (`orchestration/up.sh --variant X` maps variant → profiles.)
- **Named volumes** (measurement design — never anonymous): `peer0org1-ledger`,
  `peer0org2-ledger`, `peer0anchor-ledger` → `/var/hyperledger/production`;
  `orderer0-ledger`, `orderer1-ledger`, `orderer2-ledger` →
  `/var/hyperledger/production/orderer`; `receipt-data` → `/data`; `verify-metrics` →
  `/verify-metrics` (verification service's per-request JSONL, M26);
  library (M16): `gateway-auth-data` → `/data/auth` (gateway),
  `case-registry-data` → `/data` (case-registry), `evidence-blob-data` → `/data`
  (evidence-store).
  (Runtime `docker volume` names carry the compose project prefix, e.g.
  `gleipnir_peer0org1-ledger`; measurement tooling probes paths inside containers, so
  the prefix does not affect it.)
- Node service images: `node:20.19-alpine` base — except case-registry, which is
  `node:20.19-slim` (better-sqlite3 v12 has no Node-20 prebuilt, so it compiles
  from source against a glibc toolchain at image build; §12 item 7); engines
  field pinned.

## 9. Variant routing matrix (gateway `variantRouter`)

| Variant | write path | read path (`ReadEvidence` / `GetAuditTrail`, M26) | root path | verify path |
|---|---|---|---|---|
| standard | `submit` on `coc-main` | `evaluate` on `coc-main` | — | — |
| anchoring | `POST batcher /events` | off-chain trail: receipt-store `GET /receipts?evidenceId=` → events (+ proofs) | batcher → gateway `/internal/anchor-root` → `CommitAnchorRoot` on `coc-main` | verification ← gateway `/internal/anchor-root/...`; `/anchor-roots` ← `ReadAnchorRoot` on `coc-main` |
| parallel | `submit` on `case-<id>` (from request `caseId`) | `evaluate` on `case-<id>` | — | — |
| parallel-anchored | `POST batcher /events` (per-case queues, same batch size) | off-chain trail (caseId still validated) | batcher → anchor-client `POST /roots` → `CommitAnchorRoot` on `anchor-main` | verification ← anchor-client `GET /roots/...`; `/anchor-roots` ← anchor-client proxy |

Scope note (deliberate default): on the **anchoring** root path the batcher sends
`meta:{scopeId,leafCount}` with **no `caseId` key**, so the chaincode's
`meta.caseId || "shared"` default selects the `shared` scope; receipts and the
verification reader use the same literal, so the round-trip is consistent by
construction. On the **parallel-anchored** path the anchor-client injects `caseId`
into metaJSON last, making it authoritative. Per-case writes (direct **and** batched)
require a valid `case-NNN` caseId at the gateway — a missing caseId is a 400, never a
silent fall-through to `shared`.

## 10. Benchmark & experiment config (M26 — supervisor brief 2026-09-22, §12-14)

- Single source of truth: **`benchmark/sweeps.yaml`** — that file, not this
  section, is the file of record. The block below is a condensed rendering of it:
  the parsed **values are verbatim**, but mappings are inlined and the comments
  abridged (the old `anchoring_batch_N` / `parallel_anchored_batch_K` /
  `offered_load_tps` keys are gone):

```yaml
seed: 20260922            # PRNG seed of the transaction trace — identical sequence across all variants
workers: 4                # Caliper worker processes (constant)
repetitions: 3            # r; results reported as mean ± SD over repetitions
batch_sizes: [10, 25, 50, 100, 200]               # E1 — ONE grid for Anchoring (N) and Parallel-Anchored (K)
channel_counts: [5, 10, 20, 30, 40, 50]           # E2 — Parallel only; bounded by host cores
send_rates_tps: [10, 25, 50, 75, 100, 150, 200]   # E3a — send rate = CONFIGURED offered load (input)
case_counts: [5, 10, 20, 30, 40, 50]              # E3b — trimmed to ≤ baseline.channels_max before E3b runs
baseline:                 # calibrated constants carried forward ("baseline", never "optimal")
  send_rate_tps: 50       # from E0/ramp (sub-saturation) → E1, E2, E3b, ops   [PLACEHOLDER until E0]
  batch_size: 50          # from E1 → E3, ops                                 [PLACEHOLDER until E1]
  channels: 20            # the SET case count (= channels on parallel*, one per case): E2 MEDIAN → E1, E3a, ops, ramp, cell default [PLACEHOLDER until E2]
  channels_max: 50        # from E2: top of the healthy range → E3b upper bound [PLACEHOLDER until E2]
workload:                 # controlled, identical across variants, recorded in every run.json
  evidence_per_case: 20
  events_per_case_per_round: 200  # per-worker share cases*200/workers must be an integer
  rounds: 5                       # trace slices per run (E1/E2/E3b); E3a uses one slice per send rate
  mix: { transfer_weight: 0.15, access_weight: 0.85, dispose_fraction: 0.5 }
  payload_bytes: 256              # synthetic Codex-Entry filler hashed into storage.integrity_proof
  audit_cases: 5                  # cases reconstructed per run (audit reconstruction time)
anchoring: { flush_timeout_ms: 0 }   # 0 = size-only batching; constant across runs
monitor:   { interval_s: 5 }         # Caliper docker resource monitor sampling interval
regimes:
  smoke:  { cases: 10, evidence_per_case: 2, logs_per_case_min: 10, logs_per_case_max: 25, send_rate_tps: 5 }
  steady: { min_events_per_channel: 1000 }   # below the floor a run is labelled "sub-floor", never "steady"
ramp: { events_per_case_per_round: 40 }      # E0 short ramp to locate approximate saturation
```

- Caliper workspace `benchmark/`, CLI pinned `@hyperledger/caliper-cli@0.6.0`; the exact
  verified `caliper bind` string (`fabric:fabric-gateway`) is recorded in
  `benchmark/README.md`.
- **Transaction trace** (`benchmark/trace/generate.js`, `npm run gen:trace`): a pure
  function of `(seed, cases, channels, evidencePerCase, eventsPerCasePerRound, rounds,
  workers, mix, payloadBytes)` (mulberry32 PRNG; same params → byte-identical file). File
  `benchmark/traces/<hash>.json` (gitignored; `hash = sha256(canonicalJSON(params))`):
  `{version:1, hash, params, sliceSize, opCounts:{total:{CREATE,TRANSFER,ACCESS,DISPOSE},
  perRound:[…]}, workers:[[item…]…]}`, item = `{op, dataCase, caseId:'case-NNN',
  evidenceId:'ev-cCCC-eEEE', actor, detail}` with `caseId` the channel routing key
  `NNN = ((dataCase−1) mod channels)+1`. Evidence `e` is owned by worker `e mod workers`;
  lifecycle order CREATE → (TRANSFER|ACCESS)* → [DISPOSE]; each worker holds exactly
  `rounds × S` items, `S = cases × eventsPerCasePerRound / workers` (integer, asserted);
  round `k` replays items `[k·S, (k+1)·S)`. DISPOSE count per worker =
  `round(dispose_fraction × owned evidence)`, `dispose_fraction` from `sweeps.yaml`
  `workload.mix`. The generator reads no `sweeps.yaml` and holds no param defaults: every
  param flag is required (`--cases` defaults to `--channels`), a missing one throws, and
  experiment.py passes them all from `sweeps.yaml`.
- **Workload modules** (identical across variants; `mode` selects the write path):
  `workload/trace.js` (mixed-workload replay), `createEvidence.js`, `transferCustody.js`,
  `accessLog.js`, `disposeEvidence.js` (per-operation writes), `read.js` (`ReadEvidence` /
  `GetAuditTrail`, `readOnly:true` in fabric mode, `GET` under the service token in rest
  mode — never auto-logged), `verify.js` (anchored variants). In rest mode both `read.js` and
  `verify.js` force a batch boundary (`lib/pool.flushBatcher` → `POST $BATCHER_URL/flush`)
  after their untimed seeding: the anchored variants answer reads and verifies from the
  off-chain trail, which exists only once a batch closes, so unflushed seeds would make those
  rounds measure 404s and empty arrays. Standard/Parallel drive Fabric
  via the peer-gateway connector (`mode: fabric`); Anchoring variants drive the gateway REST
  path via `benchmark/connectors/rest/` (`mode: rest`; non-2xx → `SetStatusFail` +
  `SetErrMsg(0, 'HTTP <status>')`).
- **Round arguments** (rendered by `orchestration/rounds.py`; names BINDING). Common — injected
  by `render_bench` into **every** round's `workload.arguments`, whatever the module: `mode
  fabric|rest`, `label` (default `round-<idx>`), `channels C` (Parallel variants only; the case
  selector returns null for standard/anchoring regardless) and `variant` (NOT trace-only:
  `payloads.caseSelector` suppresses the `case-NNN` spread **by variant name**, so a round
  rendered without it falls back to `channels: 1` → `case-001`, which routes Standard's fabric
  requests at a channel absent from `networks/coc-main.yaml` and stamps Anchoring's events with
  a caseId instead of the `shared` batch scope). Per-round: `trace <abs path>`, `slice k`, `sliceSize S` (trace.js
  throws on file/worker mismatch or exhaustion); `pool P` (transfer/access/dispose/read;
  **per worker**, so the per-operation rounds pass `ceil(P_total / workers)` with
  `P_total = evidence_per_case × cases` — the round's target set is `P_total` and each seeded
  item is used about once; ceiling division keeps `pool × workers ≥ txNumber`, which dispose
  requires because it disposes each item once and throws when it runs out); `payloadBytes`; `fn
  ReadEvidence|GetAuditTrail` (read.js); `seedCount` (verify.js); legacy `scenario: shared`
  + `sharedEvidenceId` (accessLog.js MVCC gate). `txNumber` is the TOTAL across workers.
  Benchconfig shape: `test.{name, description, workers.number, rounds[1]}` +
  `monitors.resource[{module: docker, options:{interval, containers:['/peer0.org1.example.com', …]}}]`
  (leading slash mandatory — Caliper matches `Names[0]` verbatim); `rateControl: fixed-rate
  tps`. Network config: standard `networks/coc-main.yaml`; parallel `parallel-c{C}.yaml`,
  rendered by `rounds.render_parallel_network(C)` into the run dir for EVERY parallel run
  (per-channel `contractID: evidence-case-NNN` unique alias); anchoring + parallel-anchored
  `networks/rest-gateway.yaml`. Nothing generated is committed under `benchmark/`: smoke (E0)
  rounds are rendered per launch into `rounds/<label>/bench.yaml` like every other round.
  Multi-channel
  rounds spread load round-robin across `case-001..case-00C` in ONE Caliper round, so round
  throughput is the **aggregate across channels**; `perChannelTpsDerived = aggregate / C`.
- **Per-transaction log** (`workload/lib/txlog.js`, `${GLEIPNIR_TXLOG_DIR}/tx-w<workerIndex>.jsonl`,
  one line per timed tx — and one per untimed ledger write — from Caliper's own `TxStatus`):
  `{"round":label,"op":"CREATE|TRANSFER|ACCESS|DISPOSE|READ_EVIDENCE|READ_TRAIL|VERIFY",
  "caseId":string|null,"evidenceId":string|null,"tCreate":ms,"tFinal":ms,"latencyMs":n|null,
  "ok":bool,"err":string|null,"timed":bool}`. `timed` is the trailing argument of
  `log(workerIndex, round, op, caseId, evidenceId, status, timed = true)`; `timed: false` marks
  a ledger write the round performed but never measured — `lib/pool.seedPool`'s pool seeding
  (through the connector) and `verify.js`'s seeding, which goes over plain `fetch` and so is
  recorded by `logUntimed(workerIndex, round, op, caseId, evidenceId, ok, err)` with
  `tCreate`/`tFinal`/`latencyMs` `null`. Those seeds ARE ledger writes: collect.py counts them
  in the storage bytes-per-event denominator and excludes them from every timing, throughput
  and failure statistic. Never on the timed path (buffered, appended off the event
  loop, synchronous flush at exit). Known limit: the 0.6.0 peer-gateway connector never
  calls `SetErrMsg` (verified in
  `@hyperledger/caliper-fabric/lib/connector-versions/peer-gateway/PeerGateway.js`), so `err`
  is `null` for fabric-mode failures; collect.py classifies those from `caliper.log`.
- **Round labels**: `smoke-create` / `smoke-logs` / `smoke-access-shared-gate` (standard) /
  `smoke-verify` (anchored) / `smoke-trace` (e0); `rate<R>` (ramp, e3a, cell with several send
  rates); `slice<k>` (e1, e2, e3b, cell with one send rate); `create` / `transfer` / `access` / `dispose` / `read-evidence` / `read-trail` /
  `verify-event` (ops).
- **Results layout** (gitignored, never edited by hand):
  `benchmark/results/<exp>/<variant>/<levels>/r<rep>/` with `levels =
  batch<N>-ch<C>-cases<K>[-ref]` (fixed key order, e.g. `batch50-ch20-cases20`; `cell` runs append
  `-rate<R>[-<R>…]` and, with control overrides, `-x<hash>`) containing
  `run.json` (seeded by experiment.py), `rounds/<label>/{bench.yaml, round.json, caliper.log,
  report.html, tx-w<i>.jsonl}`, `checkpoints.jsonl` (`t0..tN`), `anchoring.json` (batcher
  `/status` after the final flush), `audit.json` (reconstruct.js), `manifest.json`
  (collect.py); plus `benchmark/results/<exp>/<exp>-results.csv` (report.export_rounds, rewritten
  after every run) and `benchmark/results/runlog.jsonl` lines `{runId, exp, variant, levels,
  rep, startedAt, finishedAt, wallSeconds, status: complete|failed}`. `runId =
  '<exp>/<variant>/<levels>/r<rep>'`. Caliper's own `report.json` is not produced;
  `caliper.log` is the tee'd stdout collect.py parses (rows after the LAST `### All test
  results ###` marker; `### docker resource stats ###` table by header name). Smoke
  artifacts live under `results/e0/` labelled `regime: smoke` and are never mixed with
  steady data.
- **Run manifest** (`manifest.json`; collect.py merges INTO the seeded `run.json` —
  identity/provenance come only from `run.json`: experiment.py is their one writer, and a run
  dir without `run.json` no longer gets runId/levels/provenance backfilled by collect.py). Top level: `runId, experiment,
  variant, levels{batchSize, channels, cases, sendRateTps, reference}, repetition,
  regime: smoke|steady|sub-floor, status, trace{hash, params, opCounts, path}, rounds[],
  storage{}, anchoring, audit, payloadCompressionVsBaseline?, controls{workers,
  evidencePerCase, payloadBytes, auditCases, flushTimeoutMs, monitorIntervalS}, overrides{<sweeps
  path>: value} (cell CLI controls; {} otherwise), minChannelWriteEvents (actual, from the
  trace), provenance{gitCommit, configShas, sweepsSha, sweepsPath, caliper{version, binding,
  connector}, fabricTag, host{cores, memGb, platform}}, startedAt, finishedAt, wallSeconds` (+ `throughputPolicy`,
  `collectedAt`). `rounds[i]`: `label, index, module, slice, sendRateTps, succ, fail,
  sendRateReportedTps, latency{minS, avgS, maxS}, throughputReportedTps,
  throughputSuccessfulOnlyTps, txlog{count, ok, fail, failureRatePct,
  failureClasses{MVCC_READ_CONFLICT, ENDORSEMENT_POLICY_FAILURE, TIMEOUT, HTTP_4XX,
  HTTP_5XX, OTHER}, latencyMs{min, p50, p95, p99, max, mean, n}, sendRateMeasuredTps,
  windowS, perOp{OP:{…}}}` — `txlog` is computed over the **timed** records only —
  `untimedWrites` (count of successful write ops logged `timed: false`, i.e. the round's
  pool/verify seeding), `failureClassesLogScan{MVCC_READ_CONFLICT, ENDORSEMENT_POLICY_FAILURE,
  TIMEOUT, fabricStatusCodes{code:count}, source}|null` (present only when the round had
  failures; a `caliper.log` regex scan, reported ALONGSIDE and never merged into the tx-log
  classes, because the 0.6.0 peer-gateway connector sets no per-transaction error string;
  `fabricStatusCodes` keeps the raw `status code: N` TxValidationCodes unmapped),
  `failureClasses, resources{containers{name:{memMaxMb, memAvgMb,
  cpuMaxPct, cpuAvgPct, trafficInMb, trafficOutMb, discReadMb, discWriteMb}},
  groups{fabric|offchain|all:{containers, cpuAvgPctSum, cpuMaxPctSum, memAvgMbSum,
  memMaxMbSum}}}` and, for multi-channel cells, `channelsInCell, throughputScope,
  perChannelTpsDerived`. `storage` (the whole object is `null` when the LAST checkpoint has no
  block-store rows for the hosting peer — a dead `du` probe or container/channel name drift
  publishes nothing, with a printed warning, so report.py prints `-` rather than
  "0 bytes/event"): `checkpoints[], bytesPerEventRegression{slope,
  intercept, r2, points}|null` (OLS over ≥ 3 checkpoints of cumulative write events vs
  on-chain bytes = app channels + anchor channel; `r2: null` for a flat series, never `1.0`),
  `bytesPerEventDelta`,
  `onChainDeltaBytes, appChannelsDeltaBytes, anchorChannelDeltaBytes, perChannelDeltaBytes,
  stateDeltaBytes, offChainDeltaBytes, offChainBytesPerEvent, successfulWriteEvents, policy,
  series[{label, tsUtc, ledgerBytes, onChainBytes, stateBytes, receiptBytes, events}]`.
  **Storage denominator rule**: a round's write events = its TIMED successful write ops
  (`txlog.perOp`, else `succ` for a write module) **plus** its `untimedWrites`. Both kinds
  commit real transactions, so both produce block-store bytes; counting only the timed ones
  divides an `ops` round's growth by a fraction of the events that caused it.
  `anchoring`: `batchSize, flushTimeoutMs, batches, committedBatches, forcedBatches,
  delay{minS, meanS, maxS, batches}` (leafCount-weighted, from the batch records' `delayMs`
  ÷ 1000), `delayExcludingForced` | null. `audit`: `method
  ('on-chain-trail'|'merkle-branch'), cases, summary` (reconstruct.js summary verbatim) |
  null (ops runs have no trace, so no audit). `configShas` covers
  `network/configtx/configtx.yaml`, `network/core.yaml`, `network/orderer.yaml` and the
  three compose files.
- **Audit reconstruction** (`benchmark/audit/reconstruct.js`, `npm run audit`; host-side,
  via the gateway only): `--variant V --trace <file> [--cases 5] [--gateway URL] [--out
  FILE]`; module `reconstruct({variant, trace, cases, gateway, token})` → `{variant,
  method, traceHash, cases:[{caseId, dataCase, evidence, events, ms, verifiedEvents,
  failedEvents, rootReads}], summary:{msPerCase:{mean, sd, min, max}, msPerEvent,
  okRate}}`. Standard/Parallel: `GET /api/v1/evidence/:id/audit[?caseId=]` per evidence
  (verified = on-chain). Anchored: `…/audit?proofs=1`, recompute `leafHash(canonical(event))`,
  fold the sibling path (`audit/merkle.js`, byte-identical to the services' copy, pinned by
  `test/merkle-identity.test.js`), read each root once per `(scopeId, batchId)` via
  `GET /api/v1/anchor-roots/…` (404 = failed events), compare. Non-2xx on `/audit` throws.
- Throughput is reported **successful-only** (`reported × Succ/(Succ+Fail)`, issue #1418),
  stated in `benchmark/README.md`; "send rate" is the configured input, "throughput" the
  measurement, TPS only a unit. Storage compression is reported as the reduction in on-chain
  **bytes per event** vs a Standard baseline run (`collect.py --baseline`), never as 1/N of
  total ledger size. Anchored-variant write latency on the REST path is **enqueue latency**
  (the gateway's 202); ledger commit lag is the separate anchoring-delay metric.
- Paper-facing procedure, level-selection rules and flowcharts: `docs/methodology/experiments.md`.

## 11. Orchestration entry points

```
orchestration/up.sh --variant <v> [--channels <n>] [--skip-crypto]  # enroll → compose up → channels → ccaas → commit; with --skip-crypto on parallel-anchored, a missing/partial anchor org is enrolled ALONE (registerEnroll.sh anchor-only; org1/org2/orderer untouched) — §12-19
orchestration/down.sh [--wipe]                       # teardown; --wipe removes named volumes
orchestration/provision-channel.sh <caseId>          # genesis → osnadmin join(201) → peer join → approve/commit cc with CCAAS_ID_APP (install is org-scoped, done once by up.sh); writes no Caliper config
orchestration/reset-network.sh --variant <v> --channels <C>   # M26 ledger-only reset: needs GLEIPNIR_ALLOW_LEDGER_WIPE=1; down (no -v) → rm ONLY gleipnir_{orderer0,orderer1,orderer2,peer0org1,peer0org2,peer0anchor}-ledger, gleipnir_receipt-data, gleipnir_verify-metrics → rm network/channel-artifacts → unset CCAAS_ID_* → up.sh --skip-crypto (never touches gateway-auth-data, case-registry-data, evidence-blob-data, CA state, network/organizations)
orchestration/backup-volumes.sh <dir> [--restore]    # tar every gleipnir_* named volume via alpine (one file each); --restore REPLACES each volume's contents (empties it first) and refuses while a container uses the volume
orchestration/benchapp.pyw                           # desktop app (Windows host, Python 3.11 + Tk; drives experiment.py in WSL) — §12-19
orchestration/smoke-standard.sh                      # REST-path functional gate: create → transfer → access×2 → audit(==4) → dispose → status DISPOSED → transfer-fails
orchestration/smoke-library.sh                       # library gate (standard variant): login/roles → case+participant → multipart ingest → categorize → search → view/download/export auto-log asserts → authz negatives → trail==4
orchestration/rounds.py                              # library only (no CLI): the ONLY renderer of Caliper benchconfigs/network configs from sweeps.yaml — render_round()/network_config()/render_parallel_network(), called by experiment.py, which writes every rendered config into the run dir (nothing rendered is committed)
orchestration/experiment.py --exp e0|ramp|e1|e2|e3a|e3b|ops|cell [--variant V]* [--reps N] [--resume] [--dry-run] [--reuse-network] [--no-monitor] [--no-audit] [--verbose] [--sweeps FILE] [--send-rate R [R ...]] [--batch-size B] [--cases N] [--seed S] [--workers W] [--rounds K] [--events-per-case E] [--evidence-per-case V] [--transfer-weight T] [--access-weight A] [--dispose-fraction D] [--payload-bytes P] [--audit-cases N] [--flush-timeout-ms F] [--monitor-interval I]   # the campaign driver; the factor AND control flags are --exp cell only (§12-18); prints [run i/n] + ETA and per-round result lines, rewrites results/<exp>/<exp>-results.csv after every run (plans cells × reps; one network lifetime per run; lifecycle in §10 / orchestration/README). A FRESH ledger per run is the default; --reuse-network opts out (warned, one ad-hoc run)
orchestration/checkpoint.py <runPath> [--label tK]   # du -sb probes via docker exec, appends checkpoints.jsonl (runPath = <exp>/<variant>/<levels>/r<rep>)
orchestration/collect.py <run-dir> [--baseline <run-dir>] | --selftest   # run dir → manifest.json (rounds, per-tx percentiles, failure classes, resources, storage regression, anchoring, audit)
orchestration/report.py --exp e0|ramp|e1|e2|e3a|e3b|ops|cell [--out docs/results/<exp>] [--no-charts] [--decimal-comma]   # ALWAYS benchmark/results/<exp>/<exp>-results.csv (one row per run x round; supervisor column order send rate, throughput, latency min/max/avg/p95, CPU, memory, success, failure, failure rate; UTF-8 BOM; --decimal-comma = ';' + decimal comma); for e1..ops also CSV + Markdown tables (units in headers, mean ± SD over reps; Markdown = one table per variant with ONE latency column `avg (min–max), p95` of means, SDs in the CSV) + PNG charts (matplotlib optional); e3a also writes e3a-saturation.json (saturation = first send rate where successful throughput < 0.9 × send rate; latency knee alongside); ops → ops-writes.* and ops-reads.*; E1 reference rows carry no batch size and print `ref`, never the literal `None`; the per-round tables (e3a, ops) carry a header note that on-chain/off-chain bytes per event, audit time and anchoring delay are measured once per RUN and therefore repeat on every row
```

`experiment.py` shells out to: `bash reset-network.sh` (before every run unless
`--reuse-network`), `bash
provision-channel.sh case-NNN` (missing channels), `node benchmark/trace/generate.js … --out
<path>` (reads the printed sha256, moves the file to `benchmark/traces/<hash>.json`), `python
checkpoint.py`, `npx caliper launch manager --caliper-workspace . --caliper-benchconfig <abs
bench.yaml> --caliper-networkconfig <rel for standard/anchoring/parallel-anchored; for parallel ALWAYS the absolute run-dir rendering <run>/parallel-c<C>.yaml> --caliper-report-path <abs>` (cwd `benchmark/`, env
`GLEIPNIR_TXLOG_DIR=<run>/rounds/<label>`, `GATEWAY_URL`, `BATCHER_URL`, `GLEIPNIR_TOKEN`),
`GET $BATCHER_URL/status` (the per-round settle: poll until no root is `pending`) and, on the
LAST round, `POST $BATCHER_URL/flush` + `GET /status` **before** that round's checkpoint so the
run-end partial batch is inside the `t0→tN` delta, `node benchmark/audit/reconstruct.js`,
`python collect.py <run-dir>`. Anchored runs get `BATCH_SIZE`,
`BATCH_FLUSH_MS`, `BATCH_EPOCH` written to `.env` and the batcher recreated with `docker
compose -p gleipnir … --profile anchoring --profile parallel-anchored up -d --force-recreate
merkle-batcher`. Volume names assume compose project `gleipnir`.

Scripts are bash (target: Ubuntu 22.04 / WSL2) + Python 3.10+ (deps: `pyyaml`;
`matplotlib` optional for charts — `orchestration/requirements.txt`). `du` probes: block store
`/var/hyperledger/production/ledgersData/chains/chains/<channel>`, world state
`/var/hyperledger/production/ledgersData/stateLeveldb`, receipt store `/data`
(container `gleipnir-receipt-store`; world state is recorded once per container —
it is one GoLevelDB directory shared by all of a peer's channels).

## 12. Decision record (deviations/extensions vs ARCHITECTURE tables — all flagged)

1. **Anchor org with one peer.** §4.4's endorsement policy `AND('AnchorClientMSP.member')`
   can only be satisfied by an endorsing peer whose MSP is `AnchorClientMSP`; a client
   identity alone cannot endorse. So Parallel-Anchored adds `peer0-anchor` + `ca-anchor`
   (compose profile only). The §3 table's "2 peers / 2 CAs" holds for the other three
   variants. The alternative (endorse anchor roots with Org1) would violate the verbatim
   §4.4 policy — rejected.
2. **4 CAs, not 2.** CA-based enrollment (per the §4.4 "enrolled via Fabric CA 1.5.19"
   requirement) needs a CA per org: org1, org2, orderer, anchor. The §3 table counted
   only the peer-org CAs.
3. **Chaincode-as-a-Service.** CLAUDE.md pins Go 1.25.5, but the peer's in-image build
   (`fabric-ccenv:2.5`) ships an older Go toolchain. CCaaS builds the chaincode in our
   own `golang:1.25.5` image, honoring the pin exactly, and is the fabric-samples-2.5
   supported pattern. Also gives the chaincode lifecycle a named deployable unit for the
   STRIDE mapping.
4. **Session ownership split** (§6 above): gateway owns app-channel sessions;
   anchor-client owns the anchor-channel session. The §3 note "gateway is the only
   component holding fabric-gateway sessions" cannot hold simultaneously with §4.4
   (anchor-client submits roots itself); scoping it to app channels preserves both
   intents.
5. **Event sub-key uses tx timestamp + txID** instead of a client-passed counter, because
   the binding signatures carry no counter argument (§3 above). The invariant that
   matters — concurrent `AccessLog` produces distinct keys with zero MVCC conflicts — is
   preserved structurally.
6. **AccessLog never writes the head record** (else concurrent access-logging would
   conflict on the head). The head's "counter high-watermark" is realized as
   last-event-sortKey updated only by the serial ops (Create/Transfer/Remove).
7. **Evidence library (M12–M16) — scope and the two "case" concepts.** The library
   reopens CLAUDE.md's auth deferral (authorized by the authors: real login +
   server-enforced roles) and targets **Standard and Anchoring only**; Parallel /
   Parallel-Anchored keep the benchmark path unchanged. The library **Case** entity
   is off-chain only (case-registry SQLite; no chaincode or Codex-Entry change) with
   ids `CASE-<uuid>` — deliberately disjoint from the Parallel variants' channel
   routing key `caseId = case-NNN` (variantRouter `CASE_RE`), resolving the naming
   collision structurally: the two can never match, and the library caseId never
   reaches the chain. Case-registry runs on `node:20.19-slim` as a documented
   deviation from the alpine convention (better-sqlite3 v12 ships no Node-20
   prebuilt binary, so it is compiled from source against slim's glibc toolchain
   at image build). User identity in
   case payloads is the immutable username; users are deactivated, never deleted, so
   on-chain actors keep resolving. The evidence-store's blobs are immutable
   (exclusive-create), and the receipt store remains deliberately un-hardened — the
   library adds no integrity guarantees the design is supposed to measure.

8. **Library RBAC v2 and the `name` rename (M17–M18, authorized by the authors).**
   The pinned User wire field `displayName` is renamed to **`name`** across the
   store, API payloads, and SPA. (The one-time in-place `users.json` upgrade was
   removed 2026-09-26 in the ponytail refactor, §12-20: every live store had already
   been loaded, and so rewritten, by a post-M17 gateway, and the volume was re-seeded
   on 2026-07-24. A legacy record would now load with `name` unset; `passwordHash`
   handling is unchanged, so login still works.) The user role set is extended to **`admin` | `lead` |
   `investigator`** (UI labels "System Administrator" / "Lead Investigator" /
   "Investigator") and the per-case role set to **`viewer` | `contributor` |
   `lead`** (in the `case_participants` CHECK from CREATE; the one-time guarded
   in-place table rebuild for pre-M18 databases was removed 2026-09-26 in the ponytail
   refactor, §12-20, after every live volume had it). Case creation
   opens from admin-only to **admin-or-lead**: a lead who creates a case is
   auto-added to its roster as case `lead` and manages participants and
   evidence assignment **only on cases where they hold that role**; admins may
   designate a case lead at creation (`leadUserId`, which must reference an
   active global-`lead` user), and the case-`lead` role is grantable only to
   global-`lead` users. One deliberate narrowing of the M13c admin bypass:
   **admins may read metadata, audit trails, and exports of everything, but may
   not fetch evidence blob content (`GET /evidence/:id/download`) unless they
   participate in the evidence's case.** The service token's contract is
   untouched: it still bypasses all library authz, client-supplied actors are
   still honored on that path, the auto-AccessLog still never fires for it, and
   it remains insufficient for user/case management. Nothing here touches the
   chaincode, the Codex-Entry head, or the benchmark path.

9. **Library forensic metadata & collaboration (M19–M20, authorized by the
   authors).** The
   evidence library gains per-case **evidence categories** (a lead-managed
   taxonomy) and five **off-chain** ingest-metadata fields on the
   evidence-index read-model: `label` (human-readable item number, not
   unique-enforced — the on-chain key stays the uuid), `categoryId`,
   `seizedAt`, `acquisitionLocation`, `handedOverBy`. The columns are declared in
   the `evidence_index` CREATE TABLE; the one-time `PRAGMA table_info` / ALTER guards
   for pre-M19 databases were removed 2026-09-26 (ponytail refactor, §12-20) once every
   live volume carried the columns. Multipart ingest
   accepts the same fields and validates the category **before** any write
   (a bad category must not surface after the append-only chain commit).
   `buildHead`/`buildEvent` are untouched: the Codex-Entry head and the CoC
   event stay byte-identical, and none of this metadata ever reaches the
   chain. Metadata PATCHes are library bookkeeping, not evidence access —
   they are never auto-AccessLogged. M20 adds the collaboration layer on the
   same terms: **examiner notes** (append-only table; immutable-by-API — no
   update/delete surface exists, which is the integrity posture), a single
   strict-enum **evidence flag**, and a **synthesized case activity feed**
   (merged from existing timestamped rows — deliberately no event/log table;
   the system-wide audit-log mechanism and its exports remain deferred by
   the authors, and CASE/UCO JSON-LD remains banned). None of the
   collaboration routes write to the chain or auto-append `AccessLog`.

Entries 10–17 below are **M26 — authorized by the supervisor brief 2026-09-22**
(`GLEIPNIR_Supervisor_Guidance_Consolidated_2026-09-22.md` §4–§7, decided in the build
brief §1). Where an entry rests on one of the spec's OPEN questions it is a documented
default marked **confirm with D**; the code implements it, labels it, and does not silently
pick something else.

10. **`RemoveEvidence` → `DisposeEvidence`** (spec §4 item 11, RESOLVED). The fourth CoC op
    is renamed; `OpRemove`→`OpDispose = "DISPOSE"`, `StatusRemoved`→`StatusDisposed =
    "DISPOSED"`; the ISO/IEC 27037 annotation reads "Preservation — disposition; nothing is
    deleted: a status transition". The gateway's `DELETE /evidence/:id` maps to it, the
    evidence-index PATCHes `status: 'DISPOSED'`, the SPA `Op` type drops `REMOVE` (pills
    tolerate legacy `REMOVED` rows). `CC_VERSION` stays `1.0` (ccaas serves the rebuilt
    binary under the same package id; the git SHA pins the code — §3). The ARCHITECTURE §4.1
    binding signature is amended accordingly rather than kept as a stale alias.

11. **Off-chain event copy + leaf recompute** (the anchored variants' "fetch events →
    recompute branches → verify roots" path, spec §5.2 audit-reconstruction row). The
    receipt gains `evidenceId` and `event` (the CoC event as enqueued); the receipt store
    indexes receipts per evidence (`idx/<evidenceId>.txt`, first-PUT order) and lists them
    (`GET /receipts?evidenceId=`). The verification service and `reconstruct.js` recompute
    the leaf from `event` (inside `recomputeMs`) and fall back to the stored `leafHash` only
    for pre-M26 receipts (`leafSource`). The store stays **un-hardened**: the index is a
    text file, the copy is plain JSON, no hashes/signatures/replication — a tampered copy
    fails root verification instead of being trusted (CLAUDE.md invariant preserved; the
    off-chain trail is exactly as trustworthy as the receipt store).

12. **Batched-variant reads come from the off-chain trail.** `ReadEvidence` /
    `GetAuditTrail` on Anchoring / Parallel-Anchored are served by the gateway from the
    receipt-store index (events in receipt order; `?proofs=1` attaches the witness verbatim;
    the head is folded from the events and flagged `offChain: true`), because those variants
    keep no per-event record on the app channel — only the root. `GET /anchor-roots/…` hands
    the on-chain root to any authenticated caller; the gateway never verifies a branch. On a
    NON-wiped anchored stack, evidence written before M26 reads as 404 / an empty trail (its
    receipts carry no `event`; the on-chain root cannot be re-expanded) — by design, and why
    a campaign starts from `reset-network.sh`. Receipt-store list order is first-PUT order;
    concurrent same-scope batches can interleave, so a strict timeline sorts by `event.ts`.

13. **One batch-size grid for N and K** (spec §4 item 2 — identical-grid rule RESOLVED,
    values **confirm with D**): `batch_sizes: [10, 25, 50, 100, 200]` replaces the paper's
    separate N ∈ {10,50,100,250} and K ∈ {5,10,25,50}. The batcher reads `BATCH_SIZE`
    (default 100) and `BATCH_FLUSH_MS` (0 = size-only, held constant); experiment.py writes
    both per run. (The `BATCH_N`/`BATCH_K` fallback was removed 2026-09-26, §12-20.) Channel
    calibration is Parallel-only, Parallel-Anchored inherits, and Standard/Anchoring are
    code-enforced single-channel (`rounds.channels_for`; spec §4 item 18 — **confirm with
    D**, it corrects N's "all except Standard" remark).

14. **Three-experiment restructure + trace replay** (spec §4 items 1, 4, 7, 9, 12, 15–19;
    §5.3–§5.5). The old N/K/channel sweep (`sweep.py`, `generate-rounds.js`, the
    `steady-*.yaml` files) is replaced by E0 pilot → E1 batch calibration → E2 channel
    calibration → E3a/E3b scalability + a per-operation breakdown, driven by
    `experiment.py` from the new `sweeps.yaml` schema (§10) and rendered only by
    `rounds.py`. The harness replays one seeded trace identically across variants (only
    `mode` differs). Documented defaults **confirm with D**: send-rate grid
    `[10,25,50,75,100,150,200]` with saturation = successful throughput < 0.9 × send rate;
    `r = 3`, mean ± SD; the per-op breakdown at `(baseline.channels, baseline.send_rate_tps)`;
    `AccessLog` stays a WRITE custody event and reads (`ReadEvidence`, `GetAuditTrail`,
    `VerifyEvent`) are reported in a separate table; cases = `baseline.channels` for EVERY
    variant in an E1/E3a/ops/ramp cell so the replayed trace is the same data
    (Standard/Anchoring route all cases to the shared channel — the alternative, cases = 1
    for single-channel variants, would break the like-for-like trace); E3b runs all four
    variants (data-scaling sweep for the single-channel ones); the E0 audit uses a
    `smoke-trace` round (24 events/case — the largest ≤ 25 divisible by workers); ops and
    ramp runs are labelled `sub-floor` unconditionally, NOT by the steady rule (they are
    breakdown/pilot runs, not scalability claims — and the floor rule divides by channel
    count, so it would have labelled the same workload `steady` on the single-channel
    variants and `sub-floor` on the multi-channel ones, mixing labels inside one table);
    send rates are swept ASCENDING in both `ramp` and `e3a`; `run.json` records cores/memory. Cases-per-channel mapping
    (spec §4 item 5, spec §6 Q3) — **RESOLVED by the authors 2026-09-24: ONE CHANNEL PER CASE on
    Parallel and Parallel-Anchored, in every plan (E0 included: its 10 smoke cases run on 10
    case channels).** A plan sets only the case count (`make_run` derives the channel count via
    `rounds.channels_for`, so the two cannot drift); `baseline.channels` is the set case count;
    the old `workload.cases` decoupling key is removed. Standard/Anchoring put the same cases on
    their one shared channel, so the replayed trace stays like-for-like. Data-case c → channel
    `case-NNN`, NNN = c.

15. **Ledger-only reset between runs** (spec §5.5-6: fresh ledgers for storage measurement
    and independent repetitions). `reset-network.sh` removes exactly the six ledger volumes,
    `receipt-data` and `verify-metrics`, and refuses without `GLEIPNIR_ALLOW_LEDGER_WIPE=1`;
    it never removes the library volumes, CA state or `network/organizations` (the standing
    never-wipe-without-asking rule). `backup-volumes.sh` exists so the authors can snapshot
    everything first. `experiment.py` calls it **before every run by default** — the trace
    replays deterministic evidence ids, so a second run on the same ledger duplicates
    `CreateEvidence` on the direct-write variants, appends duplicate events to the off-chain
    trail on the anchored ones, and starts the storage series dirty; that is validity, not
    hygiene. `--reuse-network` opts out for a single warned, ad-hoc run, and then the running
    stack must match (`.env VARIANT`, and **exactly** the case channels the cell uses —
    missing ones are provisioned, extra ones abort the run) or the run aborts.
    (The no-op `--fresh-network` flag was removed 2026-09-26, §12-20; it is now an argparse
    error.) A re-executed
    run's `rounds/`, `checkpoints.jsonl`, `anchoring.json`, `audit.json` and `manifest.json`
    are cleared first, because tx logs and checkpoints are APPENDED and a retry would
    otherwise be collected together with the previous attempt.

16. **Per-transaction capture and the new metrics** (spec §4 item 12; §6 Q8 — **confirm with
    D** that the custom capture is worth it vs avg (min–max) only). Every workload writes one
    JSONL line per timed transaction from Caliper's own `TxStatus`; collect.py derives p50/
    p95/p99, measured send rate, success/failure counts, failure rate and the six failure
    classes from it (fabric-mode failures classified from `caliper.log`, since the 0.6.0
    peer-gateway connector sets no error string). CPU/memory come from Caliper's docker
    monitor (per container + `fabric`/`offchain`/`all` groups); audit reconstruction time
    (**confirm with D**, spec §6 Q9) from `reconstruct.js` (per case, Merkle verification
    included, first `audit_cases` cases of the trace, evidence fetched sequentially — that IS
    "time to reconstruct one case"); anchoring delay from the batcher's batch records
    (leafCount-weighted; forced batches also reported excluded); storage (**confirm with D**,
    spec §6 Q10) from `t0..tN` checkpoints with an OLS bytes/event slope (≥ 3 points) and the
    delta as cross-check, off-chain bytes shown alongside, over a denominator of timed
    successful writes PLUS `untimedWrites` (the untimed pool/verify seeding commits real
    transactions, so its bytes are in the series and its events must be in the divisor).
    report.py's
    run-level p95 is the mean of per-round p95s (e3a is reported per round, so exact there).

17. **`committedAt` semantics** (**confirm with D** for the paper's anchoring-delay
    definition): recorded when the root submission RETURNS to the batcher. The gateway /
    anchor-client await the Fabric commit before answering, so the delay = enqueue → commit
    acknowledged, submit round-trip included; the batcher does not observe the block commit
    independently. The verification service's `verify.jsonl` (`verify-metrics` volume) is a
    secondary per-request trace: it is removed by `reset-network.sh` but not otherwise
    rotated by experiment.py, and collect.py does not fold it into the manifest — the
    manifest's verify numbers come from the `VERIFY` op in the tx-log.

18. **`--exp cell` — one ad-hoc cell with CLI factor levels** (author request 2026-09-24:
    a reusable runner that can test any level of the experimental variables). The four
    factors are CLI flags, valid ONLY with `--exp cell`: `--send-rate R [R ...]` (the
    CONFIGURED send rate in tx/s — rendered as Caliper's `fixed-rate` `opts.tps`, which is
    that controller's own key name, not a throughput; several rates → one round per rate,
    ascending, the e3a shape; one rate → `workload.rounds` slices, the e1/e2/e3b shape),
    `--batch-size` (anchored variants) and `--cases` (the trace's cases, the same for every
    variant so the replayed operation sequence stays like-for-like — and, per §12-14, the
    channel count on the parallel variants: there is no separate `--channels`). An omitted
    factor takes its `sweeps.yaml` baseline (`--cases` → `baseline.channels`). Rejected, never
    ignored: a factor no selected variant uses (a run labelled with a batch size it never used
    is mislabelled data), a level < 1, and any factor flag on another `--exp`. Results go to `results/cell/<variant>/<levels>-rate<R…>/r<rep>`
    — report.py exports them to the per-round CSV only and builds no aggregated table: a cell
    is a probe, not an E1–E3 datapoint. Every parallel run (any channel count) gets its
    `parallel-c{C}.yaml` rendered by `rounds.py` into the run dir (none are committed).
    **Controls** (author request 2026-09-24, brief §5.5-1 "parameterizable"): `--seed
    --workers --rounds --events-per-case --evidence-per-case --transfer-weight --access-weight
    --dispose-fraction --payload-bytes --audit-cases --flush-timeout-ms --monitor-interval`,
    also `--exp cell` only (a campaign's controls stay those of `sweeps.yaml`, or of a
    `--sweeps` file — resolved to an absolute path — whose own blob SHA is now what `run.json`
    records), so `sweeps.yaml` stays the single source of every CAMPAIGN constant. They
    override an in-memory copy, are recorded in `run.json` `overrides` (+ `controls`: workers,
    evidence/case, payload, audit cases (capped at the cell's cases — reconstruct.js audits
    only existing cases), flush timeout, monitor interval), tag the run dir
    `-x<sha256(overrides)[:6]>`, and are checked with `generate.js --dry` at plan time, so a
    trace the generator refuses fails the `--dry-run`, with the generator's reason. Also new for every plan: `cases × events_per_case_per_round`
    not divisible by `workers` fails at plan time; the trace is generated BEFORE the ledger
    reset; a repeated `--variant` is de-duplicated; and the steady floor is judged on the
    LEAST-loaded channel, not the mean: at plan time on the nominal `rounds × events ×
    ⌊cases / channels⌋`, then — once the trace exists, before the reset — on the trace's
    ACTUAL per-channel write events (`minChannelWriteEvents`). The generator fixes the total
    per worker, not per case, so channels scatter around the nominal: at the committed
    `sweeps.yaml` (nominal exactly 1000 per channel) 20 cases / 20 channels gives 938–1060
    with 8 channels below 1000, 50/50 gives 935–1070 with 24 below. Such runs were labelled
    `steady` and are now `sub-floor` — **OPEN for the authors: raise
    `workload.events_per_case_per_round` or `rounds` so the least-loaded channel clears the
    floor** (a `sweeps.yaml` decision, not made here). Progress lines + the per-round CSV
    export (`report.export_rounds`, rewritten after every run; a write failure — e.g. the CSV
    open in Excel — only warns, never stops a campaign) are reporting only.
    Checks: `orchestration/test_experiment.py`.

19. **Desktop benchmark app replaces the web operator dashboard** (author decision 2026-09-24,
    M27). The admin `DashboardPage`, its run-request form and the gateway `POST/GET /runs`
    store are REMOVED: nothing ever executed a request, its history scanned one directory
    level (every M26 result was invisible) and its charts read a `metrics` field nothing
    wrote. The gateway no longer mounts `benchmark/results` (`RESULTS_DIR` gone) and the SPA
    no longer depends on recharts. In its place `orchestration/benchapp.pyw` (Tk, Windows host)
    + `benchcore.py` (no UI; `test_benchapp.py`):
    - **One driver still.** The app only launches `experiment.py` inside WSL
      (`wsl --exec bash -lc …` — `--exec`, because `wsl -- …` re-parses the command through
      the default shell and expands `$vars` first); a real run is
      `GLEIPNIR_ALLOW_LEDGER_WIPE=1 setsid --wait python3 -u orchestration/experiment.py …`,
      a Preview is `--dry-run` without the flag. The app's runs carry the no-op CPython option
      `-X benchapp`, so Cancel = SIGINT to the process group of the APP'S OWN run only (Caliper
      and its workers included; a terminal campaign is never touched), SIGKILL on a second
      click after 30 s; during a Preview or backup Cancel only stops what comes next (a finished
      backup is kept, the stack restarted), and it is unavailable during a restore. The busy
      check (before any backup/restore/run) sees ANY `experiment.py`, including one started as
      `python3 -u experiment.py` inside `orchestration/`. Resume = `--resume`; a plan with
      nothing left to execute stops before the backup. A `--reuse-network` cell resets nothing,
      so it is not backed up and leaves the ledger-origin record alone. The app refuses to save
      `sweeps.yaml` or apply a baseline while a benchmark is running, and a restore reports
      success only when the stack came back healthy.
    - **sweeps.yaml stays the single source.** Input boxes write it only on an explicit Save
      or "Use as baseline", IN PLACE with every comment kept (`set_sweeps_value`: line-based,
      re-parses and refuses unless exactly the edited path changed, refuses if the file
      changed on disk). Baseline edits are tagged in the line's provenance note: `[set by
      hand <date>]` or `[set from <exp> <date>]` (replacing `[PLACEHOLDER …]`).
    - **Suggested baselines, never automatic** — pure functions in report.py
      (`ramp_suggestion`/`suggest_send_rate`, `suggest_batch_size`, `suggest_channels`)
      implementing docs/methodology/experiments.md §4.1–4.3 (thresholds `PLATEAU_REL` 5 %,
      `AUDIT_BOUND` 1.5×, `HEALTHY_TPS_RATIO` 0.95, `HEALTHY_MAX_FAIL_PCT` 1 %,
      `HEALTHY_CPU_FRAC` 0.9 — **confirm with D**); the send-rate suggestion is the MINIMUM
      of the per-variant ramp suggestions because E1/E2/E3b run every variant at one rate
      (**confirm with D**). `report.py --exp ramp|e1|e2` prints the same suggestion.
    - **Backups before any ledger wipe.** Before a run the app stops the stack (`down.sh`,
      never `--wipe`), copies every `gleipnir_*` volume + `network/compose/.env` to
      `backups/<ts>/` (gitignored), `gzip -t`s every archive, and only then starts
      experiment.py; "Restore my test data" = `down.sh` → `backup-volumes.sh <dir> --restore`
      → `.env` back → `compose up -d --no-build` for that variant (never `up.sh`, which
      would re-create channels the restored ledger already has). `backups/state.json`
      records whether the live ledger holds test data or benchmark data.
    - **Plan-time floor preview.** `generate.js --dry` now also prints
      `minChannelWriteEvents`; `experiment.py` shows a `steady` run whose generated trace
      leaves a channel under the floor as `sub-floor` in the plan (the same check
      `recheck_floor` applies at run time).
    - **`up.sh --skip-crypto` on Parallel-Anchored enrols a missing anchor org** (found live
      2026-09-25: a host whose crypto was generated for another variant has no — or, after a
      failed start, docker-created empty — anchor-org MSP, so every Parallel-Anchored reset
      timed out waiting for `peer0-anchor`). Only the anchor org is enrolled
      (`registerEnroll.sh anchor-only`); org1/org2/orderer material is reused unchanged.
    Live-verified 2026-09-24/25: backup → restore round trips with the fixture trails, accounts
    and cases intact; E0 through the app — Resume skipping the complete runs, Cancel at round 2
    (process group incl. Caliper workers gone, runlog `failed`), Resume to completion
    (Parallel, 10 case channels), Parallel-Anchored after the anchor-org fix, Restore.

20. **Ponytail audit + refactor** (2026-09-26, branch `ponytail-refactor`; every contract
    change below signed off by the authors under CLAUDE.md ground rule 2). A whole-repo
    over-engineering audit, then deletions and simplifications across every module. The
    contract-visible changes:
    - **benchmark/**: no generated file is committed any more — `benchmarks/smoke-*.yaml`,
      `networks/parallel-c*.yaml` and `networks/case-template.yaml` are gone, as are
      `rounds.py --static` and the `launch:smoke` npm script. `rounds.py` is a library with no
      CLI; experiment.py renders every round (E0 smoke included) and every parallel network
      config (`parallel-c{C}.yaml`, `render_parallel_network`) into the run dir (§10, §11).
      The legacy per-round `caseId` / `channel` arguments are gone (the case target comes only
      from `channels` + `variant` via `payloads.caseSelector`). `trace/generate.js` no longer
      reads `sweeps.yaml` or holds defaults — every param flag is required — and emits traces
      byte-identical to the old generator's for the same params.
    - **orchestration/**: `teardown-channel.sh` removed (`reset-network.sh` changes a stack's
      channel set); `provision-channel.sh` no longer emits a Caliper config;
      `--fresh-network` removed (argparse error); `.env` no longer carries `BATCH_N` /
      `BATCH_K`; collect.py takes identity/provenance only from `run.json` (no backfill).
    - **services/**: batcher `BATCH_N` / `BATCH_K` fallback removed (`BATCH_SIZE` default 100,
      = compose); evidence-store `GET /blobs/:id/meta`, `GET /blobs/:id/verify` and the
      `?rollbackToken=` DELETE fallback removed (header only); case-registry
      `GET /cases/:id/categories` and `GET /evidence-index/:id` removed (read via
      `GET /cases/:id` and the search), `?limit` removed (fixed 500-row cap); `LOG_LEVEL` no
      longer read by case-registry / evidence-store (§6, §7). Spent one-time boot migrations
      removed: the M18 CHECK rebuild, the M19 column guards, the M25 preset-category backfill
      and the M25b case-audit-history backfill (every live `case-registry-data` volume already
      carries their effects; §12-8, §12-9).
    - **gateway/**: the M17 `users.json` in-place upgrade removed (§12-8);
      `SESSION_IDLE_TTL_SECONDS` removed (sliding idle timeout fixed at 30 min); the
      `batcherClient` / `receiptsClient` modules folded into `serviceClients.js`. No public
      route changed.
    - **network/compose/**: the three files share `x-*` anchors; the merged `docker compose
      config` differs from the pre-refactor one only by dropped keys — `ORDERER_` /
      `CORE_METRICS_PROVIDER=prometheus` (nothing scraped it; `orderer.yaml` / `core.yaml`
      say `disabled`) and env/keys that restated image or yaml defaults (`FABRIC_CA_HOME`,
      `FABRIC_LOGGING_SPEC`, `ORDERER_GENERAL_BOOTSTRAPMETHOD`, `CORE_PEER_PROFILE_ENABLED`,
      ccaas `hostname` / `CORE_CHAINCODE_ID_NAME`, the peers' unused
      `CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG`, cli `GOPATH`/tty). These files are in `run.json`
      `configShas`, so runs after this commit carry new compose SHAs.
    - **frontend/**: `settings.tsx` (a client-side variant setting) removed, as are the unused
      NotFound/Unauthorized pages and CasesAdminPage's create-case and participant cards
      (admins create cases from MyCasesPage and manage rosters in CaseDetailPage's Team tab).
      **Bug fix:** the evidence-detail MerkleBadge / Verify controls now derive "anchoring"
      from the per-event `batched: true` flag of the gateway's write response (202 on
      Anchoring / Parallel-Anchored) instead of a client setting that could disagree with the
      running variant. No gateway or §6 wire change.
    - **chaincode/**: the `zeroPad19` helper became `fmt.Sprintf("%019d", …)` — the event
      sortKey is byte-identical (§3); `CC_VERSION` stays `1.0`.
    The chaincode and workload edits are behaviour-preserving (chaincode `go test`, benchmark
    `npm test`, and `collect.py` re-run on copies of the four E0 run dirs giving manifests
    identical to the pre-refactor ones apart from `collectedAt`). Because the chaincode, workloads and compose
    files changed, **E0 must be re-smoked for all four variants before any steady-state
    sweep**; the earlier E0 results stay valid for the commit they cite.

Anything else that seems to require deviating from ARCHITECTURE.md or CLAUDE.md: STOP
and ask the authors (per CLAUDE.md ground rule 2).
