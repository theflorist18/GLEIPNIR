# Campaign 1 — settings and environment (2026-09-30 → 2026-10-03)

> **Record, dated 2026-10-03.** The exact configuration under which the first full campaign ran
> (E0 re-smoke → ramp → E1 → E2 → E3a → E3b → ops, 158 runs), so that a re-run ("campaign 2",
> to measure run-to-run variance) can match it and the thesis methods section can cite it. Not
> edited after the fact except to fix a pointer. Where things stand and what comes next:
> `docs/STATUS.md`. Results: `benchmark/results/campaign1-20261003/` (gitignored, local only) and
> `docs/results/campaign1-20261003/` (moved there 2026-10-03, before campaign 2 started).
> Values below come from the runs' own `run.json` / `manifest.json` provenance, `git`, and an
> environment capture taken on 2026-10-03 after the campaign (nothing was rebuilt or updated in
> between).

## 1. Runs and provenance

| Stage | Date (local, UTC+7) | Runs | Commit | `sweeps.yaml` blob | Notes |
|---|---|---|---|---|---|
| E0 re-smoke | 2026-09-30 14:33–15:01 | 4 | `542c125` | `a31da07` | smoke regime, functional check only |
| ramp | 2026-10-01 22:00–23:26 | 4 | `4c44618` | `a31da07` | 1 run per variant, 7 send rates |
| E1 | 2026-10-01 23:26 – 10-02 05:00 | 36 | `a730030` | `dca8559` | batch sizes 10–200, r = 3 |
| E2 | 2026-10-02 05:00–09:34 | 18 | `a730030` | `dca8559` | Parallel, 5–50 channels, r = 3 |
| E3a | 2026-10-02 13:28–17:34 | 12 | `9459fd7` | `e7d3f72` | 7 send rates per run, r = 3 |
| E3b | 2026-10-03 01:46–15:00 | 72 | `9459fd7` | `e7d3f72` | 5–50 cases, r = 3 |
| ops | 2026-10-03 15:01–18:05 | 12 | `9459fd7` | `e7d3f72` | per-operation, sub-floor by design |

- `a730030` changed only `baseline.send_rate_tps` (to 100); `9459fd7` changed only three provenance
  tags (values unchanged). Between `542c125` and `9459fd7` only `benchmark/sweeps.yaml` and
  documentation changed (`git diff --stat 542c125 9459fd7`: README.md, sweeps.yaml, STATUS.md and
  the readiness record).
- **Config file blob SHAs, identical in all 158 runs:** `network/configtx/configtx.yaml` `4798cf7`,
  `network/core.yaml` `983f7fd`, `network/orderer.yaml` `2111b4b`,
  `network/compose/compose-net.yaml` `a100fe2`, `network/compose/compose-services.yaml` `cc1c0cb`,
  `network/compose/compose-ca.yaml` `9deac70`.
- Every run: Caliper 0.6.0, binding `fabric:fabric-gateway`, Fabric tag 2.5.15, host as seen by the
  VM 32 cores / 9.7 GB. Connector: `fabric` (peer gateway) for Standard and Parallel, `rest` (the
  gateway BFF; latency = enqueue at the batcher) for Anchoring and Parallel-Anchored.

## 2. Experiment settings (`benchmark/sweeps.yaml` at `9459fd7`, blob `e7d3f72`)

| Setting | Value |
|---|---|
| seed / workers / repetitions | 20260922 / 4 Caliper workers / r = 3 (ramp, E0: 1) |
| batch_sizes (E1, one grid for N and K) | [10, 25, 50, 100, 200] |
| channel_counts (E2) | [5, 10, 20, 30, 40, 50] |
| send_rates_tps (ramp, E3a) | [10, 25, 50, 75, 100, 150, 200] |
| case_counts (E3b, ≤ channels_max) | [5, 10, 20, 30, 40, 50] |
| baseline.send_rate_tps | 100 — set from the ramp 2026-10-01 (no saturation up to 200 → half the top level); in force from `a730030` (E1 on) |
| baseline.batch_size | 50 — the authors' choice 2026-10-02 (§4.1 selects no level); the same value served as the placeholder during the ramp and E2 (E1 sweeps it) |
| baseline.channels / channels_max | 20 / 50 — set from E2 2026-10-02; the same values served as placeholders during the ramp and E1 |
| workload | 20 evidence per case; 224 write events per case per round; 5 rounds (E3a and the ramp: one round per send rate = 7); mix TransferCustody 0.15 / AccessLog 0.85 relative weights, 50 % of evidence disposed; payload 256 B; 5 audit cases per run |
| anchoring.flush_timeout_ms | 0 (size-only batching; partial batch flushed at run end) |
| monitor.interval_s | 5 |
| regimes | smoke: 10 cases × 2 evidence, 10–25 logs per case, 5 tx/s; steady floor 1,000 write events per channel |
| ramp.events_per_case_per_round | 224 |
| trace generator | rule (e) + weighted interleave, `headGap` 110 (7 in the 60-item E0 smoke round) |

