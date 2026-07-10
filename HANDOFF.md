# GLEIPNIR — Handoff & Code-Audit Brief

> **For the auditing agent (Fable).** This document hands off the GLEIPNIR codebase for a
> full audit: verify everything builds/tests/runs, and find bugs, contract violations,
> terminology-ban violations, and cross-module integration mismatches. Read
> §0 → §1 → §8 first, then work the audit plan in §10.

---

## 0. Your mission & ground rules

**Goal:** confirm the system is correct and runnable, and surface anything that would break a
real run or violate the thesis's experimental controls.

**Read these before touching code (they are binding):**
1. `CLAUDE.md` — the rulebook: pinned versions, terminology bans, semantic invariants.
2. `docs/ARCHITECTURE.md` — the architecture & build plan (module contracts, milestones).
3. `docs/CONTRACTS.md` — the integration contract: every cross-module name, port, channel,
   schema, the SHA-256 Merkle spec + test vectors, and the decision record (§12).

**Do NOT** relax an invariant to make something pass. If a fix requires changing a
cross-module contract, flag it — don't silently drift (CLAUDE.md ground rule 2).

**Environment constraints on this host (Windows 11 + Docker Desktop):**
- The host runs an **HTTPS-inspecting proxy**. Host `npm`/`docker pull`/`git` work, but
  **in-container dependency fetches fail** with `x509: certificate signed by unknown authority`.
  Workaround already prepared: a host root-CA bundle at `C:\Users\LENOVO\gleipnir-ca-bundle.crt`.
  Mount it into containers that fetch over HTTPS (see §8, Go build). **Do not disable TLS
  verification** — mount the CA instead.
- Bash tool = **Git Bash** (POSIX). PowerShell is also available. `go` is **not** on the host
  PATH — build/test Go only in a `golang:1.25.5` container. Node is on the host (v24; target
  runtime is 20.19 — code must stay Node-20 compatible).

---

## 1. What GLEIPNIR is

A **four-variant blockchain chain-of-custody (B-CoC) benchmarking system** on **Hyperledger
Fabric 2.5.15 LTS**, run locally via Docker. It answers one research question: the
**latency-vs-storage tradeoff of Merkle anchoring**. The four variants differ **only in how
audit events are written to the ledger** — the chaincode interface, client API, and Caliper
workloads are identical across all four (this invariant is the core of the experiment):

1. **Standard** — one transaction per event on a shared channel (`coc-main`).
2. **Anchoring** — events batched off-chain (size N); only the Merkle root is committed; each
   event keeps an off-chain receipt (leaf + sibling path).
3. **Parallel** — one channel per case (`case-001`…), provisioned on demand.
4. **Parallel-Anchored** — per-case batching (size K) → roots committed to a dedicated
   **anchor channel** (`anchor-main`) by a fixed-identity anchor-client.

Two-author undergraduate thesis (BINUS Cyber Security).

---

## 2. Current status (as of this handoff)

**All ten module groups are authored and unit/build-verified. No live end-to-end run has been
done yet** (that needs the Docker network up — see §9). Committed milestone-by-milestone on
branch `main` (7 commits, `git log --oneline`).

| Module | Path | Verified how | Result |
|---|---|---|---|
| Chaincode | `chaincode/evidence/` | `go build` + `go vet` + tests in `golang:1.25.5` | **8/8 pass** |
| Merkle batcher | `services/merkle-batcher/` | `npm test` (node:test) | **8/8** |
| Receipt store | `services/receipt-store/` | `npm test` | **5/5** |
| Anchor-client | `services/anchor-client/` | `npm test` | **6/6** |
| Verification | `services/verification/` | `npm test` | **8/8** |
| Gateway | `gateway/` | `npm test` | **12/12** |
| Network | `network/` | yaml parse + `docker compose config` (base + parallel-anchored) + `bash -n` | clean |
| Benchmark | `benchmark/` | `caliper-cli@0.6.0` installs + `node --check` + yaml parse + `gen:rounds` | clean |
| Orchestration | `orchestration/` | `bash -n` + `py_compile` + `collect.py` math check | clean |
| Frontend | `frontend/` | `npm run build` (tsc --noEmit + vite build) | passes |

