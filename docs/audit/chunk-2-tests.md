# Chunk 2 — Module build/test re-verification

Date: 2026-07-05 · Session: chunk 2 of the audit plan
(`C:\Users\LENOVO\.claude\plans\okay-since-i-am-shimmering-squirrel.md`)

**Goal:** reproduce every "verified" claim in HANDOFF §2. Two lanes, main-thread:
Lane A = chaincode in `golang:1.25.5` (Docker), Lane B = everything else on the host.

## Verdict summary

**All 10 module groups reproduce their HANDOFF §2 claims exactly. 0 blockers, 0 bugs,
0 contract-drifts found this chunk; 5 notes (F18–F22).** Total re-run test count:
**47/47 pass** (8 Go + 39 Node) plus all syntax/config checks clean. The in-container
TLS canary for chunk 7 was explicitly exercised and passes.

## Per-module results vs HANDOFF §2 claims

| Module | HANDOFF claim | Re-run result | Match |
|---|---|---|---|
| Chaincode `chaincode/evidence/` | 8/8 (go build+vet+test in golang:1.25.5) | `go vet ./... && go test ./... -v` → vet clean, **8/8 PASS** (`TestCreateReadRoundtrip`, `TestDuplicateCreateRejected`, `TestTransferUpdatesCustodian`, `TestConcurrentAccessLogDistinctKeys`, `TestRemoveIsTerminal`, `TestAuditTrailOrdering`, `TestAnchorRootScopeDefaultAndDuplicate`, `TestCreateRejectsBadCodex`) | ☑ |
| Merkle batcher `services/merkle-batcher/` | 8/8 | `npm test` → **8 pass / 0 fail** (incl. V1/V2 normative vectors + batch-size 1..9 property test) | ☑ |
| Receipt store `services/receipt-store/` | 5/5 | `npm test` → **5 pass / 0 fail** | ☑ |
| Anchor-client `services/anchor-client/` | 6/6 | `npm test` → **6 pass / 0 fail** (incl. caseId injection into metaJSON) | ☑ |
| Verification `services/verification/` | 8/8 | `npm test` → **8 pass / 0 fail** (incl. tamper→`ok:false root-mismatch`=200) | ☑ |
| Gateway `gateway/` | 12/12 | `npm test` → **12 pass / 0 fail** (all four variant routes exercised) | ☑ |
| Network `network/` | yaml + compose config + bash -n clean | 6/6 YAML parse (`core.yaml`, `orderer.yaml`, 3× compose, `configtx.yaml`); `docker compose config -q` **OK for base AND `--profile parallel-anchored`**; `bash -n network/crypto/registerEnroll.sh` clean | ☑ |
| Benchmark `benchmark/` | caliper installs + node --check + yaml + gen:rounds | `npx caliper --version` → **0.6.0** (pin holds); `node --check` 6/6 JS (`workload/{accessLog,createEvidence,transferCustody,verify}.js`, `workload/lib/payloads.js`, `connectors/rest/index.js`); YAML parse 11/11; `npm run gen:rounds` → "generated steady-standard.yaml + steady-anchoring.yaml from sweeps.yaml (loads: 25, 50, 100 tps)" | ☑ |
| Orchestration `orchestration/` | bash -n + py_compile clean | `bash -n` 6/6 (`down.sh`, `lib.sh`, `provision-channel.sh`, `smoke-standard.sh`, `teardown-channel.sh`, `up.sh`); `py_compile` 3/3 (`checkpoint.py`, `collect.py`, `sweep.py`) | ☑ |
| Frontend `frontend/` | `npm run build` passes | `tsc --noEmit && vite build` → **passes**, 833 modules, `dist/assets/index-*.js` 542.89 kB (chunk-size *warning* only — known, HANDOFF §9.7) | ☑ |

Post-run `git status --porcelain`: only the known untracked files (`HANDOFF.md`,
`Pre-Thesis Paper.*`, `docs/audit/`) — **no build/gen step modified any tracked file**,
i.e. the committed `steady-standard.yaml`/`steady-anchoring.yaml` are byte-identical to
what `gen:rounds` regenerates from `sweeps.yaml` (no drift).

