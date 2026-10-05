# Campaign 2 — run record (2026-10-03 → 2026-10-05)

> **Record, dated 2026-10-05.** Campaign 2 re-ran E1 → E2 → E3a → E3b → ops (150 runs) at campaign 1's
> settings, as a second, independent set of measurements. It is kept **separate** from campaign 1: its
> own data folder, its own tables, its own record; nothing here averages or merges the two campaigns.
> Not edited after the fact except to fix a pointer.
> - Data (gitignored, local only): `benchmark/results/campaign2-20261005/` — `e1/ e2/ e3a/ e3b/ ops/`, the
>   stage logs (`benchapp-logs/`), the campaign's own `runlog.jsonl` (its 150 lines), an environment
>   capture taken after the last run, and the VM clock evidence (§5).
> - Tables + charts: `docs/results/campaign2-20261005/<exp>/` (untracked).
> - Campaign 1, for reference only: `benchmark/results/campaign1-20261003/` (ramp → ops; its E0 re-smoke
>   is still in `benchmark/results/e0/`), `docs/results/campaign1-20261003/`, and its record
>   `docs/reviews/campaign-1-settings-environment-2026-10-03.md`.
> - Regenerate this campaign's tables only with both flags (`--out` does not follow `--results`):
>   `py -3.11 orchestration/report.py --exp X --results benchmark/results/campaign2-20261005 --out docs/results/campaign2-20261005/X`

## 1. Runs and provenance

| Stage | Date (local, UTC+7) | Runs | Rounds | Transactions | Elapsed | Failures |
|---|---|---|---|---|---|---|
| E1 | 2026-10-03 23:28 – 10-04 05:01 | 36 | 180 | 806,400 | 5 h 33 min | 3 |
| E2 | 2026-10-04 05:01–09:06 | 18 | 90 | 520,800 | 4 h 06 min | 54 |
| E3a | 2026-10-04 09:07–13:26 | 12 | 84 | 376,320 | 4 h 19 min | 21 |
| E3b | 2026-10-04 13:26 – 10-05 02:48 | 72 | 360 | 2,083,200 | 13 h 22 min | 60 |
| ops | 2026-10-05 02:48–06:05 | 12 | 78 | 31,200 | 3 h 16 min | 0 |

Transactions = Caliper's `succ` + `fail` over the timed rounds; elapsed = first run start → last run
finish of the stage. The chain ran 2026-10-03 23:28:24 → 2026-10-05 06:05:22 (30 h 37 min).

- **Every one of the 150 runs** (`run.json`): commit `772b00d` (pushed; the code of `9459fd7` plus a
  `docs/STATUS.md` commit), `sweeps.yaml` blob `e7d3f72`, the six config blobs `configtx.yaml` `4798cf7`,
  `core.yaml` `983f7fd`, `orderer.yaml` `2111b4b`, `compose-net.yaml` `a100fe2`,
  `compose-services.yaml` `cc1c0cb`, `compose-ca.yaml` `9deac70`; Caliper 0.6.0, binding
  `fabric:fabric-gateway` (connector `fabric` on the 72 Standard/Parallel runs, `rest` on the 78
  Anchoring/Parallel-Anchored runs); Fabric tag 2.5.15; host as seen by the VM 32 cores / 9.7 GB.
- **Trace hashes:** each of the 138 traced runs (E1–E3b) has the same trace hash as the identically
  named campaign-1 run (138/138), so the same transactions were replayed. The 12 ops runs have no trace
  (`trace: null` in both campaigns — ops builds its rounds per operation) and replay identical rounds
  (same labels, 400 transactions each at 100 tx/s, same controls and levels).
- **One attempt per run:** 150 runs in 150 attempts — no failed attempt, no retry, no failed network
  reset, no interruption; the driver never had to be relaunched. Caliper's round summary agrees with
  the per-transaction log in all 792 rounds (no dropped first transactions).
- Uncommitted while the runs ran (no run reads them): `README.md`, `docs/STATUS.md`, the untracked
  campaign-1 record (the handoff edits of 2026-10-03) and the untracked `docs/results/` (campaign 1's
  tables), plus `network/compose/.env` (rewritten by every run).

