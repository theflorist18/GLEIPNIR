# Steady-state — Parallel-Anchored variant (K ∈ {5,10,25,50} × channels ∈ {1,2,5})

Date: 2026-07-22 · Commits: writes at `c07dbc0`/`3ac73e9`, storage re-collected at `28c9c32`
· Regime: steady · **36 write + 36 verify runs, all valid** (`writeOk 36/36`,
`verifyOk 36/36`, MVCC 0). Raw data under `benchmark/results/run-parallel-anchored-*`
(gitignored); this is the committed record.

## Provenance / interruption note (honest)

A forced laptop shutdown killed the sweep at ~90% (32/36 collected). The remaining 4 cells
(K50-channels2-r2 + all K50-channels5) were completed via a new `sweep.py --resume`
(commit `3ac73e9`) — it skips already-collected runs and executes only the missing ones. The
4 recovered cells therefore ran on a fresh ledger rather than the accumulated one; storage is
a per-run t1−t0 delta and verify seeds its own events, so both are ledger-size-independent and
the measurement is consistent. `configShas` are identical across all runs (the `--resume` and
`collect` fixes touch no stamped config file).

## Two measurement bugs fixed for this variant

- **Provisioning (c07dbc0, from Chunk 10):** the per-case channels are provisioned via
  `provision-channel.sh`, which relied on the non-deterministic `package_ccaas`; fixed to
  reuse the served `CCAAS_ID_APP`.
- **Storage (28c9c32):** `bytesPerEventBlockstore` summed only the app (case) channels — but
  in Parallel-Anchored the events are batched off-chain and only the Merkle roots are
  committed, to **anchor-main**, while the case channels stay EMPTY (0 delta). The metric
  read 0 (→ a meaningless 100% "compression"). Now it counts the total on-chain delta
  including anchor-main. This is the single most important fix in this chunk — without it the
  headline compression figure for this variant was garbage.

## Storage / compression (roots to anchor-main; channels=1, mean of 3 reps)

Baseline: Standard = **4716.95 B/event**.

| K | on-chain B/event | reduction vs Standard | receipt-store Δ (witness) |
|---:|---:|---:|---:|
| 5  | 861.8 | 81.7 % | 2.81 MB |
| 10 | 434.7 | 90.8 % | 3.15 MB |
| 25 | 179.9 | 96.2 % | 3.63 MB |
| 50 | 94.0  | 98.0 % | 3.96 MB |

On-chain cost falls ~1/K as the batch grows; the off-chain receipt store grows with K (larger
O(log₂K) sibling paths) — the same integrity-vs-availability tradeoff as Anchoring.

**Anchoring vs Parallel-Anchored at equal batch size** (both single-channel here): PA is
slightly *less* space-efficient per event than single-channel Anchoring — K=10 435 vs N=10
423 B/event, K=50 94 vs N=50 91 — because per-**case** batching produces more partial batches
(more roots per event) plus the dedicated anchor-main channel overhead. A small, explicable
cost of the per-case structure.

**Channel effect** (K=50): bytes/event 94.1 (c1) → 91.1 (c2) → 86.7 (c5) — a mild *improvement*
with more channels, as anchor-main block overhead amortises over more concurrent per-case
batching. Minor next to the K effect.

## RQ2 verification-latency decomposition (p50, per-request, channels=1)

Reads anchored roots via the **anchor-client** (not the gateway route). ~30k–44k verifies per
run, okRate 1.0.

| K | fetchMs | recomputeMs | compareRootMs | total |
|---:|---:|---:|---:|---:|
| 5  | 1.14 | 0.0118 | 4.89 | 6.21 |
| 10 | 1.49 | 0.0177 | 6.23 | 7.95 |
| 25 | 1.43 | 0.0182 | 5.94 | 7.59 |
| 50 | 1.00 | 0.0159 | 4.37 | 5.53 |

Same shape as Anchoring: **`compareRootMs` (the on-chain root read) dominates (~70–80 %)**;
`recomputeMs` is negligible and grows O(log₂K) (0.012 → 0.018 from K=5 → K=50). The absolute
`compareRootMs`/`fetchMs` vary run-to-run with host/network load (hence K=50 reads lower than
K=25) — the invariant is the *ratio*: the ledger read, not Merkle recomputation, is the cost.

## Integrity
MVCC_READ_CONFLICT = 0 on all 36 runs; verify okRate = 1.0. F76 `assert_collected` passed on
every collected cell; the crash was caught (32 valid, 4 missing) and resumed cleanly.
