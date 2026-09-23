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
| `up.sh --variant V [--channels N] [--skip-crypto]` | enroll → compose up → create channels (osnadmin, HTTP 201 on all 3 orderers) → deploy ccaas chaincode → start services |
| `down.sh [--wipe]` | stop all profiles; `--wipe` removes ALL named volumes incl. the library — never run it without the authors' go-ahead |
| `reset-network.sh --variant V --channels C` | **ledger-only reset**: needs `GLEIPNIR_ALLOW_LEDGER_WIPE=1`; prints and removes only the ledger/witness volumes, then `up.sh --skip-crypto` |
| `backup-volumes.sh <dir> [--restore]` | tar every `gleipnir_*` volume (one file each) via `alpine`; `--restore` untars them back |
| `provision-channel.sh case-NNN` | per-case channel + chaincode approve/commit (idempotent-safe); emits `benchmark/networks/<caseId>.yaml` |
| `teardown-channel.sh case-NNN` | `osnadmin channel remove` from orderers (peers can't un-join online — documented limit) |
| `smoke-standard.sh` | end-to-end via the gateway (create → transfer → access×2 → audit==4 → dispose → status DISPOSED → transfer fails) |
| `rounds.py --static` | the ONLY renderer of Caliper configs from `sweeps.yaml`: writes `benchmark/benchmarks/smoke-<variant>.yaml` and `benchmark/networks/parallel-c{C}.yaml`; library API `render_round(...)` for experiment.py |
| `experiment.py --exp e0\|ramp\|e1\|e2\|e3a\|e3b\|ops` | the campaign driver — plans cells × reps, runs the lifecycle below per run, loud failures |
| `checkpoint.py <run> --label tK` | `du -sb` block store per channel + GoLevelDB state per peer + receipt store → `checkpoints.jsonl` (labels `t0..tN`) |
| `collect.py <run-dir>` | run dir → `manifest.json` (rounds, per-tx percentiles, failure classes, resources, storage regression, anchoring, audit); `--selftest` |
| `report.py --exp E [--out docs/results/E]` | CSV + Markdown tables (units in headers, mean ± SD over reps) + optional PNG charts; E1's batch-size-free reference rows print `ref`, and the per-round tables (e3a, ops) carry a header note that the run-level metrics repeat per row |

`lib.sh` holds the shared helpers (compose wrapper, `peer_env`, `create_channel`, ccaas
packaging, `set_env_var`, `wait_raft_leader`, `wait_healthz`).

## experiment.py — plans and the run lifecycle

`--exp` selects the plan (brief 2026-09-22 §9); every run is **one network lifetime**:

| exp | variants | swept | fixed | rounds per run |
|---|---|---|---|---|
| `e0` | all 4 | — | smoke shape, `regimes.smoke.send_rate_tps`, 1 rep | per-op smoke rounds + `smoke-trace` (+ `smoke-verify` anchored) + audit; regime `smoke` |
| `ramp` | all 4 | send rate | `ramp.events_per_case_per_round`, 1 rep | one `rate<R>` round per send rate, ascending; prints throughput vs send rate + suggested `baseline.send_rate_tps` |
| `e1` | anchoring (1 ch), parallel-anchored (`baseline.channels`) + standard/parallel **reference** runs | `batch_sizes` | `baseline.send_rate_tps` | `workload.rounds` trace slices `slice<k>` |
| `e2` | parallel | `channel_counts` | `baseline.send_rate_tps` | `workload.rounds` slices; cases = channels unless `workload.cases` |
| `e3a` | all 4 | send rate | `baseline.batch_size`, `baseline.channels` | one `rate<R>` round per send rate, ascending |
| `e3b` | all 4 | `case_counts` ≤ `baseline.channels_max` | `baseline.send_rate_tps` | `workload.rounds` slices; parallel* channels = cases |
| `ops` | all 4 | operation | E3 point | `create transfer access dispose` (writes) `read-evidence read-trail` (reads) `verify-event` (anchored) |

Flags: `--variant V` (repeatable) · `--reps N` · `--resume` (skip runs whose manifest is
`status: complete`) · `--dry-run` (plan + ETA from `runlog.jsonl` medians, no docker) ·
`--reuse-network` (opt **out** of the per-run ledger reset; warned, valid for a single
ad-hoc run) · `--no-monitor` · `--no-audit`. `--fresh-network` still parses but is a no-op
kept so old command lines keep working — a fresh ledger is the default.

Per run, in order: (1) a re-executed run's `rounds/`, `checkpoints.jsonl`, `anchoring.json`,
`audit.json` and `manifest.json` are cleared (tx logs and checkpoints are **appended**, so a
retry left in place would be collected together with the previous attempt), then `run.json`
seeded — identity (exp/variant/levels/rep/regime) + provenance (git SHA, blob SHAs of the 6
network config files, `sweeps.yaml` SHA, trace hash+params, Caliper 0.6.0 +
`fabric:fabric-gateway` + connector, `FABRIC_TAG`, host cores/mem); (2) network:
`reset-network.sh` by default (refuses without `GLEIPNIR_ALLOW_LEDGER_WIPE=1` and prints the
exact command), or with `--reuse-network` the running stack must match (`.env VARIANT`;
missing `case-NNN` channels are provisioned, and a stack holding case channels the cell does
**not** use aborts the run); (3) anchored: `BATCH_SIZE`/`BATCH_FLUSH_MS`/fresh `BATCH_EPOCH`
in `.env`, batcher recreated; (4) trace generated or looked up
(`benchmark/traces/<hash>.json`); (5) checkpoint `t0`; (6) per round:
`rounds/<label>/bench.yaml` rendered, `npx caliper launch manager` in `benchmark/` with
`GLEIPNIR_TXLOG_DIR GATEWAY_URL BATCHER_URL GLEIPNIR_TOKEN`, log tee'd to `caliper.log`;
anchored runs then settle the batcher (poll `/status` until no root is `pending`) — and on
the **last** round `POST /flush` + `GET /status` → `anchoring.json` **before** the checkpoint,
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

## Results layout

```
benchmark/results/<exp>/<variant>/<levels>/r<rep>/     levels = batch<N>-ch<C>-cases<K>[-ref]
  run.json            seeded identity + provenance (experiment.py)
  rounds/<label>/     bench.yaml round.json caliper.log report.html tx-w<i>.jsonl
  checkpoints.jsonl   t0..tN storage rows (checkpoint.py)
  anchoring.json      batcher /status after the final flush (anchored variants)
  audit.json          reconstruct.js output
  manifest.json       collect.py — the file report.py reads
benchmark/results/runlog.jsonl   {runId, exp, variant, levels, rep, startedAt, finishedAt, wallSeconds, status}
benchmark/traces/<hash>.json     deterministic transaction traces (gitignored)
```

## Ledger-only reset and the backup rule

`reset-network.sh` removes exactly `gleipnir_{orderer0,orderer1,orderer2,peer0org1,peer0org2,peer0anchor}-ledger`,
`gleipnir_receipt-data`, `gleipnir_verify-metrics`, deletes `network/channel-artifacts`, unsets
the ccaas ids and re-runs `up.sh --skip-crypto`. It never touches `gateway-auth-data`,
`case-registry-data`, `evidence-blob-data`, CA state or `network/organizations`. **Rule:**
run `backup-volumes.sh <dir>` before the first reset of a campaign (and before any
`down.sh --wipe`, which is never run without asking the authors).

## Metrics contract (manifest.json)

Top level: `runId, experiment, variant, levels{batchSize,channels,cases,sendRateTps,reference},
repetition, regime, status, trace{hash,params,opCounts}, rounds[], storage{}, anchoring, audit,
payloadCompressionVsBaseline?, provenance{gitCommit,configShas,sweepsSha,caliper,fabricTag,host},
startedAt, finishedAt, wallSeconds`.

- Throughput: **successful-only** = Caliper reported × Succ/(Succ+Fail) (issue #1418);
  multi-channel rounds are aggregate across channels with `perChannelTpsDerived`.
- Latency: Caliper min/avg/max per round + p50/p95/p99 from the per-transaction JSONL the
  workloads write (`GLEIPNIR_TXLOG_DIR`), per round and per operation type; measured send rate.
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
  batches also reported excluded); audit reconstruction time per case from `audit.json`.

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
- `experiment.py --reuse-network` aborts on a variant mismatch with the running stack and on
  case channels the cell does not use (an idle 50-channel stack must not serve a 5-channel
  cell — the idle ledger dirs would enter the checkpoint series).
- `experiment.py` aborts on a
  Caliper round without a results table, on a trace generator that prints no hash, and on a
  manifest without rounds; every failed run still gets a `status: failed` runlog line.
- `collect.py` marks a run `incomplete` when no round summary row parses.

## Verify (no live network)

```bash
bash -n up.sh down.sh reset-network.sh backup-volumes.sh provision-channel.sh teardown-channel.sh smoke-standard.sh lib.sh
python -m py_compile rounds.py experiment.py collect.py report.py checkpoint.py
python rounds.py --static
python collect.py --selftest
python experiment.py --exp e3a --dry-run
python report.py --help
```
