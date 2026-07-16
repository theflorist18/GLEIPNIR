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
| `case-001` … `case-005` | Org1MSP, Org2MSP | Parallel, Parallel-Anchored | one channel per case, provisioned by `orchestration/provision-channel.sh` |
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
RemoveEvidence(ctx, evidenceId, reason string) error
CommitAnchorRoot(ctx, batchId, merkleRoot, metaJSON string) error
ReadEvidence(ctx, evidenceId) (string, error)
GetAuditTrail(ctx, evidenceId) (string, error)
ReadAnchorRoot(ctx, scopeId, batchId) (string, error)   // scopeId: caseId, or "shared"
```

- **State key design** (the MVCC-critical part):
  - head record: `CreateCompositeKey("evd", [evidenceId])` — holds Codex-Entry metadata,
    current custodian, status (`ACTIVE`/`REMOVED`). Written ONLY by `CreateEvidence`,
    `TransferCustody`, `RemoveEvidence` (semantically serial per evidence — custody is a
    chain). **`AccessLog` never reads or writes the head.**
  - event records: `CreateCompositeKey("evt", [evidenceId, sortKey])`, append-only, where
    `sortKey = zeroPad19(txTimestampUnixNanos) + "-" + txID[:12]`. Both components come
    from the signed proposal, so they are deterministic across endorsers, unique per tx,
    and require **no shared counter key**. This realizes ARCHITECTURE §4.1's
    "client-derived monotonic counter" without adding a counter argument to the binding
    signatures. Concurrent `AccessLog` to the same evidence therefore writes distinct
    keys — zero `MVCC_READ_CONFLICT` by construction.
  - anchor roots: `CreateCompositeKey("root", [scopeId, batchId])` where `scopeId` is
    taken from `metaJSON.caseId`, defaulting to `"shared"` (Anchoring variant).
  - `GetAuditTrail` = `GetStateByPartialCompositeKey("evt", [evidenceId])`, returns a JSON
    array ordered by sortKey (iterator order).
- Each of the four CoC ops carries its ISO/IEC 27037 clause annotation as a Go comment.

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
  "op": "CREATE | TRANSFER | ACCESS | REMOVE",
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

**Receipt** (receipt-store): `{"eventId","leafHash","siblingPath":[{"pos","hash"}],
"batchId","leafIndex","rootRef":{"scopeId","batchId","txId"}}`. `txId` may be filled in
by a follow-up PUT after the root commit returns. `batchId` is an **opaque string**,
unique per (scope, batcher lifetime) — currently `<scopeId>-<epoch>-b<seq>`, where the
epoch (BATCH_EPOCH env or batcher start time) keeps ids from colliding with roots an
earlier batcher process already committed to the persistent ledger. Duplicate-eventId
enqueues are rejected 409 **within the open batch only**; a retry after the boundary
lands in the next batch and its receipt PUT overwrites the previous witness
(at-most-once per batch, not per ledger).

**Anchor root record** (on-chain): `{"scopeId","batchId","merkleRoot","leafCount",
"meta":{...},"txTimestamp"}`.

## 6. Service ports & REST APIs (all JSON; all expose `GET /healthz` → `{"ok":true}`; the gateway's healthz adds a `variant` field)

| Service | Port | Endpoints |
|---|---|---|
| gateway (BFF) | **3000** | public API below; plus internal: `POST /internal/anchor-root` `{batchId,merkleRoot,meta}` → submits `CommitAnchorRoot` on `coc-main` (Anchoring variant only); `GET /internal/anchor-root/:scopeId/:batchId` → evaluates `ReadAnchorRoot` on `coc-main` |
| merkle-batcher | **4001** | `POST /events` (CoC event) → `202 {batchId,leafIndex}`; `POST /flush` → force batch boundary (partial-batch policy at run end); `GET /status` |
| receipt-store | **4002** | `PUT /receipts/:eventId`; `GET /receipts/:eventId` (404 if missing) |
| anchor-client | **4003** | `POST /roots` `{caseId,batchId,merkleRoot,meta}` → `201 {txId}` (submit on `anchor-main`); `GET /roots/:caseId/:batchId` (evaluate on `anchor-main`) |
| verification | **4004** | `GET /verify/:eventId` → `{ok,reason?,latencyMs,steps:{fetchMs,recomputeMs,compareRootMs}}`; `reason`: `root-mismatch` (200, tamper signal), `missing-receipt`/`missing-anchor-root` (404, not yet anchored), `malformed-receipt` (422 — the un-hardened witness stored junk) |
| case-registry | **4005** | internal-only (via gateway; `X-Gleipnir-Internal-Token` after `/healthz`): `POST/GET/PATCH /cases[/:caseId]`, `POST/DELETE /cases/:caseId/participants[/:userId]`, `POST/DELETE /cases/:caseId/evidence[/:evidenceId]` (categorize; idempotent same-case, 409 cross-case), `POST/GET/PATCH /evidence-index[/:evidenceId]`, `GET /evidence-index?caseId=&q=&uploadedBy=&type=&from=&to=&visibleToUserId=`, `GET /internal/authz?userId=&evidenceId=` → `{allowed,caseId,roleInCase}` |
| evidence-store | **4006** | internal-only (via gateway; `X-Gleipnir-Internal-Token` after `/healthz`): `PUT /blobs/:evidenceId` (raw body + `X-Content-Type`/`X-Original-Filename`) → `201 {integrityProof,sizeBytes,storedAt}`, `409` if exists (immutable), `413` over `MAX_UPLOAD_BYTES`; `GET /blobs/:evidenceId` (attachment stream); `GET /blobs/:evidenceId/meta`; `GET /blobs/:evidenceId/verify?expected=<ni-uri>`; `DELETE /blobs/:evidenceId` (ingest-rollback only) |
| frontend (nginx) | **8081** | serves SPA; `GET /healthz`; proxies `/api/*` → `gateway:3000` |

**Gateway public API** (prefix `/api/v1`, per ARCHITECTURE §6): `POST /evidence`
(JSON body — or `multipart/form-data` for library ingest: blob → evidence-store,
head committed with the store's proof, evidence-index row registered; the library
`caseId` never reaches the chain),
`POST /evidence/:id/transfer`, `POST /evidence/:id/access`, `DELETE /evidence/:id`,
`GET /evidence/:id`, `GET /evidence/:id/audit`, `GET /evidence/:id/download`,
`GET /evidence/:id/export`,
`GET /evidence/:id/verify?eventId=<eventId>` (the verify chain is keyed by **event**
id — receipts are per event; without the query param the gateway falls back to the
path id, which only matches when callers pass an eventId there),
`GET /evidence/search`, `POST/GET/PATCH /cases[/:id]`, `GET /cases/search`,
`POST/DELETE /cases/:id/participants[/:userId]`,
`POST/DELETE /cases/:id/evidence[/:evidenceId]`,
`POST /auth/login|logout`, `GET /auth/me`, `GET/POST /admin/users`,
`PATCH /admin/users/:id`, `POST /admin/users/:id/reset-password`,
`POST /runs`, `GET /runs`, `GET /runs/:id`.

**Auth (M12)** — two kinds of principal:
- **Service token**: static bearer (`GLEIPNIR_TOKEN`, default `dev-token`),
  documented as non-production. Contract unchanged: it guards **everything after
  `/healthz`, internal routes included** — the batcher, the verification service,
  Caliper's REST connector, and the smoke scripts all authenticate with it, and
  client-supplied `actor`/`identity.subject` fields are honored on this path.
- **User session**: opaque token from `POST /auth/login` (in-memory server-side,
  TTL `SESSION_TTL_SECONDS`); roles `admin`|`investigator` enforced server-side.
  Admin-only: user management, case create/update/roster/categorize, `POST /runs`
  — the service token is **never** sufficient there. Under a user session the
  audit actor is **always** the authenticated username; per-evidence reads/writes
  are authz-gated via case-registry `/internal/authz` (admins bypass); and
  view/download/export **synchronously** auto-append `AccessLog` events (never
  for the service token — Caliper reads must not mutate the ledger).

**Library wire shapes (M13, pinned):**
- **User** `{id, username, displayName, role: admin|investigator, active,
  createdAt, updatedAt}` — `passwordHash` never leaves the gateway's store; users
  are deactivated, never deleted. User identity in case-registry payloads is the
  immutable `username`.
- **Case** `{id: CASE-<uuid>, name, description, status: OPEN|CLOSED|ARCHIVED,
  createdBy, createdAt, updatedAt}` + detail `participants[{userId, roleInCase:
  viewer|contributor, addedBy, addedAt}]` + `evidence[EvidenceIndex]`.
- **EvidenceIndex** (read-model/cache — the ledger stays authoritative for
  status/custodian) `{evidenceId, caseId|null, originalFilename, mimeType,
  sizeBytes, integrityProof, uploadedBy, uploadedAt, status, lastSyncedAt}`.
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
`VERIFICATION_URL=http://verification:4004`, `PEER_ENDPOINT=peer0-org1:7051`,
`PEER_HOST_ALIAS=peer0.org1.example.com`, `MSP_ID=Org1MSP`, `CRYPTO_PATH`
(User1@org1 MSP dir), `TLS_CERT_PATH`, `DEFAULT_CHANNEL=coc-main`, `CC_NAME=evidence`,
`RESULTS_DIR=/results` (runs-API store; compose binds `benchmark/results`);
library (M12–M15): `AUTH_DATA_DIR=/data/auth` (users.json; volume
`gateway-auth-data`), `ADMIN_USERNAME`/`ADMIN_PASSWORD` (first-boot admin seed,
empty-store only), `SESSION_TTL_SECONDS=28800`, `GLEIPNIR_INTERNAL_TOKEN`
(shared secret to case-registry/evidence-store),
`CASE_REGISTRY_URL=http://case-registry:4005`,
`EVIDENCE_STORE_URL=http://evidence-store:4006`, `MAX_UPLOAD_BYTES=26214400`.
Batcher: `PORT=4001`, `BATCH_N=100`, `BATCH_K=25`, `BATCH_EPOCH` (optional; namespaces
batchIds per batcher lifetime — sweep.py sets it per cell, empty ⇒ start-time default),
`GLEIPNIR_TOKEN` (bearer for the gateway's authed `/internal/anchor-root`),
`RECEIPT_STORE_URL=http://receipt-store:4002`, `GATEWAY_URL=http://gateway:3000`,
`ANCHOR_CLIENT_URL=http://anchor-client:4003`.
Receipt-store: `PORT=4002`, `DATA_DIR=/data`.
Anchor-client: `PORT=4003`, `PEER_ENDPOINT=peer0-anchor:11051`,
`PEER_HOST_ALIAS=peer0.anchor.example.com`, `MSP_ID=AnchorClientMSP`, `CRYPTO_PATH`,
`TLS_CERT_PATH`, `ANCHOR_CHANNEL=anchor-main`, `CC_NAME=evidence`.
Verification: `PORT=4004`, `RECEIPT_STORE_URL`, `GATEWAY_URL`, `ANCHOR_CLIENT_URL`,
`GLEIPNIR_TOKEN` (bearer for the gateway's authed root-read endpoint).
Case-registry: `PORT=4005`, `DATA_DIR=/data`, `GLEIPNIR_INTERNAL_TOKEN`, `LOG_LEVEL`.
Evidence-store: `PORT=4006`, `DATA_DIR=/data`, `GLEIPNIR_INTERNAL_TOKEN`,
`MAX_UPLOAD_BYTES=26214400`, `LOG_LEVEL`.

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
  `/var/hyperledger/production/orderer`; `receipt-data` → `/data`;
  library (M16): `gateway-auth-data` → `/data/auth` (gateway),
  `case-registry-data` → `/data` (case-registry), `evidence-blob-data` → `/data`
  (evidence-store).
  (Runtime `docker volume` names carry the compose project prefix, e.g.
  `gleipnir_peer0org1-ledger`; measurement tooling probes paths inside containers, so
  the prefix does not affect it.)
- Node service images: `node:20.19-alpine` base — except case-registry, which is
  `node:20.19-slim` (glibc for better-sqlite3 prebuilds; §12 item 7); engines
  field pinned.

## 9. Variant routing matrix (gateway `variantRouter`)

| Variant | write path | root path | verify path |
|---|---|---|---|
| standard | `submit` on `coc-main` | — | — |
| anchoring | `POST batcher /events` | batcher → gateway `/internal/anchor-root` → `CommitAnchorRoot` on `coc-main` | verification ← gateway `/internal/anchor-root/...` |
| parallel | `submit` on `case-<id>` (from request `caseId`) | — | — |
| parallel-anchored | `POST batcher /events` (per-case queues, size K) | batcher → anchor-client `POST /roots` → `CommitAnchorRoot` on `anchor-main` | verification ← anchor-client `GET /roots/...` |

Scope note (deliberate default): on the **anchoring** root path the batcher sends
`meta:{scopeId,leafCount}` with **no `caseId` key**, so the chaincode's
`meta.caseId || "shared"` default selects the `shared` scope; receipts and the
verification reader use the same literal, so the round-trip is consistent by
construction. On the **parallel-anchored** path the anchor-client injects `caseId`
into metaJSON last, making it authoritative. Per-case writes (direct **and** batched)
require a valid `case-NNN` caseId at the gateway — a missing caseId is a 400, never a
silent fall-through to `shared`.

## 10. Benchmark & sweep config

- Single source of truth: **`benchmark/sweeps.yaml`**:

```yaml
anchoring_batch_N: [10, 50, 100, 250]
parallel_anchored_batch_K: [5, 10, 25, 50]
channel_counts: [1, 2, 5]        # 10 deliberately cut — single host
offered_load_tps: [25, 50, 100]  # conjecture until measured; tune per host
repetitions: 3                   # N-runs loop for mean ± spread
regimes:
  smoke:  { cases: 10, logs_per_case_min: 10, logs_per_case_max: 25 }
  steady: { min_events_per_channel: 1000 }
```

- Caliper workspace `benchmark/`, CLI pinned `@hyperledger/caliper-cli@0.6.0`; the exact
  verified `caliper bind` string is recorded in `benchmark/README.md`.
- Workloads (same four modules, all variants): `workload/createEvidence.js`,
  `transferCustody.js`, `accessLog.js`, `verify.js`. Standard/Parallel drive Fabric via
  the peer-gateway connector; Anchoring variants drive the gateway REST enqueue path via
  the custom connector in `benchmark/connectors/rest/`, and `verify.js` drives the
  verification service.
- **Every round config is generated** from `sweeps.yaml` by
  `benchmark/generate-rounds.js` (`npm run gen:rounds`) — steady standard/anchoring,
  per-channel-count `steady-parallel{,-anchored}-c{1,2,5}.yaml`, `steady-verify*.yaml`,
  and the `smoke-<variant>.yaml` configs derived from `regimes.smoke`. Multi-channel
  cells use a `channels: C` round argument: the workloads spread transactions
  round-robin across `case-001..case-00C` in ONE Caliper round, so the reported round
  throughput is the **aggregate across channels**; per-channel rate is uniform by
  construction and derived by collect.py as aggregate/C. `networks/parallel-c{C}.yaml`
  (also generated) list the C channels for fabric mode.
- Results land in `benchmark/results/<runId>/` (gitignored):
  `manifest.json`, `report.html`, `caliper.log` (the tee'd stdout collect.py parses —
  Caliper's own `report.json` is not produced; decision recorded here),
  `checkpoints.jsonl`. RQ2 verification runs land beside their write run as
  `<runId>-verify/`.
- **Run manifest** schema — seeded by sweep.py before Caliper runs: `{runId, startedAt,
  variant, regime: "smoke"|"steady", phase: "write"|"verify",
  cell:{N,K,channels,offeredLoadTps,repetition}, caliper:{binding,version,connector},
  notes}`; merged by collect.py after the run: `{collectedAt, gitCommit,
  configShas:{<file>:<git blob sha1>}, rounds[], failureClasses, throughputPolicy,
  checkpoints[], storage{...bytesPerEventBlockstore},
  payloadCompressionVsBaseline?}` — configShas covers
  `network/configtx/configtx.yaml`, `network/core.yaml`, `network/orderer.yaml`, all
  three compose files. Smoke artifacts are labelled `smoke` and never mixed with
  steady-state data (separate `results/smoke-*` runIds).
- Throughput is reported **successful-only** (recomputed from the Caliper round table:
  `reported × Succ/(Succ+Fail)`), stated in `benchmark/README.md`. Storage compression
  is reported as the reduction in on-chain log-payload **bytes per event** vs a
  Standard baseline run (`collect.py --baseline`), never as 1/N of total ledger size.

## 11. Orchestration entry points

```
orchestration/up.sh --variant <v> [--channels <n>] [--skip-crypto]  # enroll → compose up → channels → ccaas → commit
orchestration/down.sh [--wipe]                       # teardown; --wipe removes named volumes
orchestration/provision-channel.sh <caseId>          # genesis → osnadmin join(201) → peer join → commit cc → emit benchmark/networks/<caseId>.yaml
orchestration/teardown-channel.sh <caseId>
orchestration/smoke-standard.sh                      # REST-path functional gate: create → transfer → access×2 → audit(==4) → remove → transfer-fails
orchestration/smoke-library.sh                       # library gate (standard variant): login/roles → case+participant → multipart ingest → categorize → search → view/download/export auto-log asserts → authz negatives → trail==4
orchestration/checkpoint.py <runId> [--label t0]     # du -sb probes via docker exec, appends checkpoints.jsonl
orchestration/collect.py <runId> [--baseline <id>]   # parse caliper.log round table (after the last "All test results" marker) → manifest metrics + storage deltas
orchestration/sweep.py --variant <v> [--regime steady|smoke]  # full N/K/channel × repetitions loop (+ RQ2 verify runs per anchoring cell)
```

Scripts are bash (target: Ubuntu 22.04 / WSL2) + Python 3.10+ (deps: `pyyaml` only,
`orchestration/requirements.txt`). `du` probes: block store
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
   reaches the chain. Case-registry runs on `node:20.19-slim` (glibc, better-sqlite3
   prebuilds) as a documented deviation from the alpine convention. User identity in
   case payloads is the immutable username; users are deactivated, never deleted, so
   on-chain actors keep resolving. The evidence-store's blobs are immutable
   (exclusive-create), and the receipt store remains deliberately un-hardened — the
   library adds no integrity guarantees the design is supposed to measure.

Anything else that seems to require deviating from ARCHITECTURE.md or CLAUDE.md: STOP
and ask the authors (per CLAUDE.md ground rule 2).