## 2. Settings (held equal to campaign 1)

`benchmark/sweeps.yaml` blob `e7d3f72`, unchanged throughout — the same file as campaign 1's E3 and,
apart from three provenance-tag comments, as its E1/E2 (`dca8559`; the values are identical):

| Setting | Value |
|---|---|
| seed / workers / repetitions | 20260922 / 4 Caliper workers / r = 3 |
| batch_sizes (E1, one grid for N and K) | [10, 25, 50, 100, 200] |
| channel_counts (E2) | [5, 10, 20, 30, 40, 50] |
| send_rates_tps (E3a) | [10, 25, 50, 75, 100, 150, 200] |
| case_counts (E3b, ≤ channels_max) | [5, 10, 20, 30, 40, 50] |
| baselines (send rate / batch / channels / channels_max) | 100 tx/s / 50 / 20 / 50 — campaign 1's values, not recalibrated: **campaign 2 ran no ramp** (the authors' choice) and nothing from its E1/E2 was applied |
| workload | 20 evidence per case; 224 write events per case per round; 5 rounds (E3a: one per send rate = 7); mix TransferCustody 0.15 / AccessLog 0.85, 50 % of evidence disposed; payload 256 B; 5 audit cases per run |
| anchoring.flush_timeout_ms / monitor.interval_s | 0 / 5 |

`experiment.py` argv per stage, as in campaign 1: E1 `--exp e1 --variant anchoring --variant
parallel-anchored --variant standard --variant parallel`; E2 `--exp e2`; E3a/E3b/ops `--exp <stage>`
with all four variants (Standard, Anchoring, Parallel, Parallel-Anchored order). The run order of every
stage is identical to campaign 1's. One fresh ledger per run (`orchestration/reset-network.sh`).

## 3. Environment

Captured 2026-10-03 23:25 before the first run (in the monitoring session only; not saved to a file)
and again 2026-10-05 06:19 after the last (`benchmark/results/campaign2-20261005/environment-after-campaign2.txt`)
— unchanged between the two and identical to campaign 1's record §3:

| Item | Value |
|---|---|
| Windows | 11 Home Single Language 25H2, build 26200.9457; Windows Update paused until 2026-10-22 14:49 UTC; Microsoft Store auto-updates off (`AutoDownload`=2) |
| Power | Legion Balance Mode, on AC throughout |
| WSL | 2.4.12.0, kernel 5.15.167.4-microsoft-standard-WSL2; `.wslconfig` `memory=10GB` → 9.7 GiB, 32 CPUs; clocksource `tsc` |
| Distro / toolchain | Ubuntu 22.04.5 LTS; node 20.19.6, npm 10.8.2, Python 3.10.12 + PyYAML 6.0.3, fabric-ca-client 1.5.19, jq 1.6; caliper-cli/core/fabric 0.6.0, `@hyperledger/fabric-gateway` 1.5.0, `@grpc/grpc-js` 1.10.3 |
| Docker | Docker Desktop 4.38.0, engine 27.5.1, compose 2.32.4-desktop.1 |
| Images | the same 15 image IDs as campaign 1 (e.g. `gleipnir-gateway` `8f707c2478a4`, `hyperledger/fabric-peer:2.5.15` `c48323777139`); nothing rebuilt or pulled |

## 4. Procedure

- **Host preparation (2026-10-03 23:20–23:25):** closed Roblox, Microsoft Edge, WhatsApp, Spotify (+ its
  Game Bar widget), Windows Widgets, the OneDrive sync service and Settings (Discord and Chrome were not
  running); kernel paged pool 1.05 GB and flat over three 20 s samples. **Not done:** the recommended
  Restart (the host had been up since 2026-09-30 08:37; a restart would have ended the monitoring session).
  Docker Desktop started by hand; the stack was never started by hand; the web app was never opened.
- **Separation first:** campaign 1's results (`benchmark/results/{ramp,e1,e2,e3a,e3b,ops}`, its stage
  logs, a copy of `runlog.jsonl`) and tables (`docs/results/{e1,…,ops}`) were moved, intact, into
  `campaign1-20261003/` folders before the first run, so `--resume` could neither skip nor mix them.
