# Steady-state — Standard variant (compression baseline)

Date: 2026-07-21 · Campaign SHA: `e1b3902` · Regime: steady · Host: single-host WSL
(Ubuntu-22.04). `benchmark/results/` is gitignored, so this file is the committed record of
the baseline; the raw manifests/logs live under `benchmark/results/run-standard-base-r{0,1,2}/`.

Standard is run **first** because it is the `collect.py --baseline` for the payload-
compression figures reported for the Anchoring and Parallel-Anchored variants.

## Offered-load calibration (pre-sweep)

Short create-only probes (400 tx/round, 4 workers) confirmed the host sustains the full
candidate range with no saturation:

| Offered | Send rate | Throughput | Avg lat | Fail |
|--------:|----------:|-----------:|--------:|-----:|
| 25 tps  | 25.3 | 25.1 | 0.24 s | 0 |
| 50 tps  | 50.5 | 50.0 | 0.16 s | 0 |
| 100 tps | 101.0 | 99.3 | 0.11 s | 0 |

Decision (author, 2026-07-21): keep `offered_load_tps = [25, 50, 100]` — validated,
no `sweeps.yaml` change, campaign SHA unchanged.

## Sweep result (3 repetitions, txNumber 1000/round)

Representative round table (r0; Fail = 0 on every round, so Caliper's reported throughput
equals the successful-only figure):

| Round | Succ | Fail | Send TPS | Avg lat | Max lat | Throughput |
|-------|-----:|-----:|---------:|--------:|--------:|-----------:|
| create-25tps        | 1000 | 0 | 25.1  | 0.24 s | 1.16 s | 25.1 |
| create-50tps        | 1000 | 0 | 50.2  | 0.17 s | 1.08 s | 50.0 |
| create-100tps       | 1000 | 0 | 100.4 | 0.11 s | 0.85 s | 93.2 |
| access-spread-50tps | 1000 | 0 | 50.2  | 0.15 s | 0.25 s | 50.0 |
| transfer-50tps      | 1000 | 0 | 50.2  | 0.17 s | 1.12 s | 50.0 |

**Storage baseline** (identical across reps — measurement is stable):

| Rep | successful events | bytes/event (blockstore) | MVCC |
|-----|------------------:|-------------------------:|-----:|
| r0 | 5000 | 4716.95 | 0 |
| r1 | 5000 | 4716.97 | 0 |
| r2 | 5000 | 4717.09 | 0 |

`bytesPerEventBlockstore ≈ 4717 B/event` is the Standard baseline; the Anchoring /
Parallel-Anchored compression is reported as the *reduction* in this figure (never as 1/N of
total ledger size).

## F53 — MVCC calibration against the first real steady log — resolved, no code change

`collect.py count_mvcc` counts `MVCC_READ_CONFLICT` occurrences in `caliper.log`. Against the
real steady logs:

- **Zero MVCC conflicts** across all 15 rounds / 15,000 transactions (grep of each
  `caliper.log` returns 0, matching the 0-Fail round tables and the manifest
  `failureClasses.MVCC_READ_CONFLICT = 0`). This is a positive result: it confirms the
  structural `(evidenceId, monotonicCounter)` composite-sub-key design (CLAUDE.md) actually
  avoids write-write conflicts under sustained concurrent access/transfer — no client retry
  loop needed.
- **No degenerate/`N/A` rounds** — every round has a valid Succ/rate row, so `collect.py`'s
  round parsing has nothing to mis-handle here.
- The prior overcount concern (one conflict logged at several levels inflating the substring
  count) is **latent, not active**: with zero conflicts by design there is nothing to double-
  count. Left as a documented watch-item rather than a fix, so `collect.py` — and therefore
  the campaign SHA — is unchanged. If a future variant/config ever produces real conflicts,
  re-check the per-conflict log-line multiplicity before trusting the tally.

## Status
Chunk 8 exit met: `run-standard-base-r{0,1,2}` collected with rounds + storage + checkpoints,
baseline `bytesPerEventBlockstore` populated, F53 verified. Ready for Chunk 9 (Anchoring),
which brings up a fresh `up.sh --variant anchoring` after `down.sh --wipe`.
