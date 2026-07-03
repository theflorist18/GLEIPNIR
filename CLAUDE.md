# CLAUDE.md — GLEIPNIR Implementation Instructions

You are implementing GLEIPNIR: a four-variant benchmark of blockchain-based
chain-of-custody (B-CoC) architectures on a single Hyperledger Fabric 2.5 LTS
substrate, measured with Hyperledger Caliper. Local, single-host, Docker-based.
This repo supports a two-author undergraduate thesis (BINUS, Cyber Security).
The full architecture and build plan is in `docs/ARCHITECTURE.md` — read it
before implementing any module. This file is the short rulebook.

## Ground rules

1. Implement milestone-by-milestone in the order given in
   `docs/ARCHITECTURE.md` §Build Order. Do not skip ahead.
2. Per-module interface contracts in `docs/ARCHITECTURE.md` are **binding**.
   If an implementation genuinely requires a contract change, STOP and ask —
   never drift silently.
3. Every module must be independently understandable: one responsibility,
   its own README, no reaching into another module's internals. A developer
   debugging one function should only need to read that module.
4. Your Fabric training data is stale. Verify anything you "remember" about
   Fabric/Caliper against the pinned versions below before using it.

## Pinned stack — never substitute versions

| Component            | Version                          |
|----------------------|----------------------------------|
| Hyperledger Fabric   | 2.5.15                           |
| Hyperledger Caliper  | 0.6.0 (CLI pinned)               |
| Node.js              | 20.19                            |
| Go (chaincode)       | 1.25.5                           |
| Fabric CA            | 1.5.19                           |
| Docker               | Engine 29.5.2 + Compose v2       |
| OS                   | Ubuntu 22.04 LTS                 |
| World state          | GoLevelDB — **never add CouchDB**|
| Client library       | @hyperledger/fabric-gateway      |

Topology: two peer organisations, Raft (etcdraft) ordering. GoLevelDB means
key-value access only — do not write chaincode that needs rich queries.

## Terminology bans — enforced in code, comments, YAML, script names, logs

- **Never** "system channel". Always **"anchor channel"** (or "audit channel").
  Fabric 2.5 uses the channel-participation API; the system channel is removed
  in Fabric 3.0. This ban covers YAML comments and shell script names too.
- **lockb0x** (stylised with a zero) is a *conceptual reference for the Codex
  Entry evidence-record schema and evidence-card UI idiom only*. No lockb0x
  code, no lockb0x dependencies, no "on lockb0x" labels in any diagram or
  string. The build substrate is Fabric 2.5 LTS, full stop.

## The four variants

The variant changes **only how audit events are written to the ledger**.
The chaincode interface, the client API, and the Caliper workload modules are
identical across all four. This invariant is the core of the experimental
design — violating it invalidates the thesis's like-for-like comparison.

1. **Standard** — single shared channel; one transaction per event. Baseline.
2. **Anchoring** — single channel + off-chain Merkle batcher + receipt store.
   Events batched off-chain (batch size N); only the Merkle root + minimal
   metadata committed on-chain. Each event keeps an off-chain receipt: leaf
   hash + O(log₂N) sibling path. Verification = fetch event → recompute
   branch → verify root against the on-chain root.
3. **Parallel** — one Fabric channel per case; automated provisioning via
   `osnadmin channel join` + chaincode install/approve/commit per channel.
4. **Parallel-Anchored** — per-case channels + per-case Merkle batching
   (batch size K); per-case roots committed to the dedicated **anchor
   channel** by an off-chain **anchor-client** (chaincode in one channel
   cannot write to another). Anchor-client identity, MSP, and endorsement
   policy are fixed constants across all runs.

## Sweep constants — one config file, no scattered literals

All sweep values live in a single versioned config (e.g.
`benchmark/sweeps.yaml`) and are imported everywhere else:

- Anchoring batch size: `N ∈ {10, 50, 100, 250}`
- Parallel-Anchored batch size: `K ∈ {5, 10, 25, 50}`
- Channel count: `{1, 2, 5}` — **10 is deliberately cut** (single host).

Two workload regimes, kept distinct in code and output labels:
- **Smoke test**: 10 cases × 10–25 logs. Functional correctness only.
  Output artifacts must be labelled `smoke`, never mixed with benchmark data.
- **Steady state**: ≥ 10³ events per channel. The only regime from which
  performance/scalability numbers are reported. Includes an N-runs
  repetition loop for statistical validity.

## Semantic invariants — do not "improve" these away