- **Driver:** `C:\Users\LENOVO\gleipnir-driver\overnight.py` — campaign 1's E3 driver (kept as
  `overnight-e3-2026-10-02.py`) with campaign 1's E1/E2/E3 argv as its stages, the expected run counts
  36/18/12/72/12, and a git gate that also admits the uncommitted docs; read-only review by 8 agents (no
  blocker), `--selftest` and `--check` passed. Same `experiment.py` argv, WSL script and bookkeeping as
  the Bench app; backup skipped (the ledger held benchmark data, origin `benchmark:ops@20261003-150050`).
  Launched 2026-10-03 23:28:24; finished 2026-10-05 06:05:22 (`overnight.log`, `overnight-status.json`).
- **Monitoring:** in-session scheduled checks every 30 min (driver status and logs, failures, Windows
  memory, `git status`, provenance and clock spot-checks). Apps that relaunched themselves were closed at
  the checks (WhatsApp, Phone Link, Windows Widgets, OneDrive); Phone Link was closed for the first time
  at 2026-10-04 08:19 to relieve memory (§5). No file under `benchmark/`, `orchestration/` or `network/`
  was edited and nothing was committed while the chain ran.
- **Wrap-up (2026-10-05 06:18–06:30):** plain `down.sh` (0 containers, the 11 `gleipnir_*` volumes kept),
  environment and clock captures, Docker Desktop stopped, `wsl --shutdown`; campaign 2's run folders and
  stage logs moved into `benchmark/results/campaign2-20261005/` and its 150 `runlog.jsonl` lines copied
  there. The shared `benchmark/results/runlog.jsonl`, which the Bench app's History reads, still lists
  every run of both campaigns (322 lines). Tables by `report.py` with explicit `--results`/`--out` (it
  also rewrites `<exp>-results.csv` inside the campaign folder it reads).

## 5. Conditions observed (not controlled)

