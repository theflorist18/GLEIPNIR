# orchestration

**Responsibility:** automate the network lifecycle and the experiment campaign —
variant bring-up, per-case channel provisioning, the ledger-only reset between runs,
benchconfig rendering from `benchmark/sweeps.yaml`, Caliper launches, storage
checkpoints, metrics collection and the report tables/charts. Used by **all variants**.

Bash scripts target Ubuntu 22.04 / WSL2 and drive Fabric admin ops inside the `cli`
fabric-tools container. Python 3.10+ with `pyyaml` (`pip install -r requirements.txt`;
`matplotlib` is optional, charts only). Host prereqs: docker + compose v2,
`fabric-ca-client`, `curl`, `jq`, Node 20 (`npx caliper` in `benchmark/`).

## Entry points

| Script | Does |
|---|---|
| `up.sh --variant V [--channels N] [--endorsement any\|all] [--skip-crypto]` | enroll → compose up → wait until the peers answer `/healthz` and serve gRPC (`wait_peer_grpc`) → create channels (osnadmin, HTTP 201 on all 3 orderers) → deploy ccaas chaincode with the endorsement policy (`any` = 1-of-any, the default; `all` = 2-of-2; written to `.env` `ENDORSEMENT`) → start services |
| `down.sh [--wipe]` | stop all profiles; `--wipe` removes ALL named volumes incl. the evidence library — back them up first (`backup-volumes.sh`) |
| `reset-network.sh --variant V --channels C [--endorsement any\|all]` | **ledger-only reset**: needs `GLEIPNIR_ALLOW_LEDGER_WIPE=1`; prints and removes only the ledger/witness volumes, then `up.sh --skip-crypto` with the same endorsement policy (default `any`) |
| `backup-volumes.sh <dir> [--restore]` | tar every `gleipnir_*` volume (one file each) via `alpine`; `--restore` untars them back |
| `provision-channel.sh case-NNN` | per-case channel + chaincode approve/commit with the stack's endorsement policy (`.env` `ENDORSEMENT`) (idempotent-safe) |
| `smoke-standard.sh` | end-to-end via the gateway (create → transfer → access×2 → audit==4 → dispose → status DISPOSED → transfer fails) |
| `smoke-library.sh` | evidence-library gate on the standard variant (login/roles → case + participant → multipart ingest → categorize → search → auto-log asserts → authz negatives), 17 steps |
| `crash-test.sh [--events K] [--out FILE]` | fault-injection check on an anchored stack (for Parallel-Anchored: channel `case-001`): K events (default 5, fewer than the batch size) for one new evidence are accepted (202) into an open batch; the batcher is killed (SIGKILL) and started again, then flushed. Checks that no receipt, trail entry or root of those events survived (exit 0 = all lost, the documented behavior; 1 = something survived; 2 = no usable answer from the stack) and reports whether the restarted container kept `BATCH_EPOCH` (it then numbers its batches from `b000000` again and can reuse batch ids already on the ledger). Side effects: before the test it re-creates the batcher with a new fixed `BATCH_EPOCH` (`crash-test-<unix time>`, written to `network/compose/.env`), so the test's batch id cannot already be on the ledger, and when the restart kept that epoch it re-creates the batcher once more with an empty `BATCH_EPOCH`. A functional test, not a benchmark run |
| `tamper-test.sh [--out FILE]` | fault-injection check on an anchored stack (for Parallel-Anchored: channel `case-001`): one new evidence, 4 events, flushed; then, one at a time and undone after: a changed event copy and a changed sibling path → verify `root-mismatch`; a deleted receipt → verify `missing-receipt`, trail one event shorter, the on-chain root's `leafCount` unchanged; a replay through the gateway → a new eventId; a replay into the batcher with the same eventId → 409 inside the open batch, 202 after it, receipt overwritten. Exit 0 when every outcome is the documented one, 1 otherwise, 2 when the stack gives no usable answer. Side effect: it first re-creates the batcher with an empty `BATCH_EPOCH` (in `network/compose/.env`), so no batch id of the test can already be on the ledger. A functional test, not chaincode security tooling |
| `build-images.sh` | dev-host workaround, not product code: builds all 8 compose images with the host's MITM-proxy CA injected at build time only (`GLEIPNIR_CA_BUNDLE=<bundle> bash orchestration/build-images.sh`); the tracked Dockerfiles are untouched. Afterwards check that the dependencies really resolve inside each Node image — npm can exit 0 with nothing installed when TLS fails |
| `rounds.py` (library) | the ONLY renderer of Caliper configs from `sweeps.yaml`: `render_round(...)` and `render_parallel_network(C)`, which experiment.py writes per run into the run dir (no generated config is committed) |
| `benchapp.pyw` | the desktop app: input boxes for the `sweeps.yaml` workload, grid and baseline values, Preview/Run/Resume/Cancel of each experiment through WSL, live results, history, CSV export, suggested baselines, automatic backup/restore — see below |
| `open-web.ps1` (double-click `GLEIPNIR Web.cmd` in the repo root) | opens the evidence library: if `:8081/healthz` is down it starts Docker Desktop, starts the stack on its existing volumes (the Bench app's restore-path command, never `up.sh`), waits for the gateway, then opens the SPA in a Chrome app window with its own profile (`%LOCALAPPDATA%\GleipnirWeb`, so no shared browser cache); default browser if Chrome is absent |
| `experiment.py --exp e0\|ramp\|e1\|e2\|e3a\|e3b\|e3c\|ops\|sens\|cell` | the campaign driver — plans cells × reps, runs the lifecycle below per run, loud failures; `e3a` adds its climb runs as the results come in; `cell` runs ONE cell at the factor levels you pass |
| `checkpoint.py <run> --label tK` | `du -sb` block store per channel + GoLevelDB state per peer + receipt store → `checkpoints.jsonl` (labels `t0..tN`) |
| `collect.py <run-dir>` | run dir → `manifest.json` (rounds, per-tx percentiles, finalization, failure classes, resources, storage regression, anchoring, audit); `--selftest` |
| `report.py --exp E [--out docs/results/E] [--no-charts] [--decimal-comma]` | ALWAYS the per-round Excel CSV `benchmark/results/E/E-results.csv` (any E incl. e0/ramp/cell); for e1, e2, e3a, e3b, e3c, ops and sens also CSV + Markdown tables (units in headers, mean ± SD over reps; Markdown one table per variant, one latency column; the last columns are measured send rate, finalized throughput, finalization latency avg / p95 and audit time per event) + optional PNG charts (none for ops and sens, whose X is no number); E1's batch-size-free reference rows print `ref`, and the per-round tables (e3a, ops) carry a header note that the run-level metrics repeat per row; e3a also writes `e3a-saturation.json` (per variant: saturation, kept-up, load-generator-limit and latency-knee send rates) |
| `present.py [--out docs/results/pooled-c1-c5]` (Windows, `py -3.11`; needs openpyxl) | campaigns 1–5 pooled: every cell's mean ± sample SD over its 15 runs (5 campaigns × 3 reps), read from the campaign archives through `report.py`'s own functions. Writes `gleipnir-results-pooled-c1-c5.xlsx` (README; one sheet per table with mean/SD as Excel formulas over the runs and native charts with ±1 SD error bars; one runs sheet per experiment with the 15 run values and each campaign's own mean/SD). Stops unless every cell has exactly 15 runs and each campaign's means equal its published table. Does not change any per-campaign table |

`lib.sh` holds the shared helpers (compose wrapper, `peer_env`, `create_channel`,
`app_channel` / `deploy_app_chaincode` (shared by up.sh and provision-channel.sh),
`endorsement_policy` (`ENDORSEMENT` in `.env` → `OR(...)` or `AND(...)`; empty = `any`), ccaas
packaging, `set_env_var`, `wait_raft_leader`, `wait_healthz`, `wait_peer_grpc`). `wait_peer_grpc
<org>` retries `peer channel list` in the cli container until the peer answers gRPC: a peer's
operations `/healthz` can answer before its gRPC endpoint serves, and a lifecycle command sent
in that window fails to connect ("context deadline exceeded").

There is no anchor-client, anchor org (`peer0-anchor`, `ca-anchor`) or anchor channel any
more. The earlier Parallel-Anchored design (campaigns 1–5, git commit `573017b`) committed its
roots to an `anchor-main` channel through a separate anchor-client service; now the batcher
commits every root through the gateway on the case's own channel. `collect.py` keeps its `anchor-main`
accounting only so the run folders of campaigns 1–5 re-collect to the same numbers; for
current runs `anchorChannelDeltaBytes` is 0.

## experiment.py — plans and the run lifecycle

`--exp` selects the plan (docs/methodology/experiments.md §3); every run is **one network lifetime**:

| exp | variants | swept | fixed | rounds per run |
|---|---|---|---|---|
| `e0` | all 4 | — | smoke shape, `regimes.smoke.send_rate_tps`, 1 rep; parallel* on one channel per smoke case (10) | per-op smoke rounds + `smoke-trace` (+ `smoke-verify` anchored) + audit; regime `smoke` |
| `ramp` | all 4 | send rate | `ramp.events_per_case_per_round`, 1 rep | one `rate<R>` round per send rate, ascending; prints throughput vs send rate + suggested `baseline.send_rate_tps` |
| `e1` | anchoring (1 ch), parallel-anchored (`baseline.channels`) + standard/parallel **reference** runs | `batch_sizes` | `baseline.send_rate_tps` | `workload.rounds` trace slices `slice<k>` |
| `e2` | parallel | `channel_counts` | `baseline.send_rate_tps` | `workload.rounds` slices; cases = channels (one channel per case) |
| `e3a` | all 4 | send rate: the base ladder `e3a.send_rates_tps`, then the climb | `baseline.batch_size`, `baseline.channels` cases, `e3a.events_per_case_per_round` (climb runs: sized by `e3a.climb.min_send_s`) | one `rate<R>` round per send rate, ascending (8 on the base ladder, 4 per climb run, 1 for a midpoint run) |
| `e3b` | all 4 | `case_counts` ≤ `baseline.channels_max` | `baseline.send_rate_tps` (the total) | `workload.rounds` slices; parallel* channels = cases |
| `e3c` | all 4 | `e3c.case_counts` ≤ `baseline.channels_max` | send rate = cases × `e3c.send_rate_per_case_tps` | `workload.rounds` slices; parallel* channels = cases |
| `ops` | all 4 | operation | E3 point | `create transfer access dispose` (writes) `read-evidence read-trail` (reads) `verify-event` (anchored) |
| `sens` | all 4; a cell that overrides only `anchoring.*` (`idle-5s`): the anchored variants | the cells of `sweeps.yaml` `sensitivity` (name → `sweeps.yaml` path overrides) | the baseline point | `workload.rounds` slices; runs go repetition by repetition (every cell once, then again); the cell name tags the levels dir and `run.json` `cell` |
| `cell` | all 4 (or `--variant`) | — (one cell) | factors `--send-rate R…` `--batch-size B` `--cases N` (= channels on parallel*) + any control flag below, each defaulting to its `sweeps.yaml` value | several send rates → one `rate<R>` round each, ascending; one → `workload.rounds` slices. Results in `results/cell/`; report.py exports them to CSV but builds no aggregated table |

Flags: `--variant V` (repeatable) · `--reps N` · `--resume` (skip runs whose manifest is
`status: complete`) · `--dry-run` (plan + ETA from `runlog.jsonl` medians, no docker) ·
`--reuse-network` (opt **out** of the per-run ledger reset; warned, valid for a single
ad-hoc run) · `--no-monitor` · `--no-audit` · `--verbose` (echo Caliper's full output) ·
`--sweeps FILE` (its blob SHA is what `run.json` records). A fresh ledger is the default. A
repeated `--variant` is de-duplicated.

**E3a climb.** After the base ladder, `e3a_next_runs` plans the same climb run for every variant
(`e3a.climb.send_rates_tps`, up to the common top), then judges each variant on its complete runs
(`report.e3a_verdict`: the reps' mean per send rate, docs/methodology/experiments.md §4.5): a
first saturated rate that follows a rate that kept up gets one midpoint run halfway between the
two (dir tag `-midpoint`); every other variant is done. E3a runs with `e3a.workers` Caliper
workers (`e3a_sweeps`). A step with missing repetitions is planned again first. `results/e3a/e3a-climb.json` is rewritten after every step; `--resume`
re-derives the climb from the complete runs, and `--dry-run` shows the base ladder only. The
verdict reads every complete manifest under `results/e3a/`, so archive an earlier campaign's
E3a runs before a new one starts.

**Progress.** Every run prints `##### [run i/n | x % done | elapsed | ETA] #####` (ETA = median
wall time of this session's runs, else of `runlog.jsonl`), every round `--- round j/m: <label> |
send rate R tx/s | N tx` and, when it ends, one line: success / failure (failure rate %) /
throughput TPS / latency avg (min - max), p95. Caliper's own output is cut to its
`Transaction Info` progress lines plus warnings/errors; `--verbose` shows everything, and the
full log is always in `rounds/<label>/caliper.log`.

**Results CSV (Excel).** After every completed run `benchmark/results/<exp>/<exp>-results.csv`
is rewritten from every complete manifest of that experiment (`report.export_rounds`): one row
per run × round, every factor level, control and metric in its own numeric column with the
unit in the header, in this column order: send rate (tx/s), throughput (TPS),
latency min / max / avg / p95 (s), CPU (%), memory (MB), success (n), failure (n), failure rate
(%) — then measured send rate, per-channel throughput, p50/p99, fabric/off-chain CPU+memory, the
six failure classes, storage bytes/event, audit time, anchoring delay, regime, least-loaded
channel write events, every control (seed, workers, evidence/case, events/case/round, trace
rounds, mix, payload, audit cases, flush timeout, monitor interval), overrides, trace hash, git
SHA, start time, run wall time, then finalized throughput, finalization latency avg / p95,
finalized / not finalized / paused events, audit time per event, idle timeout, endorsement and
sensitivity cell; rows in numeric level order (batch10 before batch25). UTF-8 with BOM (Excel opens it
directly). If the CSV is open in Excel when a run ends, the refresh only warns — the campaign
continues and the next run rewrites it. For an Excel whose
regional settings use a decimal comma: `python3 report.py --exp <exp> --decimal-comma`
(`;`-separated). `report.py --exp e0|ramp|cell` writes only this CSV; e1, e2, e3a, e3b, e3c,
ops and sens add the mean ± SD tables (Markdown: one table per variant, latency as one
"avg (min–max), p95" column) and, with matplotlib, the charts (not for ops and sens).

`--exp cell` **factor** flags (the independent variables; rejected on any other `--exp`):
`--send-rate R [R ...]` (repeatable) is the **configured send rate** in tx/s — it is written
into the round as Caliper's `fixed-rate` `opts.tps`, which is only that controller's key name;
the measured output is throughput. `--batch-size` applies to the anchored variants.
`--cases N` applies to every variant (same trace) and is also the channel count on Parallel and
Parallel-Anchored — **one channel per case, in every plan** (docs/methodology/experiments.md §4.4), so there
is no `--channels`; Standard and Anchoring put the same N cases on their one shared channel.
Default: `baseline.channels` in `sweeps.yaml` (the set case count). A flag no selected variant
uses, or a level < 1, aborts before anything runs.

`--exp cell` **control** flags (the controlled workload, docs/methodology/experiments.md §2.2; also cell
only): `--seed`, `--workers`, `--rounds` (one send rate only), `--events-per-case` (a round
submits cases × this transactions), `--evidence-per-case`, `--transfer-weight`,
`--access-weight`, `--dispose-fraction` (0–1), `--payload-bytes`, `--audit-cases`,
`--flush-timeout-ms` (the batcher's age timer), `--idle-timeout-ms` (its idle timer),
`--endorsement any|all`, `--monitor-interval`. They override an in-memory copy of `sweeps.yaml`
(the file is never rewritten), are recorded in `run.json` `overrides`, and tag the run dir
`-x<hash>` so a changed workload never shares a dir (or a `--resume`) with the defaults. The
trace is generated BEFORE the ledger reset, so a bad control fails without costing a network
lifetime. Examples:

```bash
# one like-for-like probe of all four variants, one rep, three send rates
GLEIPNIR_ALLOW_LEDGER_WIPE=1 python3 -u experiment.py --exp cell --reps 1 \
  --send-rate 25 50 100 --batch-size 50 --cases 10
# "sweep small first": a short, light Parallel probe
GLEIPNIR_ALLOW_LEDGER_WIPE=1 python3 -u experiment.py --exp cell --variant parallel --reps 1 \
  --send-rate 25 --cases 5 --rounds 2 --events-per-case 40
```

Per run, in order: (1) a re-executed run's `rounds/`, `checkpoints.jsonl`, `anchoring.json`,
`audit.json` and `manifest.json` are cleared (tx logs and checkpoints are **appended**, so a
retry left in place would be collected together with the previous attempt), then `run.json`
seeded — identity (exp/variant/levels/rep/regime) + provenance (git SHA, blob SHAs of the 6
network config files, `sweeps.yaml` SHA, trace hash+params, Caliper 0.6.0 +
`fabric:fabric-gateway` + connector, `FABRIC_TAG`, host cores/mem) + `controls` (incl.
`flushTimeoutMs`, `idleTimeoutMs`, `endorsement`)/`overrides` (+ `cell` on `sens` runs; each run
carries its own effective constants);
(2) anchored: `BATCH_SIZE`/`BATCH_FLUSH_MS`/`BATCH_IDLE_MS`/fresh `BATCH_EPOCH` in `.env`; (3) trace generated
or looked up (`benchmark/traces/<hash>.json`) BEFORE the reset, and a `steady` label re-checked
against the trace's ACTUAL least-loaded channel (below the floor → `sub-floor`, printed);
(4) network: `reset-network.sh --endorsement <the run's policy>` by default (refuses without
`GLEIPNIR_ALLOW_LEDGER_WIPE=1` and prints the exact command), or with `--reuse-network` the
running stack must match (`.env` `VARIANT` and `ENDORSEMENT`; missing `case-NNN` channels are
provisioned, and a stack holding case channels the
cell does **not** use aborts the run); (5) anchored: batcher recreated, then checkpoint `t0`;
(6) per round:
`rounds/<label>/bench.yaml` rendered, `npx caliper launch manager` in `benchmark/` with
`GLEIPNIR_TXLOG_DIR GATEWAY_URL BATCHER_URL GLEIPNIR_TOKEN`, log tee'd to `caliper.log`;
anchored runs then settle the batcher (poll `/status` until no root is `pending`) — and on
the **last** round `POST /flush` + `GET /status?events=1` (the batch records with each event's
enqueue time) → `anchoring.json` **before** the checkpoint,
so the run-end partial batch's bytes fall inside the `t0→tN` delta — then checkpoint
`t<k+1>`; (7) `node benchmark/audit/reconstruct.js` → `audit.json`; (8) `collect.py` →
`manifest.json` (`status: complete`); (9) one line appended to
`benchmark/results/runlog.jsonl`.

Why fresh by default: the trace replays deterministic evidence ids, so a second run on the
same ledger duplicates `CreateEvidence` on the direct-write variants, appends duplicate events
to the off-chain trail on the anchored ones, and starts the storage series dirty. The reset
still removes only the ledger/receipt/verify-metrics volumes.

Steady floor: regime `steady` only when planned write events per channel ≥
`regimes.steady.min_events_per_channel`, else `sub-floor` (warned at plan time); `e0` is
always `smoke`, and `ops`/`ramp` are always `sub-floor` regardless of the arithmetic (the
floor rule divides by channel count, so it would label the same workload `steady` on the
single-channel variants and `sub-floor` on the multi-channel ones). Smoke and steady
artifacts never share a results directory.

## benchapp.pyw — the desktop app

Double-click `orchestration/benchapp.pyw` (or `pyw -3.11 orchestration\benchapp.pyw`) on the
Windows host. It needs nothing beyond the host's Python 3.11 (tkinter, PyYAML; matplotlib for
charts) and the WSL `Ubuntu-22.04` distro the benchmark already runs in. `benchcore.py` holds
everything that is not a widget; `test_benchapp.py` checks it.

Look: `benchtheme.py` (named ttk styles on the
native vista theme, tooltip / help-icon / log / row-tag specs), `icons/` (16 px Tk PNGs, rest +
disabled, and the 12 px variant markers, rendered from vector symbols; the app is
not DPI-aware, so only the @1x set is used). The report charts use `gleipnir.mplstyle` +
`variant_style.py` (colour, marker and dash looked up by variant slug, never by the
matplotlib colour cycle); `benchtheme.VARIANT` is the same table, so the app and the charts
share one label/colour source.

| Tab | Input boxes (each `sweeps.yaml` value the app shows is editable in exactly one place) |
|---|---|
| Settings & Baselines | controlled workload (seed, workers, repetitions, evidence/case, events/case/round, rounds, mix, **evidence file size (B) — off-chain; only its hash goes on-chain**, audit cases, the batcher's age and idle timers, monitor interval, steady floor) and the four baselines with their provenance note |
| E0 initial test | smoke shape + ramp events + send-rate grid; smoke or ramp; variants. Suggests `baseline.send_rate_tps` (and a trimmed grid) from the ramp |
| E1 batch size | batch-size grid; anchored variants + Standard/Parallel reference lines; reps. Suggests `baseline.batch_size` (docs/methodology/experiments.md §4.1) |
| E2 channels | channel (= case) grid; reps. Suggests `baseline.channels` (median of the healthy range) + `channels_max` (docs/methodology/experiments.md §4.2) |
| E3 main | E3a / E3b / E3c / per-operation / sensitivity cells; input boxes for the E3b case grid and the E3a base ladder (`e3a.send_rates_tps`, `e3a.events_per_case_per_round`); variants; reps — the four baselines shown read-only, with a warning while a baseline is still a placeholder. The E3a ratios and climb rule, `e3c`, `sensitivity` and `endorsement` have no input box: edit them in `sweeps.yaml` |
| Custom test | `--exp cell`: send rates, batch size, cases + the 14 control overrides (incl. the idle timer and `--endorsement`) |
| History & results | every run from `runlog.jsonl`; a run's per-round table in the results-CSV columns; **Export per-round CSV** (Excel, decimal-comma option), **Export summary tables**, **Generate tables + charts** (e1, e2, e3a, e3b, e3c, ops, sens) |

- **Preview plan** = `experiment.py … --dry-run` (run list, regimes, sub-floor warnings, ETA).
  **Run** = Preview → a confirm dialog (plan, what gets wiped, baselines, uncommitted-sweeps
  warning) → backup → the experiment. **Resume** adds `--resume` (a plan with nothing left
  stops before the backup). **Cancel** SIGINTs the process group of the app's OWN run (tagged
  `-X benchapp`; Caliper included; a terminal campaign is never touched); after 30 s a second
  click SIGKILLs. During a Preview or backup it only stops what comes next; it is unavailable
  during a restore. A **reuse the running ledger** cell is not backed up (nothing is reset).
  Save / Use as baseline are refused while a benchmark runs.
- **Live panel:** run i/n with elapsed/ETA, the current round with Caliper's
  submitted/succeeded/failed counts, and one results row per finished round (CPU, memory and the
  run's on-chain / off-chain bytes per event are filled in once the run is collected — the same
  columns appear in History, so an odd storage value can be spotted before exporting). The raw log is kept in `benchmark/results/benchapp-logs/`.
- **Backups:** every run resets the ledger, which erases the custody trails of any manually entered test data, so the
  app first stops the stack (never `--wipe`), copies every `gleipnir_*` volume + `.env` to
  `backups/<timestamp>/` and verifies the archives; the experiment starts only if that worked.
  **Restore my test data** stops the stack, replaces every volume from a chosen backup,
  restores its `.env` and starts that stack again (never `up.sh`). A backup is complete only
  when its `backup.json` exists.
- **Baselines** are suggested by the methodology rules and written only on "Use as baseline"
  (tagged `[set from <exp> <date>]`); a hand edit is tagged `[set by hand <date>]`. Thresholds
  and the minimum-over-variants send-rate reading are open defaults (docs/methodology/experiments.md §4.3, §8).
- Closing the app during a run cancels it (Resume it later). The host is kept awake while an
  experiment runs.

## Results layout

```
benchmark/results/<exp>/<exp>-results.csv            per-round Excel export (rewritten after every run)
benchmark/results/e3a/e3a-climb.json                 E3a climb: the rule + every variant's points, verdict, next step
benchmark/results/<exp>/<variant>/<levels>/r<rep>/     levels = batch<N>-ch<C>-cases<K>[-ref]
                                                       (cell: + -rate<R>[-<R>...] [-x<overrides hash>];
                                                        e3a climb: + -rate<R>-<R>-…, midpoint: + -rate<R>-midpoint;
                                                        sens: + -<cell>)
  run.json            seeded identity + provenance (experiment.py)
  parallel-c<C>.yaml  Caliper network config (parallel only; rounds.py)
  rounds/<label>/     bench.yaml round.json caliper.log report.html tx-w<i>.jsonl
  checkpoints.jsonl   t0..tN storage rows (checkpoint.py)
  anchoring.json      batcher /status?events=1 after the final flush (anchored variants)
  audit.json          reconstruct.js output
  manifest.json       collect.py — the file report.py reads
benchmark/results/runlog.jsonl   {runId, exp, variant, levels, rep, startedAt, finishedAt, wallSeconds, status}
benchmark/traces/<hash>.json     deterministic transaction traces (gitignored)
```

## Ledger-only reset and the backup rule

`reset-network.sh` removes exactly `gleipnir_{orderer0,orderer1,orderer2,peer0org1,peer0org2}-ledger`,
`gleipnir_receipt-data`, `gleipnir_verify-metrics`, deletes `network/channel-artifacts`, unsets
`CCAAS_ID_APP` and re-runs `up.sh --skip-crypto` with its `--endorsement` (default `any`). It never touches `gateway-auth-data`,
`case-registry-data`, `evidence-blob-data`, CA state or `network/organizations`. **Rule:**
run `backup-volumes.sh <dir>` before the first reset of a campaign (and before any
`down.sh --wipe`, which also removes the library volumes).

## Metrics contract (manifest.json)

Top level: `runId, experiment, variant, levels{batchSize,channels,cases,sendRateTps,reference},
repetition, regime, status, trace{hash,params,opCounts}, rounds[], storage{}, anchoring, audit,
payloadCompressionVsBaseline?, controls{workers,evidencePerCase,payloadBytes,auditCases,flushTimeoutMs,
idleTimeoutMs,endorsement,monitorIntervalS}, overrides{}, cell? (sens), minChannelWriteEvents,
provenance{gitCommit,configShas,sweepsSha,sweepsPath,caliper,fabricTag,host},
startedAt, finishedAt, wallSeconds`.

- Throughput: **successful-only** = Caliper reported × Succ/(Succ+Fail) (issue #1418);
  multi-channel rounds are aggregate across channels with `perChannelTpsDerived`.
- Latency: Caliper min/avg/max per round + p50/p95/p99 from the per-transaction JSONL the
  workloads write (`GLEIPNIR_TXLOG_DIR`), per round and per operation type; measured send rate.
  On the anchored variants this is acceptance (HTTP 202) latency.
- Finalization, per round (`rounds[].finalization`, over the successful timed writes):
  `{basis: "commit"|"root-commit", finalized, notFinalized, pausedEvents,
  latencyMs{min,p50,p95,p99,max,mean,n}, finalizedTps, windowS}`. Integrity finalization =
  submission (Caliper's create time) → the event's own commit (`tFinal`, Standard/Parallel) or
  the commit of its batch's root (anchored: the tx-log line's `batchId` → that batch's
  `committedAt` in `anchoring.json`; a batch never committed → not finalized). `finalizedTps` =
  the least-squares slope of the cumulative finalizations over [the first finalization after the round's first submission, its last submission] (anchored: every root committed in that window, weighted by its leafCount, a batch carried over from the previous round included) (`windowS`).
  `pausedEvents` = finalized events whose batch closed after the round's last accepted write (they
  waited for the next round or the run-end flush: a known limit of size-only batching across
  rounds).
- Success/failure counts, failure rate (%), classes `MVCC_READ_CONFLICT`,
  `ENDORSEMENT_POLICY_FAILURE`, `TIMEOUT`, `HTTP_4XX`, `HTTP_5XX`, `OTHER` — all computed over
  the **timed** tx-log records only (`timed: false` lines are untimed seeding, see below). A
  round that had failures also gets `failureClassesLogScan`: a `caliper.log` regex scan
  (`MVCC_READ_CONFLICT` / `ENDORSEMENT_POLICY_FAILURE` / `TIMEOUT` counts plus a raw
  `fabricStatusCodes` map), reported **alongside** and never merged into the tx-log classes,
  because the pinned caliper-fabric 0.6.0 peer-gateway connector never calls `SetErrMsg`, so
  fabric-mode failures carry no per-transaction error string.
- `untimedWrites` per round: successful write ops logged with `timed: false` — the pool/verify
  seeding, which commits real transactions outside the measured phase. The storage denominator
  is **timed successful writes + `untimedWrites`**; counting only the timed ones divides an
  `ops` round's block-store growth by a fraction of the events that produced it.
- CPU (%) / memory (MB) per container from Caliper's docker monitor (container names carry
  the leading slash in the benchconfig), plus groups `fabric`, `offchain`, `all`.
- Storage: `du -sb` on the named volumes; bytes/event = OLS slope over the `t0..tN`
  checkpoint series (≥ 3 points) with the t0→tN delta as cross-check; off-chain receipt
  store reported separately. Compression vs Standard (`--baseline`) is the reduction in
  on-chain bytes/event — never 1/N of total ledger size. A flat series gets `r2: null`, not
  `1.0` — there is no variance to explain, and `1.0` would dress a dead probe as a perfect
  fit. If the **last** checkpoint has no block-store rows for the hosting peer (container or
  channel name drift, or `du` failing inside the container), `storage` is omitted entirely
  with a printed warning, so `report.py` prints `-` instead of "0 bytes/event".
- Anchoring delay (s) from the batcher's per-batch `delayMs` (leafCount-weighted; forced
  batches also reported excluded), exact per event (`delayPerEventMs`, from each event's
  `enqueuedAtMs`), `closeReasons` {size, idle, timeout, flush: count} and `idleTimeoutMs`;
  audit reconstruction time per case and per event (`summary.msPerEvent`) from `audit.json`.
- Storage on runs of the earlier Parallel-Anchored design also counts the `anchor-main` block
  store (`anchorChannelDeltaBytes`, read from the old anchor org's peer `peer0.anchor.example.com`);
  current runs have no anchor channel, so it is 0.

"Send rate" is the configured input; "throughput" is measured; "baseline" values are
calibrated, never "optimal".

## Does NOT

- Generate load itself (Caliper does), render configs anywhere but `rounds.py`, or draw
  scalability claims from `smoke`/`sub-floor` runs.
- Wipe a ledger without `GLEIPNIR_ALLOW_LEDGER_WIPE=1`, or ever remove the library volumes.
- Harden the receipt store or retry MVCC conflicts client-side (conflict avoidance is structural).

## Failure modes

- `reset-network.sh` exits 2 without the env flag; a volume still in use aborts the reset
  (never continues onto a dirty ledger).
- `experiment.py --reuse-network` aborts on a variant or endorsement-policy mismatch with the
  running stack and on case channels the cell does not use (an idle 50-channel stack must not
  serve a 5-channel cell — the idle ledger dirs would enter the checkpoint series).
- `up.sh` refuses an `--endorsement` other than `any`/`all`; `wait_peer_grpc` gives up after 30
  tries 2 s apart ("timeout waiting for peer0-<org> to serve gRPC").
- `experiment.py` aborts on a
  Caliper round without a results table, on a trace generator that prints no hash, and on a
  manifest without rounds; every failed run still gets a `status: failed` runlog line.
- `collect.py` marks a run `incomplete` when no round summary row parses.

## Verify (no live network)

```bash
bash -n up.sh down.sh reset-network.sh backup-volumes.sh provision-channel.sh smoke-standard.sh lib.sh \
  crash-test.sh tamper-test.sh
python -m py_compile rounds.py experiment.py collect.py report.py checkpoint.py
python collect.py --selftest
python experiment.py --exp e3a --dry-run
python experiment.py --exp cell --send-rate 25 50 --cases 7 --dry-run
python experiment.py --exp cell --variant parallel --cases 5 --rounds 2 --seed 7 --dry-run
python test_experiment.py
python test_benchapp.py
python report.py --help
```
