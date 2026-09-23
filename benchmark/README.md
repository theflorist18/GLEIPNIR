# benchmark

**Responsibility:** the Hyperledger **Caliper 0.6.0** workspace — the seeded transaction-trace
generator, the workload modules (trace replay + per-operation rounds + reads + verify), the
custom REST connector, per-transaction capture, the audit-reconstruction harness, and the
per-variant network configs. Drives all four variants identically; `orchestration/rounds.py`
renders the round configs, `orchestration/experiment.py` runs them, `orchestration/collect.py`
reads the outputs.

## Binding (record the exact string — CLAUDE.md stale-knowledge trap)

```bash
npm install
npm run bind           # == npx caliper bind --caliper-bind-sut fabric:fabric-gateway
```

`fabric:fabric-gateway` selects the **peer-gateway connector** (installs
`@hyperledger/fabric-gateway@1.5.0` + `@grpc/grpc-js@1.10.3`). `fabric:2.5`, `fabric:2.4`,
`fabric:3` are byte-identical aliases of the same binding (docs/research/caliper-0.6.0.md
Q1). Node 18 or 20 (0.6.0 support window).

## Layout

| Path | What |
|---|---|
| `sweeps.yaml` | **single source of truth** for the E1/E2/E3 grids, baseline constants, workload shape (CONTRACTS §10) |
| `trace/generate.js` | seeded (mulberry32) transaction-trace generator — `npm run gen:trace` |
| `workload/trace.js` | mixed-workload round: replays one slice of the pre-generated trace (E1/E2/E3) |
| `workload/{createEvidence,transferCustody,accessLog,disposeEvidence}.js` | per-operation WRITE rounds (ops breakdown) |
| `workload/read.js`, `workload/verify.js` | READ rounds (ReadEvidence / GetAuditTrail; VerifyEvent for anchored variants) |
| `workload/lib/payloads.js` | shared builders: Codex-Entry head, REST bodies, fabric request, `case-NNN` selector, payload filler |
| `workload/lib/pool.js` | untimed pool seeding + the batcher flush shared by the pool workloads |
| `workload/lib/txlog.js` | per-transaction JSONL capture (`GLEIPNIR_TXLOG_DIR`) |
| `connectors/rest/` | custom `ConnectorBase` connector driving the gateway REST path |
| `audit/reconstruct.js`, `audit/merkle.js` | audit-reconstruction harness — `npm run audit`; merkle.js is a pinned byte-identical copy of the services' file |
| `networks/coc-main.yaml`, `parallel-c{C}.yaml`, `rest-gateway.yaml` | Caliper network configs (parallel-c* rendered by `rounds.py --static`) |
| `benchmarks/smoke-<variant>.yaml` | committed smoke configs (rendered by `rounds.py --static`); steady rounds are rendered per run into `results/…/rounds/<label>/bench.yaml` |
| `test/` | `npm test` — trace determinism, merkle identity, reconstruct against a fake gateway |
| `traces/` | generated trace files `<hash>.json` (gitignored) |
| `results/` | run outputs (gitignored, never edited by hand) |

## Transaction trace — the determinism contract

`trace/generate.js` is a pure function of `(seed, cases, channels, evidencePerCase,
eventsPerCasePerRound, rounds, workers, mix, payloadBytes)`: same params → byte-identical file;
different seed → different file. All four variants replay the **same** trace; only the write
path differs (`mode`). Defaults come from `sweeps.yaml`; every flag overrides.

```bash
node trace/generate.js --cases 20 --channels 20 --evidence-per-case 20 \
  --events-per-case-per-round 200 --rounds 5 --workers 4 --seed 20260922 --payload-bytes 256
# -> writes traces/<hash>.json, prints the hash (recorded in run.json). --dry prints opCounts only.
```

File: `{version, hash, params, sliceSize, opCounts:{total, perRound[]}, workers:[[item…]…]}`,
item = `{op: CREATE|TRANSFER|ACCESS|DISPOSE, dataCase, caseId, evidenceId, actor, detail}`.
Rules: evidence `e` (global index) is owned by worker `e mod workers` and all its ops sit in that
worker's sequence in lifecycle order CREATE → (TRANSFER|ACCESS)* → [DISPOSE]; each worker's
sequence is a seeded interleave of its evidence lifecycles with exactly `rounds × S` items,
`S = cases × eventsPerCasePerRound / workers` (must be an integer — the generator refuses
otherwise); round `k` replays items `[k·S, (k+1)·S)`. `caseId` is the channel routing key
`case-NNN`, `NNN = ((dataCase−1) mod channels)+1`. DISPOSE ends `round(dispose_fraction × owned)`
of each worker's evidence; TRANSFER/ACCESS are drawn by `transfer_weight : access_weight`.
CREATE's `detail.payload` is `payloadBytes` deterministic characters (`lib/payloads.filler`)
whose SHA-256 becomes `storage.integrity_proof` — the synthetic evidence "file" never reaches
the ledger, only its hash (CLAUDE.md: binaries are always off-chain).