`core.yaml` / `orderer.yaml` were **extracted verbatim from the pinned 2.5.15 images** (then
minimally annotated: goleveldb pinned, `BootstrapMethod: none`, ban-comments neutralized).

---

## 3. Repository structure

```
Gleipnir/
├── CLAUDE.md                  # rulebook (binding)
├── HANDOFF.md                 # this file
├── README.md                  # top-level orientation
├── docs/
│   ├── ARCHITECTURE.md        # architecture & build plan (binding)
│   ├── CONTRACTS.md           # integration contract (binding) — READ §1,§3,§4,§6,§9,§12
│   └── research/              # VERIFIED version facts (Fabric 2.5, fabric-samples, Caliper 0.6.0)
├── chaincode/evidence/        # Go 1.25.5 ccaas contract (contract.go, model.go, keys.go, main.go, *_test.go)
├── services/
│   ├── merkle-batcher/        # off-chain batch → tree → root  (port 4001)
│   ├── receipt-store/         # leaf+path witness store        (port 4002)  [un-hardened by design]
│   ├── anchor-client/         # anchor-channel root sink        (port 4003)
│   └── verification/          # audit-latency metric path       (port 4004)
├── gateway/                   # Node BFF, fabric-gateway sessions + variant routing (port 3000)
├── benchmark/                 # Caliper 0.6.0 workspace (workload/, networks/, connectors/rest/, benchmarks/, sweeps.yaml)
├── frontend/                  # React+Vite SPA, 2 scopes (port 8081)
├── network/                   # Fabric config: configtx/, core.yaml, orderer.yaml, crypto/, compose/
└── orchestration/             # up/down, provisioning, checkpoints, sweep (bash + python)
```

**Every module has its own `README.md`** with: responsibility, public interface, inputs/outputs,
which variants use it, an explicit "Does NOT" list, and failure modes. Read the module README
before auditing that module.

---

## 4. Architecture & responsibilities (per module)

Dependency direction is one-way: **frontend → gateway → {fabric-gateway | services} → chaincode**.
The frontend never talks to Fabric directly; only the gateway (app channels) and anchor-client
(anchor channel) hold Fabric sessions.

- **`chaincode/evidence`** — deterministically persists CoC records + Merkle roots to world
  state; nothing else. Ops: `CreateEvidence`, `TransferCustody`, `AccessLog`, `RemoveEvidence`,
  `CommitAnchorRoot`, `ReadEvidence`, `GetAuditTrail`, `ReadAnchorRoot`. **MVCC-critical design:**
  head record `("evd",[id])` written only by the serial ops; events append under
  `("evt",[id, sortKey])` where `sortKey = zeroPad19(txTimestampNanos) + "-" + txID[:12]`;
  **`AccessLog` never reads/writes the head** → concurrent access-logging is conflict-free by
  construction. Deployed as a **chaincode-as-a-service** (honors the Go 1.25.5 pin).
- **`gateway`** — the only app-channel `@hyperledger/fabric-gateway` session holder. Encapsulates
  variant routing (`src/variantRouter.js`), computes RFC 6920 ni-URIs (`src/ni.js`, binaries
  discarded), static bearer auth, run-request store. Public API under `/api/v1` + internal
  `/internal/anchor-root` (the Anchoring root sink on `coc-main`).
- **`services/merkle-batcher`** — per-scope queues; at batch size N/K builds a SHA-256 tree
  (odd node **promoted**, never duplicated), PUTs receipts, submits the root (anchoring→gateway,
  parallel-anchored→anchor-client). Merkle code (`src/merkle.js`) must be byte-identical to the
  verification service and match CONTRACTS §4 vectors.
- **`services/receipt-store`** — one JSON file per event; **deliberately un-hardened** (no hash
  chains/signatures/replication — that weakness is a *measured property*, a stated caveat).