## Chunk-7 TLS canary (explicitly exercised)

The chaincode test run completed against a warm `gleipnir-gocache` volume, so it did
**not** touch the network. A separate cold canary was run in `golang:1.25.5` with only
the CA bundle mounted (`C:\Users\LENOVO\gleipnir-ca-bundle.crt` →
`SSL_CERT_FILE`/`GIT_SSL_CAINFO`):

- `git ls-remote https://github.com/hyperledger/fabric.git` → **OK**
- cold `go get github.com/pkg/errors@v0.9.1` (proxy.golang.org + sum.golang.org) → **OK**

**In-container HTTPS through the host MITM proxy works with the CA bundle mounted.**
Chunk 7's image-build/dep-fetch precondition is confirmed viable (no TLS-disable needed).

## Findings (notes only; numbering continues from chunk 1's F17)

### Note

- **F18 · Debian/GnuTLS `wget` inside `golang:1.25.5` IGNORES `SSL_CERT_FILE`** (first
  canary attempt via wget failed exit 5; git/go with the same mount succeed). Chunk-7
  relevance: any Dockerfile step or health-check that fetches via `wget` will fail
  under the proxy even with the CA env vars set — use `curl`/`go`/`git` (which honor
  the vars) or pass `--ca-certificate=/certs/ca.crt` to wget explicitly.
- **F19 · Host toolchain used for Lane B: Node v24.11.1 / npm 11.6.2** (target runtime is
  20.19). All suites pass on v24 — same caveat as the original verification: Node-20
  compatibility is asserted by code style, not proven by these runs. A Node-20 run
  happens implicitly in chunk 7 (service Docker images are node:20-based).
- **F20 · `gen:rounds` regenerates only `steady-standard.yaml` + `steady-anchoring.yaml`.**
  `steady-parallel.yaml`, `steady-parallel-anchored.yaml`, `steady-verify.yaml`,
  `smoke-standard.yaml` are hand-maintained → the "sweeps.yaml is the single source of
  truth" rule is only partially mechanised. Hand-check the parallel/verify round values
  against `sweeps.yaml` in chunk 3 (tracer 5 already covers §10).
- **F21 · Chaincode go-test run used the warm `gleipnir-gocache` volume** — module
  fetches were not re-exercised by the test itself (covered instead by the explicit
  cold canary above). If the volume is ever wiped, first run re-downloads through the
  proxy and needs the CA mount (HANDOFF §8 command already includes it).
- **F22 · Docker daemon was down at session start** (plan predicted this). Started
  Docker Desktop 27.5.1; `docker compose config -q` and all container runs then clean.
  Chunk 7 must budget for daemon startup time.

## Reproduction commands

Exactly HANDOFF §8, with one deviation per plan/F1: chaincode lane ran
`go vet ./... && go test ./... -v` (no bare `go build`, to avoid regenerating the
committed-ELF artifact). Compose validation ran both base and
`--profile parallel-anchored` invocations. TLS canary:

```powershell
docker run --rm -v C:\Users\LENOVO\gleipnir-ca-bundle.crt:/certs/ca.crt:ro `
  -e "SSL_CERT_FILE=/certs/ca.crt" -e "GIT_SSL_CAINFO=/certs/ca.crt" golang:1.25.5 `
  sh -c "git ls-remote https://github.com/hyperledger/fabric.git HEAD && mkdir /tmp/m && cd /tmp/m && go mod init canary && go get github.com/pkg/errors@v0.9.1"
```

## Handoff to next chunks

- **Chunk 3:** F20 — verify hand-maintained benchmark round YAMLs against `sweeps.yaml`.
- **Chunk 7:** TLS canary green (this chunk); mind F18 (wget) and F22 (daemon startup);
  gocache volume `gleipnir-gocache` exists and is warm.
- No fixes required from this chunk; nothing to add to the chunk-6 fix list beyond
  what chunk 1 already recorded.
