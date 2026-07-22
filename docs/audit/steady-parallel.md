# Steady-state — Parallel variant (channels ∈ {1, 2, 5})

Date: 2026-07-22 · Commit: `c07dbc0` · Regime: steady · 9 write runs, all valid
(`ok 9/9`, MVCC 0). No verify phase (Parallel commits one tx per event, like Standard).
Raw data under `benchmark/results/run-parallel-*` (gitignored); this is the committed record.
configShas identical to the earlier campaign runs (the c>1 fixes touch generate-rounds.js /
provision-channel.sh / benchmark configs — none of the six stamped config files).

## Two c>1 bugs found and fixed before any data was collected (F76 caught them)

The step-2 smokes only ran c1, so the multi-channel path was unexercised. The first sweep
attempt aborted at `channels2-r0` (F76 `assert_collected`, not silent). Two distinct defects,
both fixed in `c07dbc0` and verified with a green c2 probe (120/120, 0 fail) before re-running:

1. **caliper-fabric contract-id collision (error code 6, at config parse).** The generated
   network config declared `id: evidence` on every channel; caliper-fabric keys
   `contractDetailsById` by `contractID` and throws `evidence has already been defined`
   before any transaction. Fix: unique `contractID: evidence-case-00N` per channel (the
   workloads pass an explicit channel, so the connector routes by channel+id at runtime).
2. **CCaaS package-id mismatch (endorsement DEADLINE_EXCEEDED).** `package_ccaas` uses
   `tar -czf`; gzip embeds a timestamp, so it is non-deterministic. `up.sh` set one id for
   case-001 and started the ccaas with it, but `provision-channel.sh` recomputed a different
   id for case-002+, which no running ccaas serves. Fix: `provision-channel.sh` reuses the
   served `CCAAS_ID_APP` from `.env`. (Follow-up: `package_ccaas` is still non-deterministic —
   a reproducibility gap, sidestepped here.)

## Result: throughput, per-channel derivation, latency (r0, representative)

| Round | c1 agg | c2 agg (per-ch) | c5 agg (per-ch) |
|---|---:|---:|---:|
| create-25tps  | 25.2 | 24.5 (12.25) | 24.8 (4.96) |
| create-50tps  | 50.0 | 50.0 (25.0)  | 49.1 (9.82) |
| create-100tps | 99.5 | 99.8 (49.9)  | 99.9 (19.98) |

`throughputScope: aggregate-across-channels`; `perChannelTpsDerived = aggregate / C` (uniform
round-robin, F6/F24). Successful events scale with C (c1 4000, c2 8000, c5 ~20000) — the
≥1000-events-per-channel floor holds (txNumber scaled by C). Storage ≈ Standard
(~4460–4543 B/event; Parallel is not a compression variant — one on-chain tx per event).

**Latency (avg, create-25tps r0):** c1 0.24 s → c2 0.43 s → **c5 0.95 s**.

## Interpretation (important, honest caveat)

At the offered loads (25/50/100 tps aggregate), **a single channel is not saturated**
(calibration showed one channel sustains 100 tps). So splitting the *same* aggregate load
across more channels does **not** raise aggregate throughput — it lowers per-channel load
(agg/C) and **raises latency** (0.24 → 0.95 s at 25 tps as C goes 1 → 5), because a single
host pays coordination overhead for more concurrent Raft ordering / block-cutting.

The Parallel variant's theoretical throughput-scaling benefit (independent channels commit in
parallel) only materialises when a single channel is the bottleneck — i.e. at loads that
saturate one channel, above the range this campaign sweeps (the author kept
`offered_load_tps [25,50,100]`; saturation was not probed). The honest thesis statement is
therefore: **on a single host at sub-saturation load, per-case channel parallelism adds
ordering overhead (higher latency) without raising aggregate throughput** — the benefit is
load-dependent and would require a saturating regime, or multi-host ordering, to appear.

MVCC_READ_CONFLICT = 0 on all 9 runs; F76 `assert_collected` passed on every collected cell.
(Note: worker-clock artifact — Caliper min-latency goes slightly negative at high local commit
speed on c5; avg/max are sane, per the documented benchmarking caveat.)