- **`services/anchor-client`** — the only `anchor-main` session, fixed `AnchorClientMSP` identity;
  submits `CommitAnchorRoot`. Roots keyed `(caseId, batchId)`.
- **`services/verification`** — GET `/verify/:eventId`: times fetch→recompute-branch→compare-root
  (the RQ2 metric). Does **not** verify signatures/schema (kept off the timed path by design).
- **`benchmark`** — Caliper 0.6.0. Four workloads (`fabric` + `rest` modes; `accessLog` has a
  `shared`-evidence gate). Custom `ConnectorBase` REST connector drives the gateway path.
  `sweeps.yaml` is the single source of truth for N/K/channels/load/repetitions.
- **`orchestration`** — `up.sh`/`down.sh`, `provision-channel.sh`, `checkpoint.py` (du storage),
  `collect.py` (successful-only throughput + config SHAs), `sweep.py`.
- **`frontend`** — Scope B (CoC demo: evidence card + audit trail + Merkle badge) and Scope A
  (operator dashboard: variant/sweep/run-control + charts). Talks only to `/api`.

---

## 5. The flows

**Write path per variant** (gateway `variantRouter`, CONTRACTS §9):

| Variant | write | root sink | verify source |
|---|---|---|---|
| standard | `submit` CreateEvidence on `coc-main` | — | — |
| anchoring | POST batcher `/events` | batcher→gateway `/internal/anchor-root`→`CommitAnchorRoot` on `coc-main` | gateway `/internal/anchor-root/...` |
| parallel | `submit` on `case-<id>` | — | — |
| parallel-anchored | POST batcher `/events` (per-case) | batcher→anchor-client `/roots`→`CommitAnchorRoot` on `anchor-main` | anchor-client `/roots/...` |

**Anchoring root flow:** `POST /api/v1/evidence` → gateway builds CoC event → `batcher /events`
→ (at size N) buildTree → `receipt-store PUT` each receipt → `gateway /internal/anchor-root`
→ `CommitAnchorRoot` on `coc-main` → re-PUT receipts with `txId`.

**Verification flow:** `verification GET /verify/:eventId` → receipt-store `GET` (fetch) →
fold `leafHash` up `siblingPath` (recompute) → read anchored root (gateway or anchor-client) →
compare. `ok:false + root-mismatch` is a tamper signal (HTTP 200, not an error).

**Provisioning flow (`up.sh`):** enroll crypto (CAs) → compose up → wait health →
`configtxgen -outputBlock` → `osnadmin channel join` on **all 3 orderer admin endpoints**
(assert HTTP 201) → `peer channel join` → package/install/approve/commit ccaas → start services.

**Metrics flow (`sweep.py`):** per cell → ensure channels → set batch size → `checkpoint.py t0`
→ run Caliper (tee `caliper.log`) → `checkpoint.py t1` → `collect.py` (manifest with
successful-only throughput + gitCommit + config blob SHAs).

---

## 6. Cross-module contract points to audit (the integration surface)

Verify these line up **exactly** (source of truth: `docs/CONTRACTS.md`):

- **Ports:** gateway 3000, batcher 4001, receipt-store 4002, anchor-client 4003, verification
  4004, frontend 8081; peers 7051/9051/11051 (cc 7052/9052/11052); orderers 7050/8050/9050
  (admin 7053/8053/9053); CAs 7054/8054/9054/10054. Cross-check every literal in
  `network/compose/*.yaml` against each service's `process.env` reads and CONTRACTS §1/§7.
- **Channels:** `coc-main`, `case-NNN`, `anchor-main`. Grep for any other channel name.
- **Chaincode function names + arg counts:** gateway `src/app.js` and benchmark `workload/*.js`
  must match `chaincode/evidence/contract.go` signatures exactly.
- **Anchor-root scope subtlety (verify this carefully):** the chaincode derives
  `scopeId = meta.caseId || "shared"`. The batcher's *anchoring* path sends `meta:{scopeId,...}`
  (no `caseId`), so the chaincode **defaults to `"shared"`** — which is correct *because
  anchoring is always shared scope*. The *parallel-anchored* path goes through the anchor-client,
  which injects `caseId`. Confirm both round-trip (store scope == verify query scope). This is a
  deliberate reliance on the default; check it isn't broken.
