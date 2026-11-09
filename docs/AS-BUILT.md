# GLEIPNIR — As-Built Architecture

**Status:** describes the system as implemented and live-verified at commit
`8bb4c4e` (2026-07-10), **updated 2026-07-16 for the M12–M16 evidence
library** (gateway auth & roles, case-registry, evidence-store, multi-page
frontend) and **2026-07-17 for M17–M24** (User wire field `displayName` →
`name`; 3-tier RBAC `admin`/`lead`/`investigator` with lead-owned cases and
the admin blob-content restriction; per-case evidence categories + off-chain
forensic ingest metadata; examiner notes/flags/activity feed; the in-repo UI
kit + modal admin pages; the 4-step ingest wizard with client-side ni-URI
verification; the tabbed case/evidence detail pages; the per-case CoC report
(CSV + print) and the lead dashboard — CONTRACTS §12-8/§12-9). **Further
updated 2026-08-03** to fill in the M25/M25b library additions (team-roster
picker, in-place case-role change, persistent case activity feed) that had
landed in code and CONTRACTS.md but not yet in this document's route table
and frontend catalogue, and to add §9 covering the `owasp-top10-review`
branch's web-app-tier security hardening (six fixes). **Updated 2026-09-22 for
M26**, the experimental redesign requested in the supervisor's review
(2026-09-22; decision record docs/CONTRACTS.md §12-10..17):
`RemoveEvidence` → `DisposeEvidence`; one batch-size grid (`BATCH_SIZE`/`BATCH_FLUSH_MS`); receipts carry the event copy and the
receipt store indexes them per evidence, so the anchored variants read their
trail off-chain; the benchmark became a seeded trace-replay harness with
per-transaction capture; `sweep.py`/`generate-rounds.js` were replaced by
`rounds.py` + `experiment.py` (E0/ramp/E1/E2/E3a/E3b/ops) with a ledger-only
reset per run; and audit reconstruction time, anchoring delay, CPU/memory,
failure classes and p95 joined the metrics. **Updated 2026-09-26 for the
simplification refactor** (docs/CONTRACTS.md §12-20):
- generated Caliper configs are no longer committed, and `rounds.py --static`, `teardown-channel.sh` and
  `case-template.yaml` are gone;
- `BATCH_N`/`BATCH_K`, `--fresh-network` and `SESSION_IDLE_TTL_SECONDS` are removed;
- the evidence-store `/meta` and `/verify` routes and the case-registry single-row reads are removed.

**Updated 2026-11-06 for M28**, the true 2×2 redesign that followed the
supervisor's review of the paper (§12; decision record docs/CONTRACTS.md
§12-24): Parallel-Anchored commits each case's
Merkle roots to that case's own channel through the gateway, and the anchor
channel, the anchor org and the anchor-client are gone (campaigns 1–5 ran the
earlier design, which stays reproducible at commit `573017b`); batch records,
tx-log lines and the manifest carry what finalization latency needs; the
endorsement policy and an idle batch timer are run settings; E3a climbs to
saturation, and E3c and the sensitivity cells are new. M28 is unit-tested; its
live checks are pending (§12).

This document is descriptive, not
normative; the paper-facing procedure lives in `docs/methodology/experiments.md`.

| Document | Role |
|---|---|
| `docs/ARCHITECTURE.md` | The binding **build plan** (written before implementation; milestones, module specs) |
| `docs/CONTRACTS.md` | The binding **interface contracts** (§1–§12; cited below rather than restated) |
| **`docs/AS-BUILT.md`** (this file) | The system **as implemented**: modules, dependencies, ports, data flows |
| `docs/methodology/experiments.md` | The **paper-facing methodology** (M26): 2×2 frame, variable table, E0–E3 + ops procedures, level-selection rules, run budget, flowcharts, threats to validity, defaults to confirm with the supervisor |
| `docs/research/` | Version-pinned research notes on Fabric 2.5, Caliper 0.6.0 and the fabric-samples patterns reused |
| `docs/results/` | Generated per-experiment tables and charts (`report.py` / `present.py` output) |

GLEIPNIR benchmarks four blockchain chain-of-custody (B-CoC) architectural
variants on a single Hyperledger Fabric 2.5 LTS substrate, measured with
Hyperledger Caliper, on one Docker host. The evidence-record schema and
evidence-card UI idiom are conceptually inspired by lockb0x; the build
substrate is Fabric 2.5 LTS exclusively.

---

## 1. System overview

```mermaid
flowchart LR
    subgraph host["Host tooling (Ubuntu 22.04 / WSL2)"]
        EXP["orchestration/experiment.py<br/>(rounds.py, collect.py, report.py)"]
        CALIPER["Caliper 0.6.0<br/>(benchmark/ workspace, trace replay)"]
        AUDIT["benchmark/audit/reconstruct.js"]
        UP["orchestration/up.sh / reset-network.sh"]
    end

    subgraph offchain["Off-chain services (Docker, gleipnir-net)"]
        FE["frontend :8081<br/>(nginx + React SPA)"]
        GW["gateway :3000<br/>(BFF, fabric-gateway,<br/>auth/users/sessions)"]
        MB["merkle-batcher :4001"]
        RS["receipt-store :4002"]
        VS["verification :4004"]
        CR["case-registry :4005<br/>(SQLite: cases + evidence index)"]
        ES["evidence-store :4006<br/>(immutable blobs + ni-URI)"]
    end

    subgraph fabric["Fabric 2.5.15 (Docker, gleipnir-net)"]
        ORD["orderer0/1/2<br/>(etcdraft)"]
        P1["peer0-org1 :7051"]
        P2["peer0-org2 :9051"]
        CC["ccaas-evidence :9999"]
    end

    FE -->|"/api/v1 (proxied)"| GW
    CALIPER -->|"REST connector"| GW
    CALIPER -->|"fabric connector (grpcs)"| P1
    EXP --> CALIPER
    EXP --> AUDIT
    AUDIT -->|"/audit?proofs=1, /anchor-roots"| GW
    GW -->|"coc-main / case-NNN<br/>(events and roots)"| P1
    GW --> MB
    GW --> VS
    GW -->|"off-chain trail (anchored reads)"| RS
    GW -->|"X-Gleipnir-Internal-Token"| CR
    GW -->|"X-Gleipnir-Internal-Token"| ES
    MB --> RS
    MB -->|"roots (both anchored variants)"| GW
    VS --> RS
    VS -->|"root reads"| GW
    P1 --- ORD
    P2 --- ORD
    P1 -.-|"cross-org gossip (anchor peers)"| P2
    P1 -.->|dials| CC
    P2 -.->|dials| CC
```

**The controlled experiment.** The four variants differ **only in how audit
event records are written to the ledger**. The chaincode, the gateway API,
and the Caliper workload modules are byte-identical across all four; the
variant is selected by one environment value (`VARIANT`) that changes the
gateway's write routing (CONTRACTS §9). This invariant is the basis of the
thesis's like-for-like comparison. Evidence **binaries** are off-chain in
every variant — what varies is whether audit *event records* go directly
on-chain or are Merkle-anchored.

## 2. Pinned stack

| Component | Version | Where pinned |
|---|---|---|
| Hyperledger Fabric (peer, orderer, tools) | **2.5.15** | `network/compose/.env` `FABRIC_TAG`/`TOOLS_TAG` |
| Hyperledger Fabric CA | **1.5.19** | `.env` `CA_TAG` |
| Hyperledger Caliper CLI | **0.6.0** (exact) | `benchmark/package.json` |
| Caliper SUT binding | `fabric:fabric-gateway` → `@hyperledger/fabric-gateway ^1.5.0`, `@grpc/grpc-js ^1.10.3` | `benchmark/package.json` + lockfile (recorded in `benchmark/README.md`) |
| Node.js (services runtime) | **20.19** | `node:20.19-alpine` in six service Dockerfiles (seven until M28 removed the anchor-client); `node:20.19-slim` for case-registry (better-sqlite3 v12 has no Node-20 prebuilt → from-source build on glibc — CONTRACTS §12-7) |
| Gateway extras (M13c) | `multer ^2` (multipart ingest) | `gateway/package.json` |
| Case-registry datastore | `better-sqlite3 ^12.4.1` | `services/case-registry/package.json` |
| Go (chaincode) | **1.25.5** toolchain (`go 1.25` language) | `golang:1.25.5` in `chaincode/evidence/Dockerfile`; `go.mod` |
| Client SDK (gateway; also the anchor-client until M28) | `@hyperledger/fabric-gateway` **1.11.0** (exact), `@grpc/grpc-js ^1.14.0` | `gateway/package.json` |
| World state | **GoLevelDB** (CouchDB excluded by design) | `network/core.yaml` |
| Frontend | React ^18.3.1, react-router-dom ^6, Vite ^5.4.11, TypeScript ~5.6.3 | `frontend/package.json` |
| Benchmark app | Python 3.11 + tkinter (Tk 8.6), PyYAML; drives `experiment.py` inside WSL | `orchestration/benchapp.pyw`, `orchestration/benchcore.py` |
| Orchestration | Python 3.10+, PyYAML ≥6.0 | `orchestration/requirements.txt` |

Two `@hyperledger/fabric-gateway` versions coexist on purpose: the
**gateway** pins `1.11.0` in its own image (so did the anchor-client until
M28), while the **Caliper workspace** binds `^1.5.0` — the version its 0.6.0 fabric
connector was released against — in `benchmark/node_modules`. They never share
a runtime.

## 3. The four variants

Participation matrix (✔ = the container runs in that variant; compose profiles
per CONTRACTS §8):

| Container | standard | anchoring | parallel | parallel-anchored |
|---|:-:|:-:|:-:|:-:|
| orderers ×3, peer0-org1/org2, ccaas-evidence, cli, gateway, frontend, ca-org1/org2/orderer | ✔ | ✔ | ✔ | ✔ |
| case-registry, evidence-store (evidence library, M13) | ✔ | ✔ | ✔ | ✔ |
| merkle-batcher, receipt-store, verification | | ✔ | | ✔ |

Since M28 the `anchoring` and `parallel-anchored` profiles start the same three
services. Until then (the earlier design, campaigns 1–5) parallel-anchored also
ran `peer0-anchor`, `ca-anchor`, `ccaas-evidence-anchor` and `anchor-client`.

The library **UI flows** target Standard + Anchoring only (CONTRACTS §12-7);
the two library containers run in the base profile everywhere so the compose
topology stays variant-invariant.

Channels: `coc-main` (standard, anchoring), `case-001…case-00N` (parallel
variants, one per case; on parallel-anchored each holds its case's Merkle
roots since M28). The earlier design's `anchor-main` (the **anchor channel**,
parallel-anchored only, campaigns 1–5) no longer exists.

### 3.1 Standard — baseline

One shared channel; one transaction per audit event.

```mermaid
sequenceDiagram
    participant C as Client (Caliper / frontend)
    participant G as gateway
    participant F as Fabric coc-main
    C->>G: POST /api/v1/evidence (etc.)
    G->>F: submit CreateEvidence / TransferCustody / AccessLog / DisposeEvidence
    F-->>G: committed
    G-->>C: 2xx
```

### 3.2 Anchoring — off-chain Merkle batching to the shared channel

Events are batched off-chain (batch size `BATCH_SIZE`, one grid for both
anchored variants — M26); only the SHA-256 Merkle root plus minimal metadata is
committed on-chain. Each event keeps an off-chain receipt: leaf hash +
O(log₂N) sibling path **plus the CoC event copy** (`evidenceId`, `event`), and
the receipt store indexes receipts per evidence — that index is the anchored
variants' audit trail (there is no per-event record on the channel). The
client's "committed" write is the gateway's `202` enqueue; the ledger commit
lag is the **anchoring delay** the batcher records per batch
(`openedAt`/`closedAt`/`committedAt`, `delayMs`). Since M28 collect.py also
times each accepted event from its submission to its batch's root commit —
the **finalization latency** (§6).