## Round arguments (rendered by `orchestration/rounds.py`; names are BINDING)

| Argument | Workloads | Meaning |
|---|---|---|
| `mode` | all | `fabric` (Standard/Parallel → peer-gateway connector) or `rest` (Anchoring/Parallel-Anchored → REST connector → gateway) |
| `label` | all | round label written into every tx-log line (defaults to `round-<index>`) |
| `variant` | all | `standard` / `anchoring` / `parallel` / `parallel-anchored`; decides whether a `caseId`/`channel` is attached (never for standard/anchoring — for anchoring a caseId would change the batch scope from `shared`) |
| `channels` | pool workloads, verify | `C` → targets spread round-robin across `case-001..case-00C` (Parallel variants only; omit for Standard/Anchoring) |
| `caseId`, `channel` | pool workloads | single-target overrides (legacy) |
| `trace`, `slice`, `sliceSize` | `trace.js` | absolute trace path, slice index `k`, per-worker slice size `S` (checked against the file) |
| `pool` | transfer, access, dispose, read | evidence items seeded per worker (untimed) before the timed phase; dispose needs `txNumber ≤ pool × workers`. The per-operation rounds size it `ceil(P / workers)` where `P = evidence_per_case × cases`, so the round's target set is `P` in total and each seeded item is exercised about once — passing `P` per worker would seed `P × workers` items to perform `P` operations |
| `payloadBytes` | create + pool workloads, verify | filler size hashed into `storage.integrity_proof` |
| `fn` | `read.js` | `ReadEvidence` or `GetAuditTrail` |
| `seedCount` | `verify.js` | events seeded + flushed per worker before timing `/verify` (anchored variants only) |

`mode`, `label`, `channels` and `variant` are **common** arguments: `rounds.py render_bench`
injects all four into every round's `workload.arguments`, whatever the module (the committed
`benchmarks/smoke-*.yaml` show them on each round). `variant` is not a trace-only argument —
the `case-NNN` spread is suppressed **by variant name**, so a round rendered without it falls
back to `channels: 1` → `case-001`, which points Standard's fabric requests at a channel absent
from `networks/coc-main.yaml` and stamps Anchoring's events with a caseId instead of the
`shared` batch scope.

`accessLog.js` also keeps the legacy `scenario: shared` + `sharedEvidenceId` (the Stage-1
zero-MVCC-conflict gate: every worker appends to ONE evidenceId).

Write paths per op: fabric → `CreateEvidence` / `TransferCustody` / `AccessLog` /
`DisposeEvidence` (channel = `caseId` for Parallel variants, none = `coc-main` for Standard);
rest → `POST /api/v1/evidence`, `POST …/:id/transfer`, `POST …/:id/access`,
`DELETE …/:id {reason, caseId?}` (caseId only for Parallel-Anchored). Reads: fabric
`readOnly: true` (evaluate); rest `GET /api/v1/evidence/:id[/audit][?caseId=]` under the service
token, which never auto-logs. A workload whose trace slice or dispose pool runs out **throws** —
the round aborts loudly instead of measuring repeats. In `rest` mode `read.js` and `verify.js`
force a batch boundary (`POST $BATCHER_URL/flush`, `lib/pool.flushBatcher`) after their untimed
seeding: the anchored variants answer reads and verifies from the off-chain trail, which only
exists once a batch closes, so unflushed seeds would make those rounds measure 404s and empty
arrays instead of reads.

## Per-transaction log (`workload/lib/txlog.js`)

Every ledger write and every timed transaction writes one line to
`${GLEIPNIR_TXLOG_DIR}/tx-w<workerIndex>.jsonl` (env set per round by the orchestrator;
unset → nothing is written):

```json
{"round":"e1-slice0","op":"CREATE","caseId":"case-003","evidenceId":"ev-c003-e007","tCreate":1790000000000,"tFinal":1790000000210,"latencyMs":210,"ok":true,"err":null,"timed":true}
```

`timed` separates the two kinds of line. `timed: true` is a measured transaction. `timed: false`
is a ledger write the round performed but never measured: `lib/pool.seedPool`'s pool seeding
(logged through the connector with the trailing `timed` argument of `log(...)`) and `verify.js`'s
seeding (logged with `logUntimed(...)`, since it goes over plain `fetch` and has no `TxStatus`,
so its `tCreate`/`tFinal`/`latencyMs` are `null`). Those seeds **are** ledger writes, so
`collect.py` counts them in the storage bytes-per-event denominator and excludes them from every
timing, throughput and failure statistic.