- **Evidence binaries are always off-chain, in every variant.** What varies
  is whether audit *event records* go directly on-chain or are Merkle-
  anchored. Never build on-chain binary storage.
- **The receipt store must NOT be hardened.** Its weaker-than-on-chain
  integrity guarantee is a *measured property of the design* and a stated
  thesis caveat (availability exposure of the witness, not integrity
  exposure of the ledger). Do not add hash chains, replication, or
  signatures to receipts. If you feel the urge, that urge is the finding.
- **Anchoring is plain Merkle-root anchoring.** No ZK proofs, no rollup
  sequencer, no Poseidon hashes. SHA-256 Merkle trees, sibling-path
  verification, nothing fancier.
- **MVCC conflicts on concurrent access-log writes** are handled by the
  per-record event sub-key design `(evidenceId, monotonicCounter)` — a
  composite key per event, not writes to one shared record key. Do not
  substitute client-side retry loops; conflict avoidance is structural.

## Chaincode (Go)

Exactly four operations: `CreateEvidence`, `TransferCustody`, `AccessLog`,
`RemoveEvidence`. Record schema is Codex-Entry-inspired (see
`docs/ARCHITECTURE.md`). Each operation carries an ISO/IEC 27037 clause
annotation as a code comment — keep these when refactoring.

## Metrics contract

Collected per run, at stable paths, machine-readable:

- Offered load (Caliper rate-controller setting)
- Throughput — per-channel **and** aggregate for Parallel variants
- Latency min/avg/max (submit-to-commit write latency, Caliper)
- **Verification/audit latency** — a first-class measured metric: time to
  fetch event → recompute Merkle branch → verify root. Required for the
  Anchoring variants; the thesis's RQ2 cannot be answered without it.
- Success rate with failure-mode breakdown
- Ledger size per channel + GoLevelDB state size — `du` at defined
  checkpoints against **named Docker volumes at stable mount paths**
  (never anonymous volumes; the paths are part of the measurement design)
- Byte-per-log via linear regression over the checkpoint series

Storage compression is computed as reduction in log-**payload** bytes vs
Standard — never report it as a clean 1/N of total ledger size.

## Repository discipline

- `network/configtx.yaml`, `core.yaml`, `orderer.yaml` are version-controlled
  from the **first** commit. The thesis references them by commit SHA.
  **Never rewrite history** (no force-push, no rebase of pushed commits) —
  a rewritten SHA invalidates a citation in the paper.
- One meaningful commit (or small series) per milestone, message referencing
  the milestone ID from `docs/ARCHITECTURE.md`.
- Every service module gets its own README: responsibility, interface,
  what it explicitly does NOT do, failure modes.

## Stale-knowledge traps — check these, do not recall them

- **Channel creation**: `osnadmin channel join` via the channel-participation
  API only. No `configtxgen`-generated system-channel genesis flows, no
  legacy `peer channel create` bootstrap from old tutorials.
- **Caliper binding**: pin CLI to 0.6.0 and record the exact
  `caliper bind` SUT/SDK binding string used in `benchmark/README.md`.
  Binding strings changed across Caliper releases; a from-memory binding
  is the most likely first failure. Verify against Caliper 0.6.0 docs.
- **fabric-gateway**: use the `@hyperledger/fabric-gateway` API (Gateway →
  Network → Contract, gRPC connection managed by the client), not the
  legacy `fabric-network` SDK patterns.
- **fabric-samples**: any test-network material you recall must be checked
  against the 2.5.x release branch before reuse.

## Do NOT build (deferred scope — do not scope-creep into it)

- OpenTimestamps / any public-chain anchoring
- CASE/UCO JSON-LD emitter or validator (claim is dropped from the paper
  unless the author explicitly reopens it)
- Cross-channel evidence transfer
- 10-channel Parallel sweep
- IoT evidence ingestion
- Chaincode-level smart-contract security auditing tooling
- Any authentication/authorisation beyond the minimal local-dev setup
  specified in `docs/ARCHITECTURE.md`

If a task seems to require one of these, stop and ask.

## Frontend

Two scopes, per `docs/ARCHITECTURE.md`: (a) operator dashboard — variant
selection, sweep configuration, run start/stop, live status, metric charts,
run history; (b) CoC demo UI — create evidence, transfer custody, log
access, per-evidence audit trail with Merkle verification status. Simple
and usable beats clever. The frontend talks **only** to the API gateway,
never directly to Fabric.

## When in doubt

Prefer asking over assuming. The thesis's credibility rests on the
experimental controls in this file; a "helpful" deviation that breaks an
invariant costs more than a paused session.
