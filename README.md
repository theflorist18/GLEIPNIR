# GLEIPNIR

A four-variant blockchain chain-of-custody (B-CoC) benchmarking system on
**Hyperledger Fabric 2.5 LTS**, run locally via Docker. Two-author undergraduate
thesis project (BINUS Cyber Security): quantifying the latency-vs-storage tradeoff
of Merkle anchoring against Standard, Parallel, and Parallel-Anchored write paths.

## Docs map (read in this order)

| Document | What it is |
|---|---|
| `docs/STATUS.md` | **Where things stand**: live environment, how to run, next steps, open decisions, rules that bit us. One living file, updated in place — no dated handoffs. |
| `docs/ARCHITECTURE.md` | The binding architecture & build plan (module contracts, build order, milestones M1–M27). |
| `docs/CONTRACTS.md` | Integration contracts: every cross-module name, port, channel, schema, the normative Merkle spec + test vectors, and the decision record (§12). |
| `docs/AS-BUILT.md` | The system as implemented: modules, dependencies, ports, data flows. Descriptive, not normative. |
| `docs/methodology/experiments.md` | Paper-facing experimental methodology (E0 pilot → E1 batch calibration → E2 channel calibration → E3 scalability + per-operation breakdown). |
| `docs/supervisor-brief-2026-09-22.md` | The supervisor's consolidated guidance (Discord thread + call) that mandated the M26 redesign. Governing input; not edited. |
| `docs/reviews/` | Dated verification & review records: `REPORT.md` (static code audit F1–F76 + live E2E), `security-review.md` (S1–S20), `owasp-top10-review.md` (N1–N6), `backend-review.md`, `ux-review.md`, `audit-log-live-verification.md`, `steady-state-campaign.md` (the pre-M26 July 2026 campaign; its grids are superseded), and `campaign-readiness-2026-09-30.md` (the pre-ramp readiness audit R1–R17 + E0 re-smoke). |
| `docs/research/` | Verified digests of Fabric 2.5 / Caliper 0.6.0 / fabric-samples facts (2026-07-03), cited from code comments. |
| `docs/design/` | The brief sent to Claude Design plus its exported boards (`claude-design/*.dc.html`); the web tokens, icons and fonts in `frontend/` came from them. |
| `CLAUDE.md` | The implementation rulebook for AI-assisted sessions (pinned versions, terminology rules, semantic invariants). **Local and gitignored** by author decision (`a935b30`). |

Every module directory has its own README: responsibility, interface, what it does NOT do, failure modes.

## Layout

| Directory | What it is |
|---|---|
| `network/` | Fabric 2.5 config: configtx, core/orderer YAML, CA enrollment, compose files |
| `chaincode/evidence/` | Go chaincode — the four CoC ops + anchor-root ops (ccaas) |
| `services/merkle-batcher/` | off-chain batch accumulation + Merkle tree build |
| `services/receipt-store/` | leaf hash + sibling-path persistence (deliberately un-hardened) |
| `services/anchor-client/` | cross-channel root submission to the anchor channel |
| `services/verification/` | audit-latency path: fetch → recompute branch → verify root |
| `services/case-registry/` | evidence library: off-chain Case entity + evidence read-model (SQLite) |
| `services/evidence-store/` | evidence library: immutable off-chain evidence blobs + ni-URI proofs |
| `gateway/` | Node fabric-gateway BFF (REST), auth/roles, variant routing |
| `benchmark/` | Caliper 0.6.0 workspace: `sweeps.yaml` (single source of truth), seeded trace generator, trace-replay + per-op workloads, REST connector, audit-reconstruction harness, network configs |
| `frontend/` | React+Vite evidence-library SPA (login, cases, ingest, evidence detail, CoC report) |
| `orchestration/` | up/down, per-case channel provisioning, ledger-only reset, volume backup, `build-images.sh` (proxy-CA image build), `rounds.py`/`experiment.py` campaign driver (E0–E3 + ops), checkpoints, collect, report, `benchapp.pyw` desktop app |
| `docs/` | see the docs map above |

## Quickstart

```bash
# variant ∈ standard | anchoring | parallel | parallel-anchored
./orchestration/up.sh --variant standard
./orchestration/smoke-standard.sh          # create → transfer → access → audit → dispose (DISPOSED)
python orchestration/experiment.py --exp e0 --dry-run   # print the pilot plan
python orchestration/experiment.py --exp cell --variant parallel --send-rate 50 --cases 10 --dry-run  # one cell at your own levels (parallel: 1 channel per case)
./orchestration/down.sh                    # volumes kept; --wipe only with the authors' go-ahead
```

Campaign order (one fresh ledger per run via `reset-network.sh`, which needs
`GLEIPNIR_ALLOW_LEDGER_WIPE=1`): `experiment.py --exp e0` → `ramp` → `e1` →
`e2` → `e3a` / `e3b` → `ops`, then `report.py --exp <E>`. The desktop app
`orchestration/benchapp.pyw` drives the same driver from Windows through WSL.

Build order and acceptance gates: `docs/ARCHITECTURE.md` §9. Do not skip milestones.

## Pinned stack

Fabric 2.5.15 · Caliper 0.6.0 · Node 20.19 · Go 1.25.5 · Fabric CA 1.5.19 ·
GoLevelDB (never CouchDB) · Docker Compose v2 · Ubuntu 22.04 LTS (or WSL2) host.