**Trace hashes (first 12 hex) — identical across stages for the same cell** (E1 and E2 used the
same hashes as E3b at the case counts they share):

| Cases | Standard, Anchoring (1 channel) | Parallel, Parallel-Anchored (1 channel per case) |
|---|---|---|
| 5 | `21b5a2e7686f` | `ef4867bbecef` |
| 10 | `8d22ed1d9cac` | `78f565699824` |
| 20 | `152bb7391343` | `d22fb1442c16` |
| 30 | `309d45a9f07c` | `fa7cf5af657b` |
| 40 | `1ddc3e89e422` | `5cb3000fc904` |
| 50 | `5771c70c41fc` | `09b88c948911` |

The ramp and E3a use 7-round traces (one slice per send rate); their hashes are in each
`run.json`. ops builds its rounds per operation (no trace).

**Fabric network:** Fabric 2.5.15, Fabric CA 1.5.19; two peer organisations (+ the anchor
organisation on Parallel-Anchored), three etcdraft orderers, GoLevelDB world state; channels
created with the channel-participation API. Orderer batching: `BatchTimeout` 2 s,
`MaxMessageCount` 10, `AbsoluteMaxBytes` 99 MB, `PreferredMaxBytes` 512 KB. Chaincode as a service,
package id `evidence_1.0:cd81c374…` (deterministic packaging). One fresh ledger per run
(`orchestration/reset-network.sh`).

## 3. Environment

| Item | Value |
|---|---|
| Laptop | Lenovo Legion, model 82WK; Intel Core i9-13900HX, 24 cores / 32 threads; 15.7 GB RAM |
| Windows | Windows 11 Home Single Language 25H2, build 26200.9457. Windows Update paused 2026-10-01 → 2026-10-22 14:49 UTC; Microsoft Store auto-updates off by policy (`AutoDownload`=2); Fast Startup on |
| Power | Legion Balance Mode, on AC for every stage (AC: never sleeps, lid does nothing) |
| Security software | Avast with Web/Mail Shield (TLS-intercepting proxy) — affects image builds, not the runs |
| WSL | 2.4.12.0, kernel 5.15.167.4-microsoft-standard-WSL2; `%USERPROFILE%\.wslconfig` = `[wsl2]` `memory=10GB` → VM MemTotal 9.7 GiB, 32 CPUs; clocksource `tsc` (`hyperv_clocksource_tsc_page` available) |
| Distro | Ubuntu 22.04.5 LTS (`Ubuntu-22.04`), run as root; node 20.19.6, npm 10.8.2, Python 3.10.12 + PyYAML 6.0.3, fabric-ca-client 1.5.19, jq 1.6 |
| Caliper toolchain (`benchmark/node_modules`) | caliper-cli / caliper-core / caliper-fabric 0.6.0, `@hyperledger/fabric-gateway` 1.5.0, `@grpc/grpc-js` 1.10.3 |
| Docker | Docker Desktop 4.38.0, engine 27.5.1, compose 2.32.4-desktop.1 (CLAUDE.md pins 29.5.2 — known deviation, constant for the whole campaign) |
| Windows Python | 3.11.9 with tkinter, PyYAML, matplotlib (Bench app, `report.py` charts) |

**Images (ID) — never rebuilt or pulled during the campaign** (`run.json` records no image IDs, so
this list is the record):

| Image | ID | Image | ID |
|---|---|---|---|
| `gleipnir-anchor-client` | `60808c3e2d6d` | `gleipnir-receipt-store` | `a2f7d55a9dbd` |
| `gleipnir-case-registry` | `5516f1d0b4c9` | `gleipnir-verification` | `0d7e06501df5` |
| `gleipnir-ccaas-evidence` | `afde87b85899` | `hyperledger/fabric-peer:2.5.15` | `c48323777139` |
| `gleipnir-ccaas-evidence-anchor` | `afde87b85899` | `hyperledger/fabric-orderer:2.5.15` | `72697d099f45` |
| `gleipnir-evidence-store` | `bf5146945dc3` | `hyperledger/fabric-tools:2.5.15` | `07e585dff06b` |
| `gleipnir-frontend` | `4b239d7ef5c8` | `hyperledger/fabric-ca:1.5.19` | `344c5ba9393b` |
| `gleipnir-gateway` | `8f707c2478a4` | `alpine:latest` | `294b683cb724` |
| `gleipnir-merkle-batcher` | `f3618f616f01` | | |

