# Steady-state campaign — roll-up (all four variants)

Date: 2026-07-21/22 · Regime: steady (≥1000 events/channel, 3 repetitions) · Host: single-host
Ubuntu-22.04 WSL. `benchmark/results/` is gitignored, so the per-variant notes in this
directory are the committed record of the numbers; the raw manifests/logs live locally.

## Run inventory (108 Caliper launches, all valid)

| Variant | Cells | Write | Verify | Note |
|---|---|---:|---:|---|
| Standard | base | 3 | – | [steady-standard-baseline.md](steady-standard-baseline.md) |
| Anchoring | N∈{10,50,100,250} | 12 | 12 | [steady-anchoring.md](steady-anchoring.md) |
| Parallel | channels∈{1,2,5} | 9 | – | [steady-parallel.md](steady-parallel.md) |
| Parallel-Anchored | K∈{5,10,25,50}×channels∈{1,2,5} | 36 | 36 | [steady-parallel-anchored.md](steady-parallel-anchored.md) |

`writeOk` and `verifyOk` are 100% for every variant; MVCC_READ_CONFLICT = 0 across all 108
runs (validates the structural `(evidenceId, monotonicCounter)` sub-key design).

## Commit lineage (reproducibility)

The six config files `collect.py` stamps (`configtx.yaml`, `core.yaml`, `orderer.yaml`,
`compose-net/ca/services.yaml`) are **byte-identical across the whole campaign** — that is the
citable reproducibility anchor. The top-level `gitCommit` differs per phase only because bugs
were fixed *between* variants (none touched a stamped config):

- Standard ran at `e1b3902`; a docs commit advanced HEAD to `f532d95`.
- Anchoring ran at `f838856` (after the verify-metrics volume-permission fix).
- Parallel + Parallel-Anchored ran at `c07dbc0`/`3ac73e9` (after the c>1 provisioning fixes).
- Parallel-Anchored storage re-collected at `28c9c32` (the anchor-main bytes/event fix).

## Bugs found and fixed *by executing* the campaign

The sweeps were not just data collection — running them surfaced defects that the smoke tests
(c1 only, no steady load) never could:

1. **verify-metrics volume mounted root-owned** (`f838856`) — RQ2 capture would have been
   silently empty for every anchoring/PA verify run. Caught by a pre-sweep write probe.
2. **caliper-fabric contract-id collision at c>1** (`c07dbc0`) — duplicate `id: evidence`
   across channels aborted every multi-channel run at config parse.
3. **CCaaS package-id mismatch at c>1** (`c07dbc0`) — `package_ccaas` is non-deterministic
   (gzip timestamp), so provisioned channels committed an id no ccaas served → endorsement
   DEADLINE_EXCEEDED.
4. **anchor-main excluded from bytes/event** (`28c9c32`) — Parallel-Anchored compression read
   0 (→ nonsense 100%) because the metric summed only the empty case channels.

Plus `--resume` (`3ac73e9`) to recover the parallel-anchored sweep after a forced shutdown at
90%. F76's `assert_collected` (Chunk 7) is what made #2/#3 abort loudly instead of banking
empty cells — the gate paid for itself.

## Headline cross-variant results

### RQ1 — on-chain storage (bytes/event, vs Standard baseline 4716.95)

| | Standard | Anchoring | Parallel | Parallel-Anchored |
|---|---:|---:|---:|---:|
| batch | – | N=10→250 | – | K=5→50 |
| B/event | 4717 | 423 → 21 | ~4500 | 862 → 94 |
| reduction | 0 (baseline) | 91.0 % → 99.6 % | ~0 % | 81.7 % → 98.0 % |

Anchoring and Parallel-Anchored collapse on-chain cost ~1/batch; the off-chain receipt store
grows to match (measured, not modelled). Parallel commits one tx per event like Standard, so
it does **not** compress — its axis is throughput/latency, not storage. (Compression is the
reduction in on-chain payload bytes/event, never 1/N of total ledger — CLAUDE.md contract.)

### RQ2 — verification-latency decomposition (the reason the step-capture exists)

Across every Anchoring and Parallel-Anchored cell, the per-request breakdown shows the same
structure: **`compareRootMs` (the on-chain anchored-root read) dominates total verify latency
(~70–85 %)**, while Merkle **recomputation is negligible (~0.2 %) and grows only O(log₂batch)**.
So the cost of verifying an anchored event is the ledger read, not the cryptography — a
finding aggregate Caliper latency cannot produce.

### Parallel throughput/latency (honest caveat)

At the swept loads (25/50/100 tps aggregate) a single channel is not saturated, so splitting
across channels does not raise aggregate throughput and *raises* latency (0.24 → 0.95 s at
25 tps for c1 → c5) from single-host Raft coordination overhead. The parallel throughput
benefit needs a single-channel-saturating regime, above this campaign's range.

## Status
All four variants collected; RQ1 (storage/compression) and RQ2 (verification latency, with
step attribution) answered. All follow-ups since closed: the Chunk-4b security items
(async scrypt, auto-log rate limit, content sniffing, list caps, DELETE token — commit
`bb319b8`) and `package_ccaas` determinism (`8a419e7` — the package id is now byte-reproducible
from the cited commit; an independent packaging run reproduces up.sh's live `CCAAS_ID_APP`
exactly). None affected any campaign number (Caliper uses the service token + JSON path).