```mermaid
sequenceDiagram
    participant C as Client
    participant G as gateway
    participant B as merkle-batcher
    participant R as receipt-store
    participant F as Fabric coc-main
    C->>G: POST /api/v1/evidence
    G->>B: POST /events
    B-->>G: 202 {batchId, leafIndex}
    Note over B: at batch boundary (BATCH_SIZE events,<br/>BATCH_IDLE_MS idle or BATCH_FLUSH_MS age timer,<br/>or POST /flush): build SHA-256 Merkle tree
    B->>R: PUT /receipts/:eventId (per leaf, incl. event copy) + idx/<evidenceId>
    B->>G: POST /internal/anchor-root (Bearer token)
    G->>F: submit CommitAnchorRoot(batchId, root, meta {scopeId: shared, leafCount})
    Note over B: committedAt = submit returned → delayMs per batch
    C->>G: GET /api/v1/evidence/:id/audit[?proofs=1]
    G->>R: GET /receipts?evidenceId=:id
    R-->>G: receipts in leaf order → events (+ proof)
```

### 3.3 Parallel — one channel per case

Direct per-event commits, but each case gets a dedicated channel provisioned
at runtime (`osnadmin channel join` + install/approve/commit per channel).

```mermaid
sequenceDiagram
    participant C as Client
    participant G as gateway
    participant F as Fabric case-NNN
    C->>G: POST /api/v1/evidence {caseId}
    G->>F: submit on channel case-NNN (selected by caseId)
    F-->>G: committed
```

### 3.4 Parallel-Anchored — per-case batching, each root on its own case channel

Per-case channels + per-case Merkle batching (the same `BATCH_SIZE` grid as
Anchoring — the paper's separate K grid was unified at M26, CONTRACTS §12-13).
Since M28 each per-case root goes, like Anchoring's, through the gateway's
bearer-authed `POST /internal/anchor-root`, with meta `{scopeId, leafCount,
caseId}` (`caseId = scopeId = case-NNN`); the gateway commits it with
`CommitAnchorRoot` on channel `case-NNN` (`variantRouter.rootChannel`), and the
chaincode keys the root on that caseId. The case channels therefore carry the
variant's data, and every ledger write uses one chaincode deployment and one
endorsement policy. Reads (`/evidence/:id`, `/audit`) come from the
receipt-store index exactly as in §3.2, with the `case-NNN` caseId still
validated; `GET /anchor-roots/case-NNN/…` evaluates `ReadAnchorRoot` on that
case's channel.

Until M28 (campaigns 1–5, commit `573017b`) an off-chain **anchor-client**
under the fixed `anchorclient` identity (`AnchorClientMSP`, with its own peer)
committed every per-case root to the dedicated anchor channel `anchor-main`,
because chaincode in one channel cannot write to another. The case channels
carried nothing, so the 2×2 design was not a true factorial (§12).

```mermaid
sequenceDiagram
    participant C as Client
    participant G as gateway
    participant B as merkle-batcher
    participant R as receipt-store
    participant F as Fabric case-NNN
    C->>G: POST /api/v1/evidence {caseId}
    G->>B: POST /events (per-case queue, size BATCH_SIZE)
    B-->>G: 202 {batchId, leafIndex}
    B->>R: PUT /receipts/:eventId (per leaf, incl. event copy)
    B->>G: POST /internal/anchor-root {batchId, root, meta.caseId}
    G->>F: submit CommitAnchorRoot on case-NNN (channel = meta.caseId)
```

### 3.5 Verification and audit-reconstruction paths (both anchoring variants)

Verification/audit latency is a first-class measured metric (thesis RQ2):
fetch receipt → recompute the leaf from the event copy and fold the Merkle
branch → compare against the anchored root. The response says which leaf
source was used (`leafSource: "event"` since M26; `"receipt"` only for
legacy receipts without an event copy).

```mermaid
sequenceDiagram
    participant C as Client
    participant G as gateway
    participant V as verification
    participant R as receipt-store
    participant X as gateway /internal/anchor-root
    C->>G: GET /api/v1/evidence/:id/verify?eventId=…
    G->>V: GET /verify/:eventId
    V->>R: GET /receipts/:eventId (fetchMs)
    Note over V: leaf = SHA-256(canonical event copy);<br/>fold sibling path (recomputeMs)
    V->>X: GET anchor root for (scopeId, batchId)
    Note over V: compare roots (compareRootMs)
    V-->>C: {ok, latencyMs, leafSource, steps}
```

**Audit reconstruction time** (M26, all four variants) is measured host-side
by `benchmark/audit/reconstruct.js` per case: fetch every evidence trail of
the case through the gateway, and on the anchored variants recompute every
event's leaf + branch (`?proofs=1`) and read each distinct root once via
`GET /api/v1/anchor-roots/:scopeId/:batchId` (cached per scope+batch within
the case: the cache is reset for every case, so each case pays its own root
reads). One untimed pass over case 1's first evidence item (trail + root
reads, results discarded) precedes the timed cases, so case 1 is not timed
cold (CONTRACTS §12-23). On
Standard/Parallel the trail is on-chain and there is no Merkle step
(`method: on-chain-trail` vs `merkle-branch`). Output → `audit.json` per run.

```mermaid
sequenceDiagram
    participant A as reconstruct.js (host)
    participant G as gateway
    participant R as receipt-store
    participant X as coc-main or case-NNN (ReadAnchorRoot)
    loop each evidence of the case
        A->>G: GET /api/v1/evidence/:id/audit?proofs=1[&caseId=]
        G->>R: GET /receipts?evidenceId=:id
        G-->>A: events + proof {leafHash, siblingPath, batchId, leafIndex, rootRef}
    end
    loop each distinct (scopeId, batchId)
        A->>G: GET /api/v1/anchor-roots/:scopeId/:batchId
        G->>X: ReadAnchorRoot
    end
    Note over A: recompute leaf → fold → compare; ms per case
```

## 4. Module catalogue

### 4.1 `chaincode/evidence` — Go smart contract (ccaas)

- **Responsibility:** deterministically persist CoC audit records and Merkle
  roots to a channel's world state; nothing else. Identical binary serves all
  channels and variants.
- **Interface** (CONTRACTS §3) — the four CoC operations, each annotated in
  code with its ISO/IEC 27037 clause: `CreateEvidence(evidenceId,
  codexEntryJSON)`, `TransferCustody(evidenceId, newCustodian, reason)`,
  `AccessLog(evidenceId, actor, action)`, `DisposeEvidence(evidenceId,
  reason)` (M26 rename of `RemoveEvidence`: a terminal status transition to
  `DISPOSED`, op tag `DISPOSE`, nothing deleted; `CC_VERSION` stays `1.0` —
  ccaas serves the rebuilt binary under the same package id); the anchoring
  pair `CommitAnchorRoot(batchId, merkleRoot, metaJSON)` /
  `ReadAnchorRoot(scopeId, batchId)` (scope = `meta.caseId`, default
  `shared`; write-once per `(scope, batchId)`; `leafCount` recorded — since
  M28 both anchored variants commit on app channels: `coc-main` for
  Anchoring's `shared` scope, the case's own channel for a Parallel-Anchored
  case; the chaincode itself is unchanged); and reads `ReadEvidence(evidenceId)`,
  `GetAuditTrail(evidenceId)`.
- **Record schema:** Codex-Entry-inspired (see ARCHITECTURE §4). Audit events
  are written under composite sub-keys `(evidenceId, monotonicCounter)` — one
  key per event, never rewrites of a shared record key — so concurrent
  `AccessLog` writes cannot MVCC-conflict **structurally** (no client retry
  loops exist anywhere in the system).
- **Deployment:** Chaincode-as-a-Service. The peer never compiles the
  contract; it dials a standalone gRPC server (`EXPOSE 9999`) built from
  `golang:1.25.5` into `gcr.io/distroless/static-debian12:nonroot`. ccaas is
  used *because* of the Go 1.25.5 pin — the peer's in-image `fabric-ccenv`
  toolchain is a different Go version.
- **Direct Go dependencies** (`go.mod`): `fabric-chaincode-go/v2
  v2.3.1-0.20260319210430-56968fdc7833`, `fabric-contract-api-go/v2 v2.2.1`,
  `fabric-protos-go-apiv2 v0.3.7`, `google.golang.org/protobuf v1.36.11`.
- **Does not:** store binaries, hash payloads (gateway computes
  `integrity_proof`), reach other channels, or use rich queries (GoLevelDB:
  key-value + partial-composite-key scans only).

### 4.2 `gateway/` — API gateway (BFF), port 3000