**Host preparation before every stage:** Discord, Chrome, Roblox and Windows Widgets closed (they
leak GPU memory into the kernel's paged pool); laptop otherwise idle; Docker Desktop started by
hand; the stack not started by hand and the web app never opened between the first run and the
final Restore.

## 4. Procedure

- Stages were driven headlessly with the Bench app's exact `experiment.py` argv, WSL script and
  bookkeeping (`orchestration/benchcore.py`): ramp/E1/E2 by
  `C:\Users\LENOVO\gleipnir-driver\overnight-2026-10-01.py`, E3 by `…\overnight-e3-2026-10-02.py`
  (named `overnight.py` until 2026-10-03; outside the repo). `GLEIPNIR_ALLOW_LEDGER_WIPE=1`; `experiment.py` wrote its own log inside WSL; the backup
  was skipped because the ledger held benchmark data (the fixture's trails are in
  `backups/20260930-134117`).
- Interruptions, all resumed with `--resume` (a run in progress is re-run from a fresh ledger):
  E2 stopped once at 08:44 on 2026-10-02 (author left) and resumed at 08:51; E3 was split over two
  days (driver stopped after E3a, 2026-10-02 13:50; relaunched 2026-10-03 01:46); one failed
  network reset in E3b (2026-10-03 14:16, `peer lifecycle chaincode install` could not reach
  peer0.org1:7051) re-run automatically at 14:17.
- Monitoring during E3: Claude Code's in-session scheduled checks every 30 min (driver status,
  logs, failures, Windows memory).

## 5. Conditions observed during the runs (not controlled)

- **WSL VM clock steps** (`caliper.log` scan of the 5 s progress lines; per-tx minimum latencies):
  none in the E0 re-smoke; ramp, E1, E2 steps of ≈ 1.0–1.4 s (medians 1.42 / 1.34 / 1.04 s) about
  every 27–28 s; E3a ≈ 1.2 s (385 steps in 2,159 intervals); **E3b runs 1–58 ≈ 2.3 s** (464 steps,
  the last at 2026-10-03 10:55:42); **none from ≈ 10:56** (the last 14 E3b runs and all of ops).
  Effect: negative minimum latencies; in E3b, Standard rounds with a step read below 99 TPS in 46 of
  60 rounds, step-free rounds in 0 of 30. Cause unknown (see `docs/STATUS.md` §5).
- **Windows memory:** paged pool 0.82–0.99 GB throughout (no GPU leak with the apps closed);
  "available" 0.5–2 GB during the ramp/E1/E2 runs and down to 0.42 GB during E3b (10 of 26
  half-hourly checks below 1.5 GB), the WSL VM holding up to 6.4 GB (Linux page cache); commit
  charge ≤ 23.7 of 31.7 GB. No run failed for it.
- **Failures:** every failure of the campaign is Fabric validation code 11 (`MVCC_READ_CONFLICT`,
  the trace race) per the `caliper.log` scan, all on Standard and Parallel, none on the anchored
  variants:

  | Stage | Failures | Transactions |
  |---|---|---|
  | E0 re-smoke | 0 | 2,332 |
  | ramp | 5 (Standard 1, Parallel 4) | 125,432 |
  | E1 | 6 (Parallel references) | 806,372 |
  | E2 | 47 | 520,796 |
  | E3a | 21 (Standard 8, Parallel 13) | 376,304 |
  | E3b | 57 (Standard 8, Parallel 49) | 2,083,118 |
  | ops | 0 | 31,200 |

  Transactions = Caliper's `succ` + `fail` over the timed rounds.

## 6. What a re-run must hold equal (campaign 2)

1. **Settings:** run on a commit whose six config blob SHAs (§1) and `sweeps.yaml` blob (`e7d3f72`)
   are unchanged; check that the first run's trace hash matches §2. Keep the baselines at 100 tx/s,
   batch 50, channels 20 / 50 even if campaign 2's ramp/E1/E2 suggest otherwise — apply nothing, or
   E3 stops being comparable.
2. **Images:** the 15 image IDs in §3 — never rebuild or pull. If Docker Desktop's image store is
   ever reset and images are rebuilt, record the new IDs: the re-run is then a different build.
3. **Environment:** `.wslconfig` `memory=10GB`; Docker Desktop 4.38.0 / engine 27.5.1; WSL 2.4.12;
   Windows build 26200.9457 — keep updates paused (the current pause ends 2026-10-22 14:49 UTC) and
   Store auto-updates off; AC power, Legion Balance Mode; the host preparation of §3; *Restart*
   before a stage (Fast Startup keeps leaked kernel memory across *Shut down*).
4. **Clock:** campaign 1 ran under three clock conditions (§5), so record campaign 2's per stage
   (the `caliper.log` scan) and compare like with like. Before starting, a short load test should
   show whether steps occur; a clocksource or `.wslconfig` change would break comparability.
5. **Results:** first move campaign 1's folders out of the way (done 2026-10-03 as
   `benchmark/results/campaign1-20261003/<exp>` and `docs/results/campaign1-20261003/<exp>`). Otherwise
   `--resume` skips campaign 1's complete runs and the Bench app's *Run…* deletes them.
6. **Order and scale:** ramp → E1 → E2 → E3a → E3b → ops at r = 3, ≈ 31 h of machine time
   (ramp 1 h 26 min, E1 5 h 33 min, E2 ≈ 4 h, E3a 4 h 06 min, E3b 13 h 14 min, ops 3 h 04 min).
7. **Comparison:** cell by cell against campaign 1 (same trace hashes); scripts kept outside the repo
   in `C:\Users\LENOVO\gleipnir-driver\` (`replication.py` compares identical cells across stages,
   `e3facts.py` provenance/failures/clock, `envcapture.sh` this environment table).