- **Env var names** must match CONTRACTS §7 byte-for-byte across compose and each service.

---

## 7. Invariants & terminology bans (audit checklist)

Run these greps (exclude `.git`, `node_modules`, `dist`, `docs/`, `CLAUDE.md`, `HANDOFF.md`
which legitimately quote the bans):

- **`"system channel"`** — must NOT appear (it's the "anchor channel"). *Known allowed hits:*
  the bans/docs stating the rule.
- **`couchdb`** — must NOT appear (GoLevelDB only). The stock sampleconfig CouchDB block was
  removed from `core.yaml`; confirm none crept back.
- **`lockb0x`** — only as a conceptual-reference attribution in prose; no code/deps/labels.
- **`poseidon` / `zk` / `rollup` / `opentimestamps` / `CASE`/`UCO`/`jsonld`** — scope creep, must
  not appear.

**Semantic invariants to confirm by reading code:**
- `AccessLog` in `contract.go` does not read or write the head key.
- No client-side MVCC retry loop anywhere (conflict avoidance is structural).
- receipt-store has no hash chains / signatures / replication.
- Evidence binaries never persisted (gateway hashes `payloadBase64` then discards; batcher/
  receipts store hashes only).
- Merkle: SHA-256, odd-node **promote**, identical in `merkle-batcher` and `verification`, and
  both pin the CONTRACTS §4 vectors (root `c859dbaf0c89a0c3d8acd14558d491171dd4381073d79935182301300d296d2f`).
- Chaincode determinism: timestamps come from `GetTxTimestamp` (not wall clock), no map-iteration
  order leaking into stored/returned bytes.

---

## 8. How to build & verify each module (exact commands)

Host prereqs for a full run: Docker Desktop, Node 20+, Python 3.10+ with `pyyaml`, and (for a
live network) `fabric-ca-client` 1.5.x, `jq`, `curl`.

**Chaincode (Go — needs the CA bundle because of the host proxy):**
```powershell
docker run --rm `
  -v C:\theflorist18\Gleipnir\chaincode\evidence:/src -v gleipnir-gocache:/go `
  -v C:\Users\LENOVO\gleipnir-ca-bundle.crt:/certs/ca.crt:ro -w /src `
  -e "SSL_CERT_FILE=/certs/ca.crt" -e "GIT_SSL_CAINFO=/certs/ca.crt" `
  golang:1.25.5 sh -c "go build ./... && go vet ./... && go test ./... -v"
```
(If the CA bundle is missing, regenerate it: export `Cert:\LocalMachine\Root` + `Cert:\CurrentUser\Root`
to a PEM — see the `host-mitm-proxy-ca` memory.)

**Node services + gateway (run on the HOST — no CA workaround needed):**
```powershell
# per dir: services/merkle-batcher, services/receipt-store, services/anchor-client,
#          services/verification, gateway
npm install ; npm test
```

**Frontend:**
```powershell
cd frontend ; npm install ; npm run build   # tsc --noEmit + vite build must pass
```

**Network (no live network needed):**
```powershell
python -c "import yaml,glob; [list(yaml.safe_load_all(open(f,encoding='utf-8'))) for f in glob.glob('network/**/*.yaml',recursive=True)]"
docker compose --project-directory network/compose `
  -f network/compose/compose-net.yaml -f network/compose/compose-ca.yaml `
  -f network/compose/compose-services.yaml config -q
# add: --profile parallel-anchored  to validate the anchor-org services too
bash -n network/crypto/registerEnroll.sh
```

**Benchmark:**
```powershell
cd benchmark ; npm install ; npm run gen:rounds
# node --check every workload/connector JS; yaml.safe_load every config
```

**Orchestration:**
```bash
cd orchestration
for f in *.sh; do bash -n "$f"; done
for f in *.py; do python -m py_compile "$f"; done
```

**Attempt a live run (the part not yet done — this is the real integration test):**
```bash
# Building the service/chaincode IMAGES on this host needs the CA bundle; configure
# docker build to trust it, or build on a host without the proxy. Then:
./orchestration/up.sh --variant standard
./orchestration/smoke-standard.sh      # create→transfer→access×2→audit(==4)→remove→transfer-fails
./orchestration/down.sh --wipe
```

---

## 9. Known gaps & things to scrutinize (be skeptical here)

These are the weak spots — prioritize them:

1. **No live end-to-end run has happened.** Bring-up, channel creation (osnadmin 201),
   ccaas install/approve/commit, and Caliper runs are **verified only by syntax/config checks**,
   not execution. The highest-value audit work is getting `up.sh --variant standard` +
   `smoke-standard.sh` actually green.
2. **CCaaS package-id wiring:** `up.sh` writes `CCAAS_ID_APP` into `network/compose/.env` and
   recreates `ccaas-evidence`. Confirm the timing (server up with the right id before commit) and
   that `calculatepackageid` output is captured cleanly (it does `| tail -1 | tr -d '\r'`).
3. **Keystore path assumption:** `registerEnroll.sh` copies the CA-enrolled key to
   `keystore/priv_sk` for the client identities Caliper references. Verify the copy logic and
   that `benchmark/networks/coc-main.yaml` points at the real files (`signcerts/cert.pem`,
   `keystore/priv_sk`).
4. **Image builds under the proxy:** `docker build` of the Node/Go images will hit the same TLS
   MITM issue on this host. The Dockerfiles are clean/standard (correct for a normal host);
   building here needs a CA-trust build arg or a proxy-free host. Flag if you consider this a blocker.
5. **Demo verify button:** frontend `verifyEvidence(id)` passes the *evidenceId*; the gateway/
   verification contract is keyed by *eventId*. The verification **service** is correct and tested;
   the demo button is a known UX gap, not a service bug. Confirm and decide if worth fixing.
6. **Caliper REST connector `TxStatus` timing** (`benchmark/connectors/rest/index.js`) is written
   to the 0.6.0 "Writing Connectors" spec but **not runtime-verified** (no Caliper run here).
   Check `_sendSingleRequest` sets start (`new TxStatus()`) + `SetTimeFinal` + success/fail.
7. **Frontend bundle** is ~540 kB (recharts) — a chunk-size *warning*, not an error.
8. **`collect.py` parses `caliper.log`** (the tee'd table), computing successful-only throughput as
   `reported × Succ/(Succ+Fail)`. Verify the table-column parsing matches Caliper 0.6.0's actual
   log format when you do a live run.

---

## 10. Suggested audit plan (ordered)

1. **Read** CLAUDE.md, ARCHITECTURE.md, CONTRACTS.md (§1,§3,§4,§6,§9,§12).
2. **Static invariant/ban sweep** (§7) — fast, catches thesis-breaking issues.
3. **Re-run every module's tests/build** (§8) — confirm the "verified" claims reproduce.
4. **Cross-module contract check** (§6) — trace ports/channels/function-args/env end-to-end.
5. **Scrutinize the known gaps** (§9), especially the anchor-root scope round-trip and ccaas wiring.
6. **Attempt a live run** (§8 last block) — `up.sh --variant standard` + `smoke-standard.sh`.
   This is the real proof. Expect to debug crypto paths / ccaas / osnadmin here; that's the point.
7. **Report:** what passed, what's broken (with file:line), and a go/no-go for a first benchmark.

---

### Appendix: pinned versions (never substitute)

Fabric 2.5.15 · Fabric CA 1.5.19 · Caliper 0.6.0 (bind `fabric:fabric-gateway`) · Node 20.19 ·
Go 1.25.5 · `@hyperledger/fabric-gateway` 1.11.0 (services) · `fabric-contract-api-go/v2` 2.2.1 ·
GoLevelDB (never CouchDB) · Docker Compose v2. Full sourcing in `docs/research/*.md`.