**WSL VM clock — it ran slow and was stepped forward (campaign 1's VM ran fast and was stepped back).**
Caliper prints a progress line every 5 s of VM time; intervals of 0.3–4.4 s mark a backward step,
5.6–30 s a forward step or a stall (`clockscan.py` on the stage logs):

| Stage | Progress intervals | Backward steps (≥ 0.6 s) | Forward steps / stalls | Step median / max | Rounds with a negative per-tx min latency |
|---|---|---|---|---|---|
| E1 | 1,498 | 0 | 220 | 0.97 / 1.21 s | 1 of 180 (−57 ms) |
| E2 | 1,001 | 0 | 173 | 1.32 / 1.48 s | 1 of 90 (−22 ms) |
| E3a | 1,974 | 0 | 379 | 1.53 / 2.36 s | 2 of 84 (−49 ms) |
| E3b | 3,807 | 0 | 688 | 2.04 / 2.38 s | 11 of 360 (−139 ms) |
| ops | 55 | 0 | 1 | 2.35 s | 0 of 78 |

- ops' 4 s rounds rarely span two progress lines, so the scan sees 1 step in 55 intervals there; the
  per-transaction logs show steps in 7 of ops' 78 rounds. The 15 rounds with a negative per-tx minimum
  (down to −139 ms) show that small backward corrections did occur, but no backward step of ≥ 0.6 s.
- Measured directly at the end (`vm-clock-dmesg.txt`): the VM's uptime read 105,370 s against ≈ 111,330 s
  of real time since it booted (Docker Desktop start, 2026-10-03 23:24) — the VM clock ran at ≈ 0.946 ×
  real time (≈ 5.4 % slow), and its wall clock was brought back to Windows time by forward steps about
  every 30 s (≈ 1.6 s per step on average; median 0.97 s in E1 rising to 2.04 s in E3b, max 2.38 s), so
  just before each step it lagged Windows by about the step size; the one direct reading was −0.61 s
  (2026-10-05 06:19:54, after the campaign). The kernel log held no time-sync lines by then.
- Effects: each forward step puts Caliper's fixed-rate controller ≈ step × send rate transactions behind,
  and it bursts to catch up (≈ 100 transactions after E1's ≈ 1 s steps, ≈ 200 after E3b's ≈ 2 s steps at
  100 tx/s; in flight right after a step, median E1 → E3b: Standard ≈ 105 → 190, Parallel ≈ 170 → 265, the
  anchored variants ≈ 40 → 95); transactions that span a step gain up to its size in latency. In ops'
  short rounds a step near the end lowers the measured throughput when the round's drain is short — one
  Standard `transfer` round read 81.5 TPS (hence 93.7 ± 10.5), and Standard's read rounds have one low r2
  round each (87.3 / 75.9 TPS); Parallel's reads barely move (one read-evidence round at 98.4). On
  Parallel's write rounds a step raised the reading instead: in two r2 rounds the catch-up burst filled
  every channel's blocks, so no last transaction waited for the 2 s BatchTimeout and the drain vanished
  (`access` 97.8 and `transfer` 82.8 TPS against ≈ 66, hence 76.8 ± 18.2 and 71.7 ± 9.6). A step early in
  a round changes nothing (Standard read-evidence r1: 1.5 s at +1.1 s, 100.9 TPS). Negative minima are
  rare and small; Caliper's dropped-first-transactions undercount did not occur (0 of 792 rounds).
- Campaign 1, for contrast (its record §5): backward steps of ≈ 1.0–1.4 s (≈ 2.3 s in E3b runs 1–58),
  none in its last 14 E3b runs and ops. The two campaigns therefore carry clock biases of **opposite
  sign**; cause unknown (a TSC-rate mis-calibration of the VM at boot is the leading guess).

**Windows memory.** Kernel paged pool 0.86–1.05 GB, flat (no GPU-memory leak). "Available" mostly
0.5–3 GB, the WSL VM holding up to 6.9 GB of working set (10.2 GB committed); lowest 0.20 GB at
2026-10-04 08:17 (E2, 50 channels) with 2–3 k pages/s — closing Phone Link brought it to ≈ 0.7 GB and
≈ 0.5–1 k pages/s. Momentary paging bursts during the 50-channel network resets (up to ≈ 82 k pages/s
for a few seconds, 2026-10-05 01:48). No run failed or was retried because of memory.

**Failures** — all 138 are Fabric validation code 11 (`MVCC_READ_CONFLICT`, the trace race) per the
`caliper.log` scan; none on the anchored variants; Standard only at the 200 tx/s E3a rounds and at 10–30
cases in E3b:

| Stage | Cells with failures (sum over r = 3) |
|---|---|
| E1 | Parallel reference 3 |
| E2 | 5 ch 9, 10 ch 28, 20 ch 4, 30 ch 10, 40 ch 3, 50 ch 0 |
| E3a | Standard 9, Parallel 12 (all in the 200 tx/s rounds) |
| E3b | Parallel: 5 cases 9, 10: 27, 20: 5, 30: 8, 40: 3, 50: 0; Standard: 10 cases 3, 20: 2, 30: 3 |
| ops | none |

## 6. Results (campaign 2 only — tables and charts in `docs/results/campaign2-20261005/<exp>/`)

Means over r = 3. Anchored-variant latency is enqueue latency at the batcher (REST path). The caveats of
`docs/STATUS.md` §5 apply unchanged (end-of-round drain in throughput, all-batches anchoring delay incl.
forced batches, code-11 failures shown as `OTHER` in the per-tx class columns) — plus the clock (§5).

- **E1** (20 cases, 100 tx/s): Standard reference 99.8 TPS, 0.14 s avg, 4,009.6 B/event on-chain, audit
  0.074 s/case; Parallel reference 95.5 TPS, 0.94 s, 4,020.9 B/event. Anchoring N = 10 → 200: on-chain
  423.8 → 24.4 B/event, off-chain 1,097.2 → 1,470.0 B/event, audit 2.26 → 0.51 s/case, anchoring delay
  0.60 → 3.04 s. Parallel-Anchored K = 10 → 200: 434.7 → 23.5, 1,122.3 → 1,490.5, 0.55 → 0.24 s/case,
  1.97 → 27.44 s. Anchored throughput 100.1 TPS, ≈ 0.01 s.
- **E2** (Parallel, 5 → 50 channels): throughput 84.2 → 98.0 TPS (the end-of-round drain), latency avg
  0.33 → 1.32 s, p95 0.71 → 2.12 s, summed container CPU 29 → 76 %, memory 559 → 1,895 MB, failure rate
  ≤ 0.08 %, on-chain 4,010 → 4,128 B/event — every level passes §4.2, so the rule would again give
  channels 20 / channels_max 50 (not applied).
- **E3a** (10 → 200 tx/s): **no saturation** for any variant (throughput ÷ send rate at 200 tx/s:
  Standard 0.98, Anchoring 1.00, Parallel 0.92, Parallel-Anchored 0.99). `report.py` flags a p95 knee for
  Parallel-Anchored at 200 tx/s (p95 0.035 s vs 0.012 s at 10 tx/s — milliseconds of enqueue latency,
  inside the clock-step scale), none for the others. Parallel latency falls as the rate rises (1.65 s at
  10 tx/s → 0.57 s at 200, the 2 s block timer).
- **E3b** (5 → 50 cases, 100 tx/s): Standard 98.7–100.0 TPS, 0.16–0.19 s, ≈ 4,008 B/event; Anchoring
  ≈ 100 TPS, ≈ 87.5 B/event, audit 0.49 → 1.81 s/case, anchoring delay 2.07 → 1.59 s; Parallel 84.1 →
  97.9 TPS, 0.34 → 1.35 s, memory 565 → 1,905 MB, 4,010 → 4,124 B/event; Parallel-Anchored ≈ 100 TPS,
  91.1 → 90.1 B/event, audit ≈ 0.28–0.30 s/case, anchoring delay 5.0 → 16.5 s.
- **ops** (sub-floor by design, 0 failures): writes — Standard 99.5–100.3 TPS (transfer 93.7 ± 10.5, the
  clock step), ≈ 0.11 s; Parallel 66–77 TPS, 0.91–1.07 s (≈ 66 TPS and 0.91–0.92 s in its 10 step-free
  rounds: 400-tx rounds + the 2 s drain; the `access` 76.8 ± 18.2 and `transfer` 71.7 ± 9.6 means each
  include one r2 round with a ≈ 1.5 s clock step that read high, 97.8 / 82.8 TPS at 1.15 / 1.37 s, §5);
  anchored ≈ 101 TPS, ≈ 0.01 s. Reads (`read-evidence`, `read-trail`) and `verify-event` ≈ 0.01 s
  everywhere (Standard's reads 96.4 ± 7.9 / 92.9 ± 14.7 TPS, one clock-stepped round each).

## 7. Against campaign 1's checklist (its record §6)

1. Settings — held: blob `e7d3f72`, the six config blobs, baselines 100 / 50 / 20 / 50; trace hashes
   identical in all 138 traced runs (E1–E3b); the ops rounds are identical too (ops has no trace).
2. Images — held: the same 15 IDs before and after.
3. Environment — held (`.wslconfig`, Docker Desktop/engine, WSL, Windows build, updates paused, Store
   auto-updates off, AC, Balance Mode, the apps closed), **except** that the host was not restarted first.
4. Clock — recorded per stage (§5); **not the same condition as campaign 1** (forward instead of backward
   steps), so per-round throughput, p95 and minimum latencies need the clock caveat in both campaigns. The
   short pre-start load test the checklist suggests was not run (the condition was recorded during the
   runs instead).
5. Results — campaign 1 moved aside first; campaign 2 in its own folders; nothing combined.
6. Order and scale — E1 → E2 → E3a → E3b → ops at r = 3 (no ramp; campaign 1's 100 tx/s used).
7. Comparison — deliberately not in this record; every E1–E3b cell is trace-identical to campaign 1's
   and every ops cell round-identical, so a cell-by-cell comparison can be made later from the two
   separate folders.
