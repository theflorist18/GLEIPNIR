# GLEIPNIR

A four-variant blockchain chain-of-custody (B-CoC) benchmarking system on
**Hyperledger Fabric 2.5 LTS**, run locally via Docker. Two-author undergraduate
thesis project (BINUS Cyber Security): quantifying the latency-vs-storage tradeoff
of Merkle anchoring against Standard, Parallel, and Parallel-Anchored write paths.

Start here:

- `docs/ARCHITECTURE.md` — the binding architecture & build plan (module contracts,
  build order, milestones M1–M26).
- `docs/methodology/experiments.md` — the paper-facing experimental methodology
  (E0 pilot → E1 batch calibration → E2 channel calibration → E3 scalability + ops;
  supervisor brief 2026-09-22).
- `docs/CONTRACTS.md` — integration contracts: every cross-module name, port,
  channel, schema, and the normative Merkle spec + test vectors.
- `CLAUDE.md` — the implementation rulebook (pinned versions, terminology rules,
  semantic invariants).

## Layout

| Directory | What it is |
|---|---|
| `network/` | Fabric 2.5 config: configtx, core/orderer YAML, CA enrollment, compose files |
| `chaincode/evidence/` | Go chaincode — the four CoC ops + anchor-root ops (ccaas) |
| `services/merkle-batcher/` | off-chain batch accumulation + Merkle tree build |
| `services/receipt-store/` | leaf hash + sibling-path persistence (deliberately un-hardened) |
| `services/anchor-client/` | cross-channel root submission to the anchor channel |
| `services/verification/` | audit-latency path: fetch → recompute branch → verify root |
| `gateway/` | Node fabric-gateway BFF (REST), variant routing |
| `benchmark/` | Caliper 0.6.0 workspace: `sweeps.yaml` (single source of truth), seeded trace generator, trace-replay + per-op workloads, REST connector, audit-reconstruction harness, network configs |
| `frontend/` | React+Vite evidence-library SPA (login, cases, ingest, evidence detail) |
| `orchestration/` | up/down, per-case channel provisioning, ledger-only reset, `rounds.py`/`experiment.py` campaign driver (E0–E3 + ops), checkpoints, collect, report |
| `docs/` | architecture, contracts, as-built, methodology, audit record, research notes |

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
`e2` → `e3a` / `e3b` → `ops`, then `report.py --exp <E>`.

Build order and acceptance gates: `docs/ARCHITECTURE.md` §9. Do not skip milestones.

## Pinned stack

Fabric 2.5.15 · Caliper 0.6.0 · Node 20.19 · Go 1.25.5 · Fabric CA 1.5.19 ·
GoLevelDB (never CouchDB) · Docker Compose v2 · Ubuntu 22.04 LTS (or WSL2) host.