`op` ∈ `CREATE|TRANSFER|ACCESS|DISPOSE|READ_EVIDENCE|READ_TRAIL|VERIFY`; the timestamps are
Caliper's own `TxStatus` (`GetTimeCreate`/`GetTimeFinal`), `ok = IsCommitted()`, `err` = first
`GetErrMsg()` entry. `submitTransaction` awaits `sendRequests`, logs, then returns the status —
Caliper does not await `submitTransaction`, so the log never throttles the send rate; lines are
buffered and appended off the event loop, with a synchronous flush at process exit. This log is
the source of p95 latency, success/failure counts and failure classes (`collect.py`).

Known limit: the Caliper 0.6.0 peer-gateway connector records **no error string** on failed
fabric-mode transactions (it only logs them), so `err` is `null` there; `collect.py` classifies
fabric-mode failures from `caliper.log`. The REST connector sets `HTTP <status>` on non-2xx
and the fetch error message on transport failure.

## Audit reconstruction (`audit/reconstruct.js`)

```bash
GLEIPNIR_TOKEN=dev-token node audit/reconstruct.js --variant anchoring \
  --trace traces/<hash>.json --cases 5 --gateway http://localhost:3000 --out audit.json
```

Takes the first `cases` data-cases of the trace and, per case, timed with `hrtime`:
Standard/Parallel fetch `GET /api/v1/evidence/:id/audit[?caseId=]` for every evidence item
(verified = on-chain, no Merkle step); Anchoring/Parallel-Anchored fetch `…/audit?proofs=1`,
recompute `leafHash(canonical(event))` per event, fold its sibling path (`audit/merkle.js`),
read the anchored root once per `(scopeId, batchId)` via `GET /api/v1/anchor-roots/:scopeId/:batchId`
(cached) and compare. Output `{variant, method, traceHash, cases:[{caseId, dataCase, evidence,
events, ms, verifiedEvents, failedEvents, rootReads}], summary:{msPerCase:{mean,sd,min,max},
msPerEvent, okRate}}`. Host-side, via the gateway only — never Fabric directly. Any non-2xx
gateway response is a thrown error (loud), a root mismatch or missing root is a counted failure.

## Throughput semantics (issue #1418 — report this explicitly)

Caliper's `Throughput (TPS)` numerator is `Succ + Fail`, so a round with 0 successes can
still show positive throughput. GLEIPNIR does **not** report that number as-is. `collect.py`
recomputes **successful-only** throughput = `Succ / (lastFinishTime − firstCreateTime)`.
`MVCC_READ_CONFLICT` is tabulated as its own failure class (issue #1397); the append-only
sub-key design should keep it near zero. "Send rate" is the configured `fixed-rate tps`
(input); "throughput" is what was measured (output); TPS is only a unit.

**REST-connector latency is the BFF path**: for the anchored variants a "committed" write is
the gateway's `202` enqueue acknowledgement, not a block commit — the ledger commit lag is the
separate **anchoring delay** metric (batcher `/status`). Keep rest-mode numbers labelled
distinctly from fabric-connector numbers.

## Does NOT

- Render round or network configs (`orchestration/rounds.py` does — this workspace has no generator).
- Provision channels, deploy chaincode, or reset the ledger (orchestration does).
- Talk to Fabric from the audit harness or the REST path (gateway only).
- Draw scalability conclusions from smoke runs (functional only).

## Failure modes

- `trace: cases*eventsPerCasePerRound/workers … is not an integer` — pick a shape whose per-worker share is whole.
- `trace: worker N needs … items` — `events_per_case_per_round × rounds` cannot cover CREATE+DISPOSE; raise it.
- `trace: generated for W workers but the round has …` / `sliceSize … != trace sliceSize` — benchconfig and trace disagree; re-render.
- `… exhausted …` — `txNumber` exceeds `sliceSize × workers` (trace) or `pool × workers` (dispose).
- `GET … -> HTTP 4xx/5xx` from reconstruct — gateway down, wrong token, or the variant's `/audit?proofs=1` / `/anchor-roots` route missing.

## Verify (no live SUT)

```bash
npm install                 # resolves @hyperledger/caliper-cli@0.6.0 + js-yaml
npm test                    # node --test test/*.test.js
node --check workload/*.js workload/lib/*.js connectors/rest/index.js trace/generate.js audit/*.js
node trace/generate.js --cases 4 --channels 2 --evidence-per-case 2 --events-per-case-per-round 8 --rounds 2 --workers 4 --seed 1 --dry
```