- **Responsibility:** holds the only fabric-gateway sessions to the
  application channels (since M28 no other service holds one: the app
  channels carry every ledger write, the anchored variants' roots included);
  computes evidence `integrity_proof` ni-URIs;
  encapsulates all variant routing (CONTRACTS §9); and (M12) authenticates
  two kinds of principal — the unchanged static `GLEIPNIR_TOKEN` service
  path, and user sessions with server-enforced roles. The frontend and the
  Caliper REST connector talk only to this service.
- **Routes** (`src/app.js`; auth per CONTRACTS §6 — service token or session,
  except `/healthz` and `/auth/login`):

| Route | Behavior |
|---|---|
| `POST /api/v1/auth/login`, `POST /auth/logout`, `GET /auth/me` | session lifecycle (M12); users in `AUTH_DATA_DIR/users.json`, scrypt hashes |
| `GET/POST /api/v1/admin/users`, `PATCH /admin/users/:id`, `POST …/reset-password` | user management — admin session only |
| `GET /api/v1/users/directory` | admin-or-lead session (M25); roster picker for team assignment — leads never see admin accounts |
| `POST /api/v1/evidence` | `CreateEvidence` submit, or batcher enqueue (anchoring variants); multipart (M13c) → evidence-store blob + head with store proof + evidence-index row (library caseId never on-chain) |
| `POST /api/v1/evidence/:id/transfer` | `TransferCustody` or enqueue; user sessions: case-role gated |
| `POST /api/v1/evidence/:id/access` | `AccessLog` or enqueue; user sessions: case-role gated |
| `DELETE /api/v1/evidence/:id` | `DisposeEvidence` or enqueue (op `DISPOSE`; index status `DISPOSED`); M25: needs case-lead role (or the `uploader` pseudo-role for one's own uncategorized evidence); best-effort index status sync |
| `GET /api/v1/evidence/:id` | `ReadEvidence` (evaluate) — on the anchored variants (M26) the head is folded from the off-chain trail (`offChain: true`; 404 when no events); user sessions: authz + synchronous auto-`AccessLog(view)` |
| `GET /api/v1/anchor-roots/:scopeId/:batchId` | M26: the anchor-root record for audit reconstruction; any authenticated principal. Since M28 one handler with the internal read below: `ReadAnchorRoot` on `rootChannel(variant, scopeId)` — anchoring → `coc-main`; parallel-anchored → the case's own channel (`scopeId` must be `case-NNN`, else 400); standard/parallel → 404 `no anchor roots in this variant`; a root the chaincode does not find → 404 (until M28 parallel-anchored proxied the anchor-client's `GET /roots/…`) |
| `GET /api/v1/evidence/:id/download` | stream from evidence-store; authz-gated with `{content:true}` — **admin bypass does not apply** (M18/§12-8: admins lose blob-content access off their own cases); auto-`AccessLog(download)` |
| `GET /api/v1/evidence/:id/export` | `{record, auditTrail}` bundle; auto-`AccessLog(export)` |
| `GET /api/v1/evidence/:id/audit[?proofs=1]` | `GetAuditTrail` (evaluate) — on the anchored variants (M26) the CoC events from the receipt-store index in receipt order, `?proofs=1` attaching each event's `proof {leafHash, siblingPath, batchId, leafIndex, rootRef}` verbatim (the gateway verifies nothing); authz-gated, never auto-logged |
| `GET /api/v1/evidence/:id/verify?eventId=` | proxy → verification `/verify/:eventId`; not variant-restricted at the gateway itself — on Standard the call 502s because `verification:4004` only ships with the anchoring variants (not SSRF; assessed under OWASP A10 in the §9 review); the SPA never calls it under Standard |
| `PATCH /api/v1/evidence/:id/details` | M19 forensic metadata (label/seizedAt/acquisitionLocation/handedOverBy); write-gated (contributor+), never auto-logged |
| `GET/POST /api/v1/evidence/:id/notes` | M20 examiner notes — append-only, immutable-by-API; read/write case-role gated |
| `PUT /api/v1/evidence/:id/flag` | M20 strict-enum triage flag (`HIGH_PRIORITY`/`PROCESSED`/`NEEDS_LEAD_REVIEW`); write-gated |
| `GET /api/v1/evidence/search`, `GET /api/v1/cases/search` | case-registry search, participant-scoped unless admin |
| `POST/GET/PATCH /api/v1/cases[/:id]` | case-registry proxy; **create** = admin-or-lead (lead auto-added as case lead); **update** = admin-or-that-case's-lead (`ensureCaseLead`) |
| `POST/PATCH/DELETE /api/v1/cases/:id/participants[/:userId]` | roster grant/revoke; PATCH (M25) is in-place role change; admin-or-case-lead; removing/demoting the last lead is 409 for leads (admin may) |
| `POST/DELETE /api/v1/cases/:id/evidence[/:evidenceId]` | categorize/uncategorize; admin-or-case-lead |
| `GET/POST/PATCH/DELETE /api/v1/cases/:id/categories[/:categoryId]` | M19 per-case evidence taxonomy; read = case visibility, manage = admin-or-case-lead |
| `GET /api/v1/cases/:id/coc-report?format=csv\|json` | M24 chain-of-custody report — assembles every exhibit's trail; one synchronous `AccessLog('coc-report')` per exhibit for user sessions only (never for the service token) |
| `GET /api/v1/cases/:id/activity` | M20/M25b persistent `case_audit_log` feed (roster + categorize + note + flag events); case-visibility, never auto-logged |
| `POST /internal/anchor-root` | submit `CommitAnchorRoot` — the root sink of both anchored variants since M28: on `coc-main` (anchoring; meta without `caseId` → scope `shared`) or on channel `meta.caseId` (parallel-anchored; `case-NNN` required, else 400); 404 on standard/parallel; `requireService` — no user session, admin included, may call this |
| `GET /internal/anchor-root/:scopeId/:batchId` | evaluate `ReadAnchorRoot` on the channel that holds the scope (the same handler as `/api/v1/anchor-roots`); same service-only gate; the verification service's root read on both anchored variants |
| `GET /healthz` | `{ok:true, variant}` (unauthenticated) |

Every response carries gateway-origin security headers (§9) regardless
of auth outcome; a malformed request body gets a generic JSON error rather
than a stack trace (§9); sessions die at the earlier of an 8 h absolute
TTL or a 30 min sliding idle timeout (§9).

- **Dependencies:** `@grpc/grpc-js ^1.14.0`, `@hyperledger/fabric-gateway
  1.11.0`, `express ^4.21.2`, `multer ^2` (M13c). M26 adds the injected dep
  `receipts` (`makeReceiptsClient` in `src/serviceClients.js`, `listByEvidence` against
  `RECEIPT_STORE_URL`); its second M26 dep, `anchorClientUrl`
  (`ANCHOR_CLIENT_URL`), was removed at M28.
- **Actor attribution (M12):** under a user session the audit actor is always
  the authenticated username; the service-token path keeps client-supplied
  actors (Caliper realism). Auto-AccessLog never fires for the service token.
- **Does not:** persist binaries itself (multipart bytes go to
  evidence-store; the JSON path's `payloadBase64` is hashed then discarded,
  unchanged), build or verify Merkle trees or branches (`?proofs=1` and
  `/anchor-roots` only hand the witness and the root to the caller), write
  the library caseId on-chain, or execute or record
  benchmark runs (the M12 run-request store was removed in M27; the benchmark
  is driven by `orchestration/benchapp.pyw` → `experiment.py`).

### 4.3 `services/merkle-batcher` — port 4001

- **Responsibility:** accumulate events into per-scope batches (scope =
  `shared` for anchoring, `caseId` for parallel-anchored); at a batch
  boundary build a SHA-256 Merkle tree, persist one receipt per leaf, submit
  the single root for commit — and (M26) record the timestamps that define
  the **anchoring delay**. Batch size from env `BATCH_SIZE` (one grid for
  both anchored variants; default 100); boundary = size, or (M28) the
  `BATCH_IDLE_MS` idle timer (that long after the batch's last event,
  refreshed per event, no cap), or the `BATCH_FLUSH_MS` age timer (that long
  after its first event), or `POST /flush`. Both timers 0 (off) is size-only
  batching, the experiment constant; only the sensitivity cell `idle-5s`
  sets the idle timer. Batch ids are
  namespaced by `BATCH_EPOCH` (experiment.py sets `<runId>-<unix>` per run)
  so re-runs against a persistent ledger never reuse a committed
  `(scope, batchId)` key.
- **Routes:** `POST /events` → `202 {batchId, leafIndex}`; `POST /flush`
  (forces boundaries — run-end partial-batch policy; used untimed by the
  verify workload; returns the `/status` body after settling); `GET /status`
  → `{variant, batchSize, flushTimeoutMs, idleTimeoutMs, queues,
  counters:{openScopes, closedBatches, committed, failed, forced,
  receiptDegraded, degraded}, degraded, batches[]}` (`idleTimeoutMs` since
  M28); `GET /status?events=1` (M28) adds each batch's `enqueuedAtMs` —
  experiment.py reads it once, after the run-end flush, into
  `anchoring.json`, and the default `/status` stays compact for polling;
  `GET /healthz`.
- **Batch record** (per closed batch, process lifetime): `openedAt` (first
  enqueue), `closedAt` (boundary), `committedAt` (the root submission
  returned — the gateway awaits the Fabric commit, so the delay
  includes the submit round-trip; null if it failed), `closeReason` (M28:
  `size` | `idle` | `timeout` | `flush`), `forced` (= `closeReason` is not
  `size`), `delayMs {min, mean, max}` over the batch's per-event enqueue
  timestamps, and (M28) `enqueuedAtMs`, those timestamps in leaf order. One
  log line per committed batch repeats them (`closeReason` in place of
  `forced`). The receipt PUT carries
  `evidenceId` and `event` (the CoC event as enqueued) beside the witness;
  `leafHash` is unchanged.
- **Dependencies:** `express ^4.21.2` only.
- **Calls:** receipt-store `PUT /receipts/:eventId`; gateway
  `POST /internal/anchor-root` for both anchored variants (M28) — meta
  `{scopeId: "shared", leafCount}` on anchoring, `{scopeId, leafCount,
  caseId}` with `caseId = scopeId = case-NNN` on parallel-anchored, so that
  root lands on its case's channel. (Until M28 parallel-anchored posted to
  the anchor-client's `POST /roots`.)
- **Does not:** submit to the ledger itself, verify proofs, or observe the
  block commit independently of the submit round-trip.
- **Known limit (M28, stated, not fixed):** an open batch exists only in
  the process's memory. An accepted event (`202`) is not finalized until its
  batch's root commits; if the batcher dies first, the event leaves no
  receipt, no trail entry and no root anywhere (`orchestration/crash-test.sh`
  checks this, §12).

### 4.4 `services/receipt-store` — port 4002

- **Responsibility:** persist each event's off-chain witness
  `{leafHash, siblingPath[], batchId, leafIndex, rootRef}` **plus the CoC
  event copy** (`evidenceId`, `event` — M26) as one JSON file per `eventId`
  under the `receipt-data` named volume (`/data`), and keep a plain
  per-evidence index (`/data/idx/<evidenceId>.txt`, one eventId per line,
  first-PUT order) so the anchored variants' audit trail can be listed back.
- **Routes:** `PUT /receipts/:eventId` (indexes when the body carries a
  valid `evidenceId`; idempotent across the batcher's two PUTs),
  `GET /receipts/:eventId`, `GET /receipts?evidenceId=X` → JSON array of full
  receipts in index order (`[]` if none; 400 if missing/invalid),
  `GET /healthz`.
- **Dependencies:** `express ^4.21.2` only.
- **Un-hardened by design** (thesis-critical): no hash chains, no
  signatures, no replication — on the receipts **or** the index or the event
  copies. Its weaker-than-on-chain integrity guarantee is a *measured property
  of the anchoring design* — an availability exposure of the witness (index
  loss = empty trail listing), not an integrity exposure of the ledger (a
  tampered event copy fails root verification because verifiers recompute
  the leaf from it) — and a stated thesis caveat. Hardening it would destroy
  the property being measured.

### 4.5 `services/verification` — port 4004

- **Responsibility:** execute and time the RQ2 verification procedure:
  fetch receipt (`fetchMs`) → recompute the leaf from the receipt's `event`
  copy and fold the O(log₂N) branch (`recomputeMs`) → compare against the
  anchored root (`compareRootMs`).
- **Routes:** `GET /verify/:eventId` → `{ok, reason?, latencyMs, leafSource:
  "event"|"receipt", steps}` (M26: `"event"` = leaf recomputed inside
  `recomputeMs`; `"receipt"` = stored `leafHash`, legacy receipts only);
  `GET /healthz`. Distinguishes `root-mismatch` (tamper signal, 200
  `ok:false`) from `missing-receipt`/`missing-anchor-root` (404),
  `malformed-receipt` (422 — the hex-64 `leafHash` shape check still runs even
  when `event` is present), and upstream errors (502). With
  `VERIFY_METRICS_PATH` set (compose: `/verify-metrics/verify.jsonl` on the
  `verify-metrics` volume) each completed verify appends `{ts, eventId, ok,
  leafSource, fetchMs, recomputeMs, compareRootMs, latencyMs}` — a secondary
  trace; the manifest's verify numbers come from the `VERIFY` op in the
  Caliper tx-log.
- **Dependencies:** `express ^4.21.2` only. The Merkle recomputation is
  byte-identical to the batcher's construction (CONTRACTS §4).
- **Calls:** receipt-store `GET /receipts/:eventId`; gateway
  `GET /internal/anchor-root/:scopeId/:batchId` (service token) for the root
  on both anchored variants — since M28; before, parallel-anchored read the
  anchor-client's `GET /roots/…`.
- **Does not:** verify signatures or schema — deliberately excluded from the
  timed path to isolate Merkle-verification cost — or trust the stored leaf
  when an event copy is present.

### 4.6 `services/anchor-client` — port 4003 (removed at M28)

- **Removed at M28** (§12). Until then it was the only writer of the anchor
  channel: it submitted per-case roots via `CommitAnchorRoot` on
  `anchor-main` under the fixed `anchorclient` identity (`AnchorClientMSP`),
  because chaincode cannot write across channels. Parallel-anchored only;
  routes `POST /roots` → `201 {txId}`, `GET /roots/:caseId/:batchId`,
  `GET /healthz`; dependencies `@grpc/grpc-js ^1.14.0`,
  `@hyperledger/fabric-gateway 1.11.0` (a hand-rolled `node:http` router,
  ESM). Campaigns 1–5 ran with it (commit `573017b`). Since M28 the
  parallel-anchored roots go through the gateway to each case's own channel
  (§3.4, §4.3).

### 4.7 `services/case-registry` — port 4005 (evidence library, M13a)

- **Responsibility:** the OFF-CHAIN case layer — Case entity (name/status/
  participant roster) + the evidence search read-model (`evidence_index`) +
  the gateway's per-evidence authz pre-flight (`GET /internal/authz`).
  Case ids `CASE-<uuid>` are structurally disjoint from the Parallel channel
  key `case-NNN`; the library caseId never reaches the chain.
- **Routes:** cases CRUD + participants + categorize/uncategorize;
  evidence-index register/sync/search, with no single-row GET: rows and categories are read through search and
  `GET /cases/:caseId` (`visibleToUserId` scoping =
  participant cases + own uncategorized uploads); all behind
  `X-Gleipnir-Internal-Token` (internal-only, via gateway).
- **Datastore:** `better-sqlite3 ^12.4.1` at `DATA_DIR/case-registry.db`
  (volume `case-registry-data`); image `node:20.19-slim` — the documented
  deviation (no Node-20 prebuilt in v12 → from-source build on glibc;
  CONTRACTS §12-7).
- **Does not:** authenticate end users, store blobs, touch Fabric.
  `evidence_index` is a cache — the ledger stays authoritative for
  status/custodian.

### 4.8 `services/evidence-store` — port 4006 (evidence library, M13b)

- **Responsibility:** persist evidence BINARIES off-chain (the all-variant
  invariant) and compute the RFC 6920 ni-URI proof the ledger records;
  `niUri()` copied byte-identically from `gateway/src/ni.js`.
- **Routes:** `PUT/GET/DELETE /blobs/:evidenceId`; blobs are **immutable**
  (exclusive-create; second PUT → 409); `DELETE` exists solely for the
  gateway's ingest-failure rollback and requires the `x-gleipnir-rollback-token`
  header that the PUT returned. Internal-only via `X-Gleipnir-Internal-Token`.
- **Datastore:** filesystem — `DATA_DIR/<id>` blob + `<id>.meta.json` sidecar
  (volume `evidence-blob-data`). Dependencies: `express ^4.21.2` only.
- **Does not:** index or search (case-registry's job), mutate stored bytes,
  write on-chain.

### 4.9 `frontend/` — SPA behind nginx, port 8081

- **Responsibility (M14, extended through M25b):** the multi-page
  evidence-library app — login + role-aware nav (`auth/`), 3-tier RBAC
  (`admin`/`lead`/`investigator`, M18) layered on per-case roles
  (`viewer`/`contributor`/`lead`). Investigator pages: a 4-step ingest wizard
  (case+category / metadata with `ITEM-NNN` auto-suggest / file + local
  WebCrypto ni-URI hash with progress / review — M22, comparing the local
  hash against the server's `integrityProof`), my-cases, a tabbed case detail
  (Overview / Evidence / Activity — M21/M23), a tabbed evidence detail
  (Overview / Chain of custody via `AuditTrailTimeline` / Examiner notes —
  M20/M21/M23, with an auto-logged inline preview for image/video/audio/
  PDF/text added M25), and search. Lead-tier: `/lead/dashboard` (M24) — led
  cases, flagged evidence, merged team activity, roster add/remove. Admin
  pages: users (modal-driven, role badges — M21) and case administration
  (the operator dashboard was removed in M27 — CONTRACTS §12-19). The `Op`
  type is `CREATE | TRANSFER | ACCESS | DISPOSE` and the status `DISPOSED`
  (pills tolerate legacy `REMOVED` rows; `AuditTrailTimeline` marks
  `DISPOSE`). A
  print-optimized per-case CoC report (`/cases/:id/report`, M24) renders
  outside the normal app shell (browser print → PDF).
- **UI kit (M21):** in-repo primitives only — no external component library
  (`components/ui/`: Tabs, Stepper, Modal, Timeline, Badge) — styled on
  `styles.css` tokens, covered by the first frontend vitest tests.
- **Role gating is UX-only.** `RequireAuth`/`RequireRole` guard routes
  client-side for navigation convenience; every one of those rules is
  re-enforced server-side by the gateway and case-registry (§4.2, §4.7) — a
  hidden nav item is not a security control.
- **Network path:** a single `GatewayClient` (`src/api.ts`, owned by
  `AuthContext`) with base `/api/v1`; nginx proxies `location /api/` to
  `http://gateway:3000` and `try_files` keeps deep links refresh-safe. The
  frontend never contacts Fabric or the off-chain services directly.
- **Runtime dependencies:** `react ^18.3.1`, `react-dom ^18.3.1`,
  `react-router-dom ^6`; built with `vite ^5.4.11` /
  `typescript ~5.6.3` into a static bundle served by `nginx:alpine`.
- **Does not:** apply to the Parallel / Parallel-Anchored variants — the
  library UI targets Standard and Anchoring only; Parallel variants are
  exercised through the benchmark path (`orchestration/benchapp.pyw` /
  `experiment.py`).

## 5. Fabric network topology

**Organizations & MSPs:** `Org1MSP` + `Org2MSP` (application peers),
`OrdererMSP` (three orderers, etcdraft) — the same three orgs in every
variant since M28. The earlier design (campaigns 1–5) added `AnchorClientMSP`
(anchor org: endorsing peer + the fixed `anchorclient` identity;
parallel-anchored only), with its own *peer* because `anchor-main`'s
endorsement policy `AND('AnchorClientMSP.member')` required an endorser of
that MSP — a client identity alone cannot endorse.

**Container inventory** (project `gleipnir`, network `gleipnir-net`; pinned
images from `.env`):

| Container | Image / build | Host ports | Volume | Profile |
|---|---|---|---|---|
| orderer0/1/2.example.com | `fabric-orderer:2.5.15` | 7050/8050/9050 (grpc), 7053/8053/9053 (admin), 9443/9444/9445 (ops) | orderer{0,1,2}-ledger | base |
| peer0.org1.example.com | `fabric-peer:2.5.15` | 7051, ops 9446 | peer0org1-ledger | base |
| peer0.org2.example.com | `fabric-peer:2.5.15` | 9051, ops 9447 | peer0org2-ledger | base |
| ca-org1 / ca-org2 / ca-orderer | `fabric-ca:1.5.19` | 7054 / 8054 / 10054 | bind mounts | base |
| ccaas-evidence | build `chaincode/evidence` | none (internal :9999) | — | base |
| gleipnir-cli | `fabric-tools:2.5.15` | none (repo at `/opt/gleipnir`) | — | base |
| gleipnir-gateway | build `gateway/` | 3000 | crypto ro | base |
| gleipnir-frontend | build `frontend/` | 8081 | — | base |
| gleipnir-merkle-batcher / receipt-store / verification | build `services/*` | 127.0.0.1:4001 / none / none (internal :4002 / :4004) | receipt-data (:4002), verify-metrics (:4004, M26) | anchoring, parallel-anchored |

Until M28 the parallel-anchored profile also ran `peer0.anchor.example.com`
(11051, ops 9448, volume `peer0anchor-ledger`), `ca-anchor` (9054),
`ccaas-evidence-anchor` and `gleipnir-anchor-client` (4003).

**Channels & configtx** (`network/configtx/configtx.yaml`): one profile since
M28 — `AppChannel` (orgs Org1+Org2; template for `coc-main` and every
`case-NNN`); the earlier design's `AnchorChannel` profile (single org
`AnchorClientMSP`, backing `anchor-main`) is gone. Each peer org names its
gossip anchor peer (`AnchorPeers`: `peer0.org1.example.com:7051`,
`peer0.org2.example.com:9051`, M28); `configtxgen -outputBlock` encodes an
Application org's `AnchorPeers` into the channel's genesis block, so every
new channel starts with cross-org gossip and the gateway peer (peer0.org1)
discovers Org2's peer, which a 2-of-2 policy needs (each peer also sets
`CORE_PEER_GOSSIP_EXTERNALENDPOINT`).
There is **no consortium/genesis section**: channels are created exclusively
through the Fabric 2.5 channel-participation API (`osnadmin channel join`
against all three orderer admin endpoints, asserting HTTP 201 on each).
The chaincode endorsement policy on every app channel is a run setting since
M28 (`sweeps.yaml` `endorsement.policy` → `up.sh` / `reset-network.sh
--endorsement any|all` → `ENDORSEMENT` in `network/compose/.env` → `lib.sh
endorsement_policy` at each chaincode commit, so channels that
`provision-channel.sh` adds later match): `any` = `OR('Org1MSP.peer','Org2MSP.peer')`
(1-of-any, the default and the policy of campaigns 1–5), `all` =
`AND('Org1MSP.peer','Org2MSP.peer')` (2-of-2, the sensitivity cell
`endorse-all`). In campaigns 1–5 the anchor channel's policy was
`AND('AnchorClientMSP.member')`, held constant across all runs as a
controlled variable. Orderer: etcdraft ×3, BatchTimeout 2s,
MaxMessageCount 10.

**Node configs:** `network/core.yaml` and `network/orderer.yaml` are verbatim
Fabric 2.5.15 sampleconfig with enumerated deltas only — core.yaml pins the
world state to **goleveldb** (rich queries are therefore impossible by
construction) and raises the gateway concurrency limit
`peer.limits.concurrency.gatewayService` from 500 to 3,250 (CONTRACTS §12-26; campaigns 1–6
ran 500); the `ccaas` external builder is the sampleconfig's own entry; orderer.yaml sets
`BootstrapMethod: none` (channel participation). Both files are
version-controlled from the first commit and their git blob SHAs are embedded
in every run manifest.

**Crypto** (`network/crypto/registerEnroll.sh`): all material is produced by
Fabric-CA enrollment (no cryptogen) into the standard layout under
`network/organizations/` (gitignored), with NodeOUs enabled. Client identities
get a stable `keystore/priv_sk` copy because the Caliper network configs read
that fixed path.

## 6. Orchestration & measurement pipeline

Host prerequisites (orchestration/README): Ubuntu 22.04 / WSL2, Docker +
Compose v2, `fabric-ca-client` 1.5.x, `curl`, `jq`, Node 20 (`npx caliper`),
Python 3.10+ with PyYAML (`matplotlib` optional — charts only). All Fabric
admin operations run inside the `gleipnir-cli` fabric-tools container.

| Script | Role |
|---|---|
| `up.sh --variant V [--channels N] [--endorsement any\|all] [--skip-crypto]` | write `VARIANT` + `ENDORSEMENT` (M28; default `any`) into `.env` → enroll crypto (three orgs) → compose up (variant→profiles) → health-wait ops ports → wait until both peers serve gRPC (`wait_peer_grpc`, M28) → package/install ccaas once per org → create channels (osnadmin, 3×201 asserted) → approve+commit with the endorsement policy → start services |
| `down.sh [--wipe]` | stop all profiles; `--wipe` also removes ALL named volumes (library included), generated crypto and channel artifacts — never run without the authors' go-ahead |
| `reset-network.sh --variant V --channels C [--endorsement any\|all]` | M26 **ledger-only reset** between runs: refuses without `GLEIPNIR_ALLOW_LEDGER_WIPE=1`; prints and removes only `gleipnir_{orderer0,orderer1,orderer2,peer0org1,peer0org2}-ledger` (plus `peer0anchor-ledger` before M28), `gleipnir_receipt-data`, `gleipnir_verify-metrics`; deletes `network/channel-artifacts`, unsets the ccaas id, re-runs `up.sh --endorsement E --skip-crypto` (default `any`); never touches `gateway-auth-data`, `case-registry-data`, `evidence-blob-data`, CA state or `network/organizations` |
| `backup-volumes.sh <dir> [--restore]` | tar every `gleipnir_*` named volume via `alpine` (one file each); `--restore` REPLACES each volume's contents and refuses while a container uses it — the desktop app runs it before every ledger reset |
| `benchapp.pyw` + `benchcore.py` | the desktop benchmark app (M27, CONTRACTS §12-19): input boxes bound to `sweeps.yaml`, Preview/Run/Resume/Cancel per experiment through WSL, live per-round results, history, CSV export, suggested baselines, automatic backup/restore; since M28 the E3 tab runs e3a/e3b/e3c/ops/sens and edits `e3a.send_rates_tps` and `e3a.events_per_case_per_round`; the Settings tab edits `anchoring.idle_timeout_ms`; `test_benchapp.py` |
| `lib.sh` | shared helpers: `compose`/`cli`/`peer_env`, `create_channel`, `join_peer`, `app_channel` / `deploy_app_chaincode` (genesis → join → Raft wait → approve + commit, used by `up.sh` and `provision-channel.sh`), `endorsement_policy` (M28: `ENDORSEMENT` in `.env` → the policy string; `any` or absent = `OR('Org1MSP.peer','Org2MSP.peer')`, `all` = `AND(…)`), `package_ccaas`, `set_env_var`, `wait_raft_leader`, `wait_healthz` (accepts peers' permanent-503 docker check), `wait_peer_grpc <org>` (M28: retries `peer channel list` in the cli container until the peer answers gRPC — a peer's `/healthz` can answer first, and 12 failed attempts in campaigns 1–5 came from that window) |
| `provision-channel.sh case-NNN` | idempotent per-case channel provisioning (parallel variants) via `lib.sh` `app_channel`, reusing the package id up.sh installed (`CCAAS_ID_APP`) and the stack's `ENDORSEMENT`; experiment.py calls it for channels the running stack lacks. It writes no Caliper config |
| `crash-test.sh [--events K] [--out FILE]` | M28 batcher crash test (anchored stack): K events (default 5, fewer than the batch size) for one new evidence → each `202` → SIGKILL + start the batcher → flush → checks that no receipt, no trail entry and no root survived; exits 0 when all were lost (the documented behavior), 1 when something survived, 2 when the stack gives no usable answer; also reports whether the restarted container kept its `BATCH_EPOCH` (it then numbers batches from `b000000` again); side effects: before the test it re-creates the batcher with a new fixed `BATCH_EPOCH` (`crash-test-<unix time>`, written to `network/compose/.env`), so the test's batch id cannot already be on the ledger, and when the restart kept that epoch it re-creates the batcher once more with an empty `BATCH_EPOCH` |
| `tamper-test.sh [--out FILE]` | M28 receipt-store tamper test (anchored stack): one new evidence, 4 events, flushed, all verify; then one attack at a time, each undone — changed event copy → `root-mismatch`; changed sibling path → `root-mismatch` (blocks the proof, forges nothing); deleted receipt → `missing-receipt` on verify, the trail silently lists 3 events while the on-chain root's `leafCount` stays 4; replay through the gateway → a new eventId, recorded as a new event; replay into the batcher with the same eventId → 409 inside the open batch, 202 after the boundary, and the receipt (the witness) is overwritten; exits 0 when every outcome is the documented one, 1 otherwise, 2 when the stack gives no usable answer; it first re-creates the batcher with an empty `BATCH_EPOCH` (in `network/compose/.env`), so no batch id of the test can already be on the ledger. Both scripts are functional fault-injection tests (curl + jq + docker), not chaincode security tooling |
| `smoke-standard.sh` | functional gate: create → transfer → access ×2 → audit==4 → dispose → head status `DISPOSED` → transfer-after-dispose must fail |
| `rounds.py` (library, no CLI) | the ONLY renderer of Caliper benchconfigs and network configs from `sweeps.yaml`; nothing it renders is committed. `render_parallel_network()` writes `parallel-c{C}.yaml` into each parallel run's folder; library `render_round()` / `network_config()` / `smoke_rounds()` / `ops_rounds()` / `trace_round()` for experiment.py |
| `experiment.py --exp e0\|ramp\|e1\|e2\|e3a\|e3b\|e3c\|ops\|sens\|cell [--variant V]* [--reps N] [--resume] [--dry-run] [--reuse-network] [--no-monitor] [--no-audit] [--verbose] [--send-rate R…] [--batch-size B] [--cases N] [--seed …] [--rounds …] [--events-per-case …] [--idle-timeout-ms F] [--endorsement any\|all] (+ the other control flags)` | the campaign driver (factor + control flags `--exp cell` only, CONTRACTS §12-18; `[run i/n]` progress + ETA, one result line per round, `results/<exp>/<exp>-results.csv` rewritten after every run): plans cells × repetitions, runs the lifecycle below per run (one network lifetime each, **fresh ledger by default**, reset with the run's endorsement policy; `--reuse-network` opts out for one warned ad-hoc run and is refused when the stack's `ENDORSEMENT` differs), loud failures, `runlog.jsonl`; e3a adds the climb after the base ladder (M28: `e3a_next_runs`, verdicts in `results/e3a/e3a-climb.json` after every step; `--resume` re-derives the climb from the complete runs) |
| `checkpoint.py <runPath> --label tK` | storage checkpoint via `docker exec du -sb` against the **named volumes**: per-channel block store, per-peer GoLevelDB state dir, receipt store `/data` → `checkpoints.jsonl` (`t0` before the first round, `t<k+1>` after every round) |
| `collect.py <run-dir> [--baseline R]` / `--selftest` | run dir → `manifest.json`: round table + docker resource stats from `caliper.log`, per-tx percentiles/failure classes from `tx-w*.jsonl`, per-round finalization (M28; tx-log `batchId` joined to `anchoring.json` on the anchored variants), OLS storage regression, anchoring + audit summaries |
| `report.py --exp E [--out docs/results/E] [--no-charts] [--decimal-comma]` | ALWAYS the per-round Excel CSV `benchmark/results/E/E-results.csv` (any E incl. e0/ramp/cell; supervisor column order; UTF-8 BOM); for e1, e2, e3a, e3b, e3c, ops and sens also per-experiment CSV + Markdown tables (units in headers, mean ± SD over reps; Markdown = one table per variant, ONE latency column `avg (min–max), p95` of means; sens X = the cell name) + PNG charts (one per metric, one line per variant; none for ops and sens; E1 with Standard/Parallel reference lines, its batch-size-free reference rows printed as `ref` rather than the literal `None`; E3a flagged by `e3a_verdict` — `saturated`, `generator-limit`, `latency-knee` — → `e3a-saturation.json`, which since M28 also holds `keptUpToSendRateTps` and `generatorLimitSendRateTps` (and `latencyKneeBasis`, CONTRACTS §12-27); ops → `ops-writes.*` / `ops-reads.*`). Since M28 the tables end with measured send rate (tx/s), finalized throughput (TPS), finalization latency avg and p95 (s) and audit time per event (ms). The per-round tables (e3a, ops) open with a note that on-chain/off-chain bytes per event, audit time (per case and per event) and anchoring delay are measured once per RUN, so the same value repeats on every row |

**Experiment plans** (`experiment.py --exp`; every cell × `repetitions`, r = 3
unless overridden; e0/ramp always 1 rep):

| exp | variants | swept | fixed | rounds per run |
|---|---|---|---|---|
| `e0` | all 4 | — | `regimes.smoke` shape at 5 tx/s; parallel* on one channel per smoke case (10) | per-op smoke rounds (+ `smoke-access-shared-gate` on standard, `smoke-verify` on anchored) + `smoke-trace` + audit; regime `smoke` |
| `ramp` | all 4 | send rate | `ramp.events_per_case_per_round` | one `rate<R>` round per send rate; prints throughput vs send rate + suggested `baseline.send_rate_tps` (confirm with the supervisor) |
| `e1` | anchoring (1 ch), parallel-anchored (`baseline.channels`) + standard/parallel **reference** runs (`levels.reference`) | `batch_sizes` | `baseline.send_rate_tps` | `workload.rounds` trace slices `slice<k>` |
| `e2` | parallel | `channel_counts` | `baseline.send_rate_tps` | slices; cases = channels (one channel per case) |
| `e3a` | all 4 | send rate: since M28 the base ladder `e3a.send_rates_tps` (100 … 1000 tx/s), then the climb | `baseline.batch_size`, `baseline.channels`; base-ladder rounds of `e3a.events_per_case_per_round` (1,500) | one `rate<R>` round per send rate, ascending, one ledger per run. The climb (M28; one common top since CONTRACTS §12-25): every variant runs the same climb rates `e3a.climb.send_rates_tps` (1250, 1500, 1750, 2000, 2250, 2500 tx/s; rounds ≥ 30 s at the top rate) with 16 Caliper workers (`e3a.workers`); each rate is judged on the reps' mean (`report.e3a_verdict`), walking up: measured send rate < 0.95 × configured → load-generator limit; else finalized throughput < 0.9 × configured → saturated; the walk ends at the first of these. After the climb every variant is done, so all four are measured at the same send rates (CONTRACTS §12-28; campaign 6 also ran one midpoint run, dir tag `-midpoint`); a step with fewer complete reps is planned again first |
| `e3b` | all 4 | `case_counts` ≤ `baseline.channels_max` | `baseline.send_rate_tps` (fixed TOTAL send rate) | slices; parallel* channels = cases, standard/anchoring 1 |
| `e3c` | all 4 | `e3c.case_counts` ≤ `baseline.channels_max` (M28) | fixed PER-CASE send rate: send rate = cases × `e3c.send_rate_per_case_tps` (5 → 25 … 500 tx/s); 20 cases × 5 = the baseline cell, measured by `sens` (report.py does not merge it in: the analysis adds the `sens` baseline rows at 20 cases) | slices; parallel* channels = cases, standard/anchoring 1 |
| `ops` | all 4 | operation | E3 point | `create transfer access dispose` (writes), `read-evidence read-trail` (reads), `verify-event` (anchored) |
| `sens` | all 4; a cell that overrides only `anchoring.*` runs on the anchored variants alone (M28) | the `sensitivity` cell: `baseline`, `endorse-all` (`endorsement.policy: all`), `idle-5s` (`anchoring.idle_timeout_ms: 5000`) | the baseline point (`baseline.send_rate_tps`, `baseline.channels` cases, `baseline.batch_size`, `workload.rounds` × 224 events/case); each run carries its own effective constants | slices; repetition by repetition (every cell once, then again: 12 + 12 + 6 = 30 runs at r = 3); the cell name tags the levels dir and `run.json` `cell` |
| `cell` | all 4 (or `--variant`) | — (one ad-hoc cell) | CLI `--send-rate`/`--batch-size`/`--cases` (= channels on parallel*), else `sweeps.yaml` baseline | several send rates → one `rate<R>` round each, ascending; one → `workload.rounds` slices; `results/cell/`, exported to the per-round CSV only (no aggregated table) |

From M28 on, the campaigns carry the ramp and E2 baselines forward and do not
run those two again; both stay runnable. The top-level `send_rates_tps` is the
ramp grid only (E3a has its own ladder).

```mermaid
flowchart TD
    A["experiment.py: next run<br/>(exp / variant / levels / rep)"] --> B["clear a re-executed run's rounds/, checkpoints.jsonl,<br/>anchoring.json, audit.json, manifest.json — tx logs and<br/>checkpoints are APPENDED, so a retry must not stack on them<br/>→ seed run.json: identity + provenance (git SHA, config blob SHAs,<br/>sweeps SHA, Caliper binding, Fabric tag, host)"]
    B --> B2["anchored: BATCH_SIZE / BATCH_FLUSH_MS / BATCH_IDLE_MS / fresh BATCH_EPOCH in .env"]
    B2 --> G["trace/generate.js → benchmark/traces/&lt;hash&gt;.json<br/>(hash + params into run.json) — BEFORE the reset;<br/>steady label re-checked on the trace's actual<br/>least-loaded channel (below 10³ → sub-floor)"]
    G --> C{"--reuse-network?"}
    C -- "no (default)" --> D["reset-network.sh --variant V --channels C --endorsement E<br/>(GLEIPNIR_ALLOW_LEDGER_WIPE=1; ledger volumes only)"]
    C -- yes --> E["verify running stack: .env VARIANT + ENDORSEMENT,<br/>provision missing case-NNN channels,<br/>abort on case channels this cell does not use"]
    D --> F
    E --> F["anchored: recreate merkle-batcher"]
    F --> H["checkpoint.py t0"]
    H --> I["per round: rounds.py renders bench.yaml →<br/>npx caliper launch manager (GLEIPNIR_TXLOG_DIR)<br/>tee caliper.log, report.html, tx-w*.jsonl"]
    I --> P{"anchored?"}
    P -- "yes, last round" --> Q["POST /flush + GET /status?events=1 → anchoring.json<br/>(BEFORE the checkpoint, so the run-end partial<br/>batch is inside the t0→tN delta)"]
    P -- "yes, earlier round" --> R["settle: poll GET /status until no root<br/>is pending (read-only, never flushes)"]
    P -- no --> J
    Q --> J
    R --> J["checkpoint.py t&lt;k+1&gt;"]
    J --> K{"more rounds?"}
    K -- yes --> I
    K -- no --> M["audit/reconstruct.js → audit.json<br/>(first audit_cases cases of the trace)"]
    M --> N["collect.py → manifest.json (status complete)"]
    N --> O["append results/runlog.jsonl"]
    O --> A
```

**Metrics contract** (per run, machine-readable at
`benchmark/results/<exp>/<variant>/<levels>/r<rep>/manifest.json`; schema in
CONTRACTS §10): configured send rate and measured send rate; per-round
throughput with a **successful-only** recomputation (Caliper's reported
denominator includes failures), aggregate **and** derived per-channel for
multi-channel cells; latency min/avg/max (Caliper) + p50/p95/p99 per round
and per operation type (from the per-transaction JSONL); per round (M28) the
integrity **finalization** of the successful timed writes, `finalization
{basis, finalized, notFinalized, pausedEvents, latencyMs{min, p50, p95, p99,
max, mean, n}, finalizedTps, minSpan, windowS}` — submission (Caliper's create time) →
the event's own commit on Standard/Parallel (`basis: commit`, `tFinal`), or →
the commit of the Merkle root of the batch its `202` named on the anchored
variants (`basis: root-commit`, `anchoring.json` `committedAt`; an event whose
batch never committed is not finalized; a round with no batch link at all, as
in runs logged before it existed, has no finalization record); `finalizedTps` =
the least-squares slope of the cumulative finalizations over [the first
finalization after the round's first submission, its last submission]
(anchored: every root committed in that window, weighted by its leafCount), at
most the round's accepted rate, `null` when the finalizations inside the send
window span less than 40 % of it (CONTRACTS §12-27), so a variant that keeps up
reads about the send rate whatever its latency and a saturated one reads its
capacity; `pausedEvents` = finalized events whose batch
closed after the round's last accepted write; success/failure
counts, failure rate (%) and the classes `MVCC_READ_CONFLICT`,
`ENDORSEMENT_POLICY_FAILURE`, `TIMEOUT`, `HTTP_4XX`, `HTTP_5XX`, `OTHER`
— all over the **timed** tx-log records only, plus, on a round that had
failures, a separate `failureClassesLogScan` (a `caliper.log` regex scan with
the same three fabric classes and a raw `fabricStatusCodes` map, reported
alongside and never merged in, because the pinned peer-gateway connector sets
no per-transaction error string); `untimedWrites` per round — the successful
write ops logged `timed: false`, i.e. the untimed pool/verify seeding; CPU (%)
/ memory (MB) per container from Caliper's docker monitor with `fabric` /
`offchain` / `all` groups; storage from the `t0..tN` checkpoint series — per-channel
block-store deltas (app channels; plus the anchor channel in the earlier
design's runs, campaigns 1–5 — `anchorChannelDeltaBytes`, 0 since M28),
GoLevelDB state delta, off-chain
receipt-store delta, `bytesPerEventRegression` (OLS, ≥ 3 points, `r2: null`
for a flat series rather than a flattering `1.0`) with the delta as
cross-check, both over a denominator of **timed successful writes +
`untimedWrites`** (the seeds commit real transactions, so their bytes are in
the series and their events belong in the divisor); if the last checkpoint has
no block-store rows for the hosting peer, `storage` is omitted with a printed
warning and report.py prints `-` rather than "0 bytes/event"; anchoring delay
(s; leafCount-weighted, forced batches
also reported excluded; since M28 also `idleTimeoutMs`, `closeReasons`
{reason: count} and the exact per-event `delayPerEventMs` from
`enqueuedAtMs`); audit reconstruction time per case and per event; and provenance
(`gitCommit`, blob SHAs of the six network config files, `sweeps.yaml` SHA,
trace hash + params, Caliper version/binding/connector, Fabric tag, host
cores/memory). With `--baseline <standard-run>`, collect.py adds
`payloadCompressionVsBaseline` — computed as the reduction in on-chain
**bytes per event** vs Standard, never reported as a clean 1/N of total
ledger size. Anchored-variant write latency on the REST path is enqueue
latency (the gateway's 202); commit lag is the anchoring-delay metric, and
(M28) finalization latency is the one latency that all four variants share.
Since M28 `run.json` `controls` also record `idleTimeoutMs` and
`endorsement`, and a sens run's `run.json` names its `cell`.

**Run identity:** `runId = <exp>/<variant>/<levels>/r<rep>` with `levels =
batch<N>-ch<C>-cases<K>[-ref]` (fixed key order; `cell` appends `-rate<R>…` and, with control
overrides, `-x<hash>`; since M28 an e3a climb run appends its rates, e.g.
`-rate1250-1500-1750-2000-2250-2500` (campaign 6's midpoint runs also `-midpoint`), and a sens run
its cell name, e.g. `-endorse-all`). Regime labels: `smoke`
(e0 only, under `results/e0/`), `steady` (write events on the least-loaded channel — nominal at plan time, then the generated trace's actual count — ≥
`regimes.steady.min_events_per_channel` = 10³) or `sub-floor` (below it).
`ops` and `ramp` runs are labelled `sub-floor` unconditionally, never by the
floor rule: that rule divides by channel count and would have labelled the
same workload `steady` on the single-channel variants and `sub-floor` on the
multi-channel ones. Smoke and steady data never share a directory.
"Baseline" constants in `sweeps.yaml` are calibrated by E0/E1/E2, never
"optimal".

## 7. Benchmark workspace (`benchmark/`)

`sweeps.yaml` is the **single source of truth** for all experiment constants
(M26 schema, extended at M28; condensed here — the file of record is
`benchmark/sweeps.yaml`, CONTRACTS §10):

```yaml
seed: 20260922            # PRNG seed of the transaction trace — identical across all variants
workers: 4                # Caliper worker processes (constant)
repetitions: 3            # r; mean ± SD over repetitions
batch_sizes: [10, 25, 50, 100, 200]               # E1 — ONE grid for Anchoring and Parallel-Anchored
channel_counts: [5, 10, 20, 30, 40, 50]           # E2 — Parallel only; bounded by host cores
send_rates_tps: [10, 25, 50, 75, 100, 150, 200]   # ramp — configured send rate (input, not output); E3a has its own ladder (M28)
case_counts: [5, 10, 20, 30, 40, 50]              # E3b — trimmed to ≤ baseline.channels_max
baseline: { send_rate_tps: 100, batch_size: 50, channels: 20, channels_max: 100 }   # calibrated by the ramp/E1/E2 (2026-10-01/02; channels_max 100 for E3c's 100-case point, CONTRACTS §12-29); "baseline", never "optimal"; channels = the set case count (parallel*: one channel per case)
workload:
  evidence_per_case: 20
  events_per_case_per_round: 224  # cases*224/workers must be an integer for every grid case count
  rounds: 5                       # trace slices per run (E1/E2/E3b/E3c/sens; E3a: one slice per send rate)
  mix: { transfer_weight: 0.15, access_weight: 0.85, dispose_fraction: 0.5 }
  payload_bytes: 256
  audit_cases: 100                # >= the largest case count, so every case (capped at the run's case count)
anchoring: { flush_timeout_ms: 0, idle_timeout_ms: 0 }   # age / idle batch timer (idle: M28); both 0 = size-only batching
endorsement: { policy: any }         # M28: any = 1-of-any (default), all = 2-of-2, on every app channel
monitor:   { interval_s: 5 }         # Caliper docker monitor
regimes:
  smoke:  { cases: 10, evidence_per_case: 2, logs_per_case_min: 10, logs_per_case_max: 25, send_rate_tps: 5 }
  steady: { min_events_per_channel: 1000 }   # below → "sub-floor", never "steady"
ramp: { events_per_case_per_round: 224 }   # = the E3b slice: 40 would let Parallel's 2 s end-of-round block wait read as saturation
e3a:                                       # M28: send rate up to saturation, at baseline.channels cases
  send_rates_tps: [100, 150, 200, 300, 400, 600, 800, 1000]   # the base ladder, one round per rate
  events_per_case_per_round: 1500          # base-ladder rounds: 30,000 tx at 20 cases
  workers: 16                              # Caliper workers in e3a only; every other experiment uses `workers`
  saturation_ratio: 0.9                    # saturated: finalized throughput < this x the configured send rate ...
  generator_ratio: 0.95                    # ... while the measured send rate >= this x configured (below: load-generator limit)
  climb: { send_rates_tps: [1250, 1500, 1750, 2000, 2250, 2500], min_send_s: 30 }   # every variant; 2500 = the common top
e3c: { send_rate_per_case_tps: 5, case_counts: [5, 10, 30, 40, 50, 100] }   # M28: send rate = cases x 5
sensitivity:                               # M28: cells of sweeps.yaml path overrides at the baseline point
  baseline: {}
  endorse-all: { endorsement.policy: all }
  idle-5s: { anchoring.idle_timeout_ms: 5000 }
```

`benchmark/` has **no generator of its own**, and **no generated config is committed**:
- `experiment.py` renders every round, smoke included, into `results/…/rounds/<label>/bench.yaml` at run time,
  through `orchestration/rounds.py`.
- For the parallel variant it also renders `parallel-c{C}.yaml` into the run folder. Each benchconfig is one
round + a `monitors.resource` docker block (container names with the leading
slash Caliper matches verbatim).

**Transaction trace** (`trace/generate.js`, `npm run gen:trace`): a pure
function of `(seed, cases, channels, evidencePerCase, eventsPerCasePerRound,
rounds, workers, mix, payloadBytes, headGap)` with a mulberry32 PRNG — same params →
byte-identical `traces/<hash>.json` (gitignored; hash recorded in
`run.json`). Evidence `e` is owned by worker `e mod workers`, its ops sit in
that worker's sequence in lifecycle order CREATE → (TRANSFER|ACCESS)* →
[DISPOSE], interleaved with the worker's other lifecycles in proportion to
their remaining ops (so every lifecycle ends near the end of the sequence and
all DISPOSEs fall in the last round — E3a and the ramp: the top send-rate
level; trace-based DISPOSE latency comes only from that round, the
per-operation breakdown from `ops`); within a round a TRANSFER/DISPOSE sits
≥ `headGap` items after the same evidence's previous CREATE/TRANSFER — 110 in
campaign traces, 7 (S/8; 5.6 s at 5 tx/s) in the E0 smoke trace's 60-item
rounds; closer, for the campaign shapes (≥ 5 cases × 224 events/case/round),
only in a worker's last ≤ `headGap` items (at most 72 measured), while cells
with ≤ 4 cases fall back earlier, and E3a's 16-worker traces leave about 590–660
such pairs per run, almost all in the run's last round (CONTRACTS §12-25, §12-28) — so
below saturation it is normally not
endorsed before its predecessor commits (CONTRACTS §12-22). Each worker holds
exactly `rounds × S` items (`S = cases × eventsPerCasePerRound / workers`),
and round `k` replays
`[k·S, (k+1)·S)`.
`caseId = case-NNN`, `NNN = ((dataCase−1) mod channels)+1`, is the channel
routing key. All four variants replay the same file; only `mode` differs.

**Two Caliper connectors, by design:**

- **fabric** (peer-gateway binding, `mode: fabric`) — `networks/coc-main.yaml`
  and the per-run `parallel-c{C}.yaml`: Caliper submits directly to
  the peer over grpcs as `User1@org1`; measures raw Fabric
  submit-to-commit. Used by standard and parallel.
- **REST (custom, `mode: rest`)** — `benchmark/connectors/rest/index.js`
  (`RestGatewayConnector extends ConnectorBase`), wired via
  `networks/rest-gateway.yaml`: drives the gateway's HTTP API with the bearer
  token; measures the full BFF path — for the anchored variants a "commit" is
  the gateway's `202` enqueue, and non-2xx → `SetStatusFail` + `SetErrMsg(0,
  'HTTP <status>')` so failures classify; since M28 a `202` also puts the
  batch placement (`batchId`, `leafIndex`) on the `TxStatus`, parsed after
  `SetStatusSuccess` stamped the final time, so it is not part of the
  measured latency. Used by anchoring, parallel-anchored, and all verify
  rounds.

**Workload modules** (`benchmark/workload/`, identical across variants; round
arguments per CONTRACTS §10): `trace.js` (mixed-workload replay of one trace
slice — E1/E2/E3), `createEvidence.js`, `transferCustody.js`, `accessLog.js`
(keeps the legacy `shared` scenario = the MVCC correctness gate: many workers,
one evidenceId, zero conflicts expected via composite keys),
`disposeEvidence.js` (per-operation write rounds), `read.js` (`ReadEvidence`
/ `GetAuditTrail`; `readOnly: true` in fabric mode, service-token GETs in rest
mode — never auto-logged), `verify.js` (seeds events, forces `/flush`
untimed, then times the verify endpoint; anchored only), and `lib/`
(`payloads.js` builders + `case-NNN` round-robin selector + payload filler,
`pool.js` untimed seeding + `flushBatcher`, `txlog.js`). In rest mode
`read.js` flushes the batcher after seeding too (same shared helper): the
anchored variants answer reads from the off-chain trail, which exists only
once a batch closes, so unflushed seeds would have made the reads table
measure 404s and empty arrays. Multi-channel rounds spread offered
load round-robin across **all** provisioned case channels in one Caliper run.
`rounds.py render_bench` puts `mode`, `label`, `channels` and `variant` in
**every** round's arguments — the case-spread is suppressed by variant name,
so a round without `variant` would fall back to `case-001` and point
Standard at a channel its network config does not contain.

**Per-transaction capture** (`lib/txlog.js`): every timed transaction writes
`{"round","op":"CREATE|TRANSFER|ACCESS|DISPOSE|READ_EVIDENCE|READ_TRAIL|VERIFY",
"caseId","evidenceId","tCreate","tFinal","latencyMs","ok","err","timed"}` to
`${GLEIPNIR_TXLOG_DIR}/tx-w<worker>.jsonl` from Caliper's own `TxStatus`,
buffered off the timed path — the source of p95, success/failure counts and
failure classes. Since M28 the line of an anchored write the batcher
accepted ends with `"batchId"` and `"leafIndex"` (from the `202`; every
other line is unchanged), which collect.py joins to the batch's root commit
for the finalization latency (§6). `timed: false` lines are the untimed pool seeding
(`log(..., timed = false)`) and `verify.js`'s seeding (`logUntimed(...)`,
which goes over plain `fetch` and so has no timestamps): real ledger writes
that were never measured, counted in the storage bytes-per-event denominator
and excluded from every timing, throughput and failure statistic. Known
limit: the 0.6.0 peer-gateway connector sets no error string, so fabric-mode
`err` is `null` and collect.py classifies those failures from `caliper.log`.

**Audit reconstruction** (`audit/reconstruct.js`, `npm run audit`; host-side,
gateway only): the first `audit_cases` data-cases of the trace (since M28
`audit_cases: 100`, 50 in campaign 6, capped at the run's case count, so every case), timed per
case with `hrtime` — on-chain trail on Standard/Parallel, `?proofs=1` + leaf
recompute + sibling-path fold + one root read per `(scopeId, batchId)` per
case (the cache is reset for every case) on the anchored variants, after one
untimed pass over case 1's first evidence item (trail + root reads,
discarded) (`audit/merkle.js` is a byte-identical copy of the
services' Merkle file, pinned by `test/merkle-identity.test.js`). Output
`{variant, method, traceHash, cases[], summary{msPerCase{mean,sd,min,max},
msPerEvent, okRate}}` → `audit.json` (`msPerEvent` is a report.py column
since M28: "audit time per event (ms)").

## 8. Deliberate design properties (do not "fix")

These are experimental controls; each was audited as an invariant:

1. **Receipt store is un-hardened** — its exposure is a measured property and
   thesis caveat (§4.4).
2. **Evidence binaries are off-chain in every variant** — only audit records
   / roots go on-chain.
3. **Anchoring is plain SHA-256 Merkle-root anchoring** — no ZK proofs, no
   rollup constructions, sibling-path verification only.
4. **MVCC conflict avoidance is structural** — composite event sub-keys, not
   retry loops (§4.1).
5. **Smoke and steady regimes never mix** — `smoke-*` artifacts are labelled
   and excluded from all performance claims.
6. **GoLevelDB only** — key-value chaincode by construction; adding CouchDB
   would invalidate the storage measurements.
7. **One batch grid, one trace, "baseline" not "optimal"** (M26) — batch
   size is identical across the anchored variants, channel count across the
   parallel variants (Standard/Anchoring are single-channel by code), the
   seeded trace is replayed byte-identically across all four, and calibrated
   constants are carried forward as baselines. Anchored-variant write latency
   is enqueue latency; anchoring delay is reported beside it, never folded in,
   and since M28 so is finalization latency (submission → the event's own
   commit, or its batch's root commit), the one latency all four variants
   share.

## 9. Security posture (`owasp-top10-review` branch)

A prior systematic security review resolved every fixable web-app-tier
finding. A follow-on OWASP Top 10 (2021) review (2026-07-24) re-verified those
fixes live against the running **standard** variant and found six residual
gaps, all now fixed and unit-tested — none touch the chaincode, the frozen
contracts, or the service-token/benchmark write path:

| # | Category | Fix | Where |
|---|---|---|---|
| 1 | A02 Cryptographic Failures | Service/internal bearer-token comparisons (`===`/`!==`) were the only non-constant-time secret comparisons in the codebase. Replaced with a length-guarded `safeEqual()` (fixed-digest hash → `crypto.timingSafeEqual`) in gateway, case-registry, evidence-store. | `gateway/src/auth.js`, `services/case-registry/src/index.js`, `services/evidence-store/src/index.js` |
| 2 | A05 Security Misconfiguration | The gateway's own origin (`:3000`) shipped bare responses — no security headers — if reached directly, bypassing the nginx edge. Added `nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy: no-referrer` / strict `default-src 'none'` CSP middleware. | `gateway/src/app.js` |
| 3 | A07 Auth Failures | Sessions were absolute-TTL-only (8 h) — a token on an unattended terminal stayed valid the full window. Added a sliding idle timeout (30 min), refreshed per authenticated request, dying at the earlier of the two clocks. (The 30 min idle window is fixed; there is no environment override — docs/CONTRACTS.md §12-20.) | `gateway/src/sessions.js` |
| 4 | A09 Logging & Monitoring | No security-relevant *failure* was logged anywhere (failed logins, lockouts, authz denials, `/internal/anchor-root` probing) — only successful on-chain writes are visible in the audit trail. Added a structured JSON stderr sink; logs only failures, never secrets (unit-verified no-secret guarantee). | `gateway/src/securityLog.js` |
| 5 | A06 Vulnerable Components | First `npm audit` pass on the repo; patched non-pinned runtime advisories (`body-parser`, `protobufjs`) via lockfile-only `npm audit fix` across gateway/anchor-client/merkle-batcher/receipt-store/verification → 0 vulns. Pinned versions (`fabric-gateway 1.11.0`, `caliper-cli 0.6.0`) untouched. | lockfiles only |
| 6 | A05 / A09 | A malformed JSON request body returned Express's default HTML error page with a full stack trace and container filesystem paths — the per-route error sanitizer from the earlier review never saw it because `express.json()` throws before routing. Added a terminal error-handling middleware: generic JSON body to the client, detail logged server-side. | `gateway/src/app.js` |

**Documented, not fixed — intentional design properties (do not "fix"):**
the receipt store's un-hardened witness (§4.4, §8) · committed non-production
default secrets in `network/compose/.env` (reproducible local-dev artifact) ·
plaintext HTTP + non-empty-only password policy (single-host,
non-production posture) · the docs/CONTRACTS.md §12-8 admin blob barrier is
self-serviceable but fully auditable, not a hard prevention control · **left
unchanged:** the single shared `GLEIPNIR_TOKEN` authenticates
every route including internal ones — frozen by the Caliper/smoke-script
dependency on it; changing it needs an explicit contract amendment.

Final verification: gateway unit suites 45/45, evidence-store 9/9,
`smoke-library.sh` 17/17, a 79-check live functional battery 78/79 (the one
gap a known harness-ordering artifact, not an app defect), and the manual
23-exhibit test fixture confirmed untouched (0 events added by the review
itself).

## 10. Repository layout

```
Gleipnir/
├── README.md                 # entry point + docs map
├── chaincode/evidence/       # Go ccaas contract + Dockerfile
├── gateway/                  # BFF service (Node 20, express, fabric-gateway, auth/users/sessions)
├── services/
│   ├── merkle-batcher/       # batching + Merkle tree construction
│   ├── receipt-store/        # off-chain witness store (un-hardened by design)
│   ├── verification/         # RQ2 timed verification path
│   ├── case-registry/        # M13a: off-chain Case entity + evidence read-model (SQLite, node:20.19-slim)
│   └── evidence-store/       # M13b: immutable evidence blobs + ni-URI proofs
├── frontend/                 # React SPA (evidence library) behind nginx
├── network/
│   ├── compose/              # compose-net/-ca/-services.yaml + .env (pins)
│   ├── configtx/             # AppChannel profile (both orgs' gossip anchor peers)
│   ├── crypto/               # registerEnroll.sh (Fabric-CA, no cryptogen)
│   ├── core.yaml             # peer sampleconfig (goleveldb pin)
│   └── orderer.yaml          # orderer sampleconfig (BootstrapMethod: none)
├── orchestration/            # up/down/reset-network/backup-volumes/provision, build-images.sh (proxy-CA dev-host build), rounds.py/experiment.py/checkpoint/collect/report, benchapp.pyw (desktop app), crash-test.sh/tamper-test.sh (M28 fault injection)
├── benchmark/                # Caliper 0.6.0 workspace (sweeps.yaml = truth)
│   ├── networks/             # connector configs (coc-main, rest-gateway, connection profile; parallel-c{C} rendered per run)
│   ├── connectors/rest/      # custom Caliper REST connector
│   ├── trace/                # seeded transaction-trace generator
│   ├── audit/                # audit-reconstruction harness (+ pinned merkle.js copy)
│   ├── workload/             # trace replay + per-op + read + verify modules, lib/txlog.js
│   ├── traces/               # generated <hash>.json traces (gitignored)
│   └── results/              # <exp>/<variant>/<levels>/r<rep>/ + runlog.jsonl (gitignored)
└── docs/                     # ARCHITECTURE (plan), CONTRACTS, this file, methodology/experiments.md, research/, results/
```

## 11. Provenance & citation

- **Code:** cite the repository at a commit SHA. The core architecture
  described in §1–§8 was live-verified at `8bb4c4e`; the security posture in
  §9 was verified through the `owasp-top10-review` branch, final
  commit `13e9685`. Campaigns 1–5 ran the earlier Parallel-Anchored design
  (roots on the anchor channel) and stay reproducible at `573017b`; the M28
  design (§12) applies from campaign 6 on. History is never rewritten; cited
  SHAs remain valid.
- **Configuration:** every run manifest embeds `gitCommit` plus the git blob
  SHAs of `configtx.yaml`, `core.yaml`, `orderer.yaml` and the three compose
  files, the `sweeps.yaml` blob SHA, the trace hash + params, the Caliper
  version/binding/connector, the Fabric tag and the host's cores/memory
  (M26), so any datapoint is traceable to the exact configuration and
  transaction sequence that produced it.
- **Stack:** all images and packages are version-pinned (§2); `:latest` is
  never used (it resolves to Fabric 3.x).
- **Verification trail:** the system was checked by a static code audit, a
  live end-to-end bring-up, per-variant smoke runs and two security reviews
  (§9 above); every finding was resolved or documented as a design property.

## 12. M28 — the true 2×2 redesign (2026-11-06)

The supervisor's review of the paper found that the 2×2 design (anchoring ×
per-case partitioning) was not a true factorial: Parallel-Anchored batched per
case but committed every root to the separate anchor channel `anchor-main`
(written by the anchor-client under its own `AnchorClientMSP` org), so its
case channels carried nothing. M28, approved by the authors on 2026-11-06
(decision record docs/CONTRACTS.md §12-24), makes the design a true 2×2 and
adds what the revised experiments need. The chaincode is unchanged
(`CommitAnchorRoot` / `ReadAnchorRoot`, write-once per `(scope, batchId)`,
`leafCount` recorded). Campaigns 1–5 ran the earlier design and stay
reproducible at commit `573017b`.

| # | Change | Where |
|---|---|---|
| 1 | **Parallel-Anchored roots on each case's own channel.** The batcher submits every root of both anchored variants through the gateway's bearer-authed `POST /internal/anchor-root`. Anchoring's meta stays `{scopeId: "shared", leafCount}` (no `caseId` → chaincode scope `shared`, channel `coc-main`); Parallel-Anchored's is `{scopeId, leafCount, caseId}` with `caseId = scopeId = case-NNN`, committed on channel `case-NNN`. `variantRouter.rootChannel(variant, scopeId, defaultChannel)` picks the channel (404 `no anchor roots in this variant` on standard/parallel; 400 unless `case-NNN` on parallel-anchored) for the commit and for `GET /internal/anchor-root/…` and `GET /api/v1/anchor-roots/…`, now one handler (chaincode not-found → 404). The verification service reads every root through the gateway (no `ANCHOR_CLIENT_URL`). All ledger writes now use one chaincode deployment and one endorsement policy on the app channels, and Parallel-Anchored's case channels carry data. | `gateway/src/`, `services/merkle-batcher`, `services/verification` |
| 2 | **Anchor-channel path removed.** `services/anchor-client/`, `peer0-anchor`, `ccaas-evidence-anchor`, `ca-anchor`, the `AnchorClientMSP` org (configtx `AnchorOrg` + `AnchorChannel` profile; `registerEnroll.sh`'s anchor org, `anchor-only` mode and `ENABLE_ANCHOR_ORG`), `anchor-main` creation + deploy in `up.sh`, `CCAAS_ID_ANCHOR`, the `peer0anchor-ledger` volume (compose and the `reset-network.sh` list), ports 4003 / 9054 / 9448 / 11051 / 11052, the anchor-peer wait in `benchcore.stack_up_script`, the anchor-client image in `build-images.sh`, and the anchor containers in `rounds.py`'s monitor list and `checkpoint.py`'s peer list. The `parallel-anchored` profile now starts the same three services as `anchoring`. `collect.py` keeps its `anchor-main` accounting (`ANCHOR_CHANNEL`, `anchorChannelDeltaBytes`, `gleipnir-anchor-client` in the off-chain group) only so that the campaign 1–5 run folders re-collect to the same numbers; new runs have no anchor channel, so `anchorChannelDeltaBytes` is 0. | `network/`, `orchestration/`, `services/` |
| 3 | **Per-event timestamps and finalization latency.** Batch records carry `closeReason` (`size` \| `idle` \| `timeout` \| `flush`; `forced` = not `size`) and `enqueuedAtMs` (each event's enqueue time in leaf order, served only by `GET /status?events=1`; `/status` adds `idleTimeoutMs`); experiment.py writes `anchoring.json` from `/status?events=1` after the final flush. The REST connector copies an anchored write's `batchId`/`leafIndex` from the `202` onto the `TxStatus`, and `txlog.js` appends them to that line. collect.py adds per round `finalization {basis: commit \| root-commit, finalized, notFinalized, pausedEvents, latencyMs, finalizedTps, windowS}` (§6) and, to the anchoring summary, `idleTimeoutMs`, `closeReasons` and the exact per-event `delayPerEventMs`. | `services/merkle-batcher`, `benchmark/connectors/rest`, `benchmark/workload/lib/txlog.js`, `orchestration/experiment.py`, `orchestration/collect.py` |
| 4 | **Endorsement policy as a run setting.** `sweeps.yaml` `endorsement.policy`: `any` = `OR('Org1MSP.peer','Org2MSP.peer')` (1-of-any, the default) or `all` = `AND(…)` (2-of-2). `up.sh` / `reset-network.sh --endorsement any\|all` write `ENDORSEMENT` into `network/compose/.env`; `lib.sh endorsement_policy` reads it at every chaincode commit on an app channel, so `provision-channel.sh`'s later channels match. experiment.py passes the run's policy to the reset, refuses `--reuse-network` when the stack's `ENDORSEMENT` differs, and records `controls.endorsement`; cell flag `--endorsement any\|all`. configtx declares `AnchorPeers` for Org1 (`peer0.org1.example.com:7051`) and Org2 (`peer0.org2.example.com:9051`), so cross-org gossip and discovery let the gateway peer (peer0.org1) reach Org2's peer for 2-of-2 (§5). | `benchmark/sweeps.yaml`, `orchestration/{up,reset-network,lib}.sh`, `orchestration/experiment.py`, `network/configtx/configtx.yaml` |
| 5 | **Idle batch timer.** `anchoring.idle_timeout_ms: 0` (0 = off) → batcher env `BATCH_IDLE_MS` (compose default 0): closes a batch that long after its last event (refreshed per event, no cap); `BATCH_FLUSH_MS` / `anchoring.flush_timeout_ms` is now the age timer (after the first event). experiment.py sets `BATCH_IDLE_MS` per run and records `controls.idleTimeoutMs`; cell flag `--idle-timeout-ms`. Only the sensitivity cell `idle-5s` uses it; size-only batching stays the default for every other run. | `services/merkle-batcher`, `network/compose/compose-services.yaml`, `benchmark/sweeps.yaml`, `orchestration/experiment.py` |
| 6 | **Every case audited.** `workload.audit_cases: 50` (≥ the largest case count; still capped at the run's case count). Audit time per event (`audit.json` `summary.msPerEvent`) is a report.py column, "audit time per event (ms)". | `benchmark/sweeps.yaml`, `orchestration/report.py` |
| 7 | **Fault-injection scripts.** `crash-test.sh` (batcher crash with an open batch) and `tamper-test.sh` (attacks on the receipt store), §6: functional tests with curl + jq + docker, not chaincode security tooling. | `orchestration/` |
| 8 | **Experiments.** E3a redesigned (block `e3a`: base ladder 100 … 1000 tx/s, 1,500 events per case per round, then the climb — §6); the top-level `send_rates_tps` is the ramp grid only; E3c new (block `e3c`: fixed per-case send rate, 5 tx/s per case); sens new (block `sensitivity`: `baseline`, `endorse-all`, `idle-5s`); E2 and the ramp stay runnable but are not part of the new campaigns. report.py adds e3c (X = cases, charts) and sens (X = cell, tables only), five columns at the end, and the E3a rule `e3a_verdict` (finalized throughput; Caliper's successful-only throughput for runs collected before the finalization records existed; `e3a-saturation.json` adds `keptUpToSendRateTps` and `generatorLimitSendRateTps`; flag `generator-limit`). The bench app's E3 tab runs e3a/e3b/e3c/ops/sens and edits `e3a.send_rates_tps` and `e3a.events_per_case_per_round`; the Settings tab edits `anchoring.idle_timeout_ms`. | `benchmark/sweeps.yaml`, `orchestration/experiment.py`, `orchestration/report.py`, `orchestration/benchapp.pyw`, `benchcore.py`, `benchhelp.py` |
| 9 | **Comment cleanup of the run.json-hashed configs** (`core.yaml`, `orderer.yaml`, the three compose files, `sweeps.yaml`). The cleanup changes comments only: `core.yaml` and `orderer.yaml` parse to identical data, but their blob SHAs, which every `run.json` records, differ from those of campaigns 1–5. | `network/`, `benchmark/sweeps.yaml` |
| 10 | **Reset race fixed.** `lib.sh wait_peer_grpc <org>` retries `peer channel list` in the cli container until the peer answers gRPC; `up.sh` calls it for org1 and org2 after the `/healthz` waits and before the first `peer lifecycle chaincode install` (a peer's operations `/healthz` can answer before its gRPC endpoint serves). 12 failed attempts in campaigns 1–5 came from this window. | `orchestration/lib.sh`, `orchestration/up.sh` |

**Tested:** unit suites green — gateway 55 tests (plus the 24-test library
integration suite, which needs `better-sqlite3` and does not load under the
development host's Node 26), merkle-batcher 11, verification 15,
receipt-store 8, benchmark 19; `test_experiment.py`, `test_benchapp.py` and
`collect.py --selftest` pass. **Live checks pending:** an E0 re-smoke of all
four variants, a 50-case Parallel-Anchored pilot, a 2-of-2 (`endorse-all`)
pilot, an E3a pilot of the climb, and one run each of `crash-test.sh` and
`tamper-test.sh`. The `AnchorPeers` genesis encoding was checked against
Fabric's release-2.5 source (`internal/configtxgen/encoder`,
`NewApplicationOrgGroup`; the branch head, not the `v2.5.15` tag), not yet on
a live network.

The library (M12–M16) still targets Standard and Anchoring only (CONTRACTS
§12-7): a library `CASE-<uuid>` id can never reach a Parallel-Anchored
channel, because `rootChannel` and `channelFor` require `case-NNN`.

**Known limits (stated, not fixed):**

- **Accepted is not finalized.** On the anchored variants a `202` means that
  the event waits in an open batch, which exists only in the batcher's
  memory. A batcher crash before the batch closes loses the event without a
  trace — no receipt, no trail entry, no root (`crash-test.sh`'s documented
  outcome). Finalization latency measures how long each accepted event stays
  in that state.
- **`pausedEvents`.** Under size-only batching an event left in an open batch
  when a round ends waits for the next round's events or the run-end flush.
  collect.py counts these events per round (their batch closed after the
  round's last submission), and their latency includes the pause. The idle
  timer of the sensitivity cell `idle-5s` bounds that wait.
- **Epoch reuse on a batcher restart.** A restarted or recreated container
  keeps `BATCH_EPOCH` from its environment (`.env`), numbers its batches
  from `b000000` again and can reuse batch ids that already have a root on
  the ledger; the write-once root key then rejects the new root, the batch is
  `degraded`, and its events fail verification as `root-mismatch` (their
  receipts name a batch whose on-chain root is another batch's).
  experiment.py writes a fresh epoch for every run, and every run starts on
  a fresh ledger by default, so a benchmark run is exposed only to a restart
  inside the run. A stack restarted outside experiment.py on a kept ledger
  (for example after a plain `down.sh`) still carries the last run's epoch.
  `crash-test.sh` reports whether its restart kept the epoch.
- **Anchor peers change every variant's gossip.** The configtx `AnchorPeers`
  give every new channel cross-org gossip, so the network of all four
  variants differs slightly from that of campaigns 1–5, and a comparison of
  the three unchanged variants with those campaigns is approximate.
