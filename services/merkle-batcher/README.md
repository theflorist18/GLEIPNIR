# services/merkle-batcher

**Responsibility:** accumulate CoC events off-chain into per-scope batches and, at a batch
boundary, build a SHA-256 Merkle tree, persist one receipt per event (to the receipt-store)
and submit the single root for on-chain commit. Used by the **Anchoring** and
**Parallel-Anchored** variants. Its batch records are the source of the **anchoring delay**
metric and, joined to the per-transaction log, of the **integrity finalization latency**
(docs/methodology/experiments.md).

Port **4001**. Node 20, Express. The Merkle primitives (`src/merkle.js`) are byte-for-byte
identical to the verification service and match docs/CONTRACTS.md §4 (canonical JSON,
leaf/interior hashing, odd-node **promote**, sibling paths).

## Public interface (REST/JSON)

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `POST` | `/events` | CoC event (CONTRACTS §5) → `202 {batchId, leafIndex}` |
| `POST` | `/flush` | force a batch boundary on every non-empty queue, wait until every batch is processed → `/status` body |
| `GET` | `/status` | `{variant, batchSize, flushTimeoutMs, idleTimeoutMs, queues, counters, degraded, batches[]}` (compact: no per-event times, so it stays small enough to poll) |
| `GET` | `/status?events=1` | the same, with each batch's `enqueuedAtMs` — the run-end snapshot `experiment.py` writes to `anchoring.json` |

**Scope selection:** `VARIANT=anchoring` → all events go to scope `shared`;
`VARIANT=parallel-anchored` → scope = `event.caseId` (per-case queues).

**Batch boundary** (any of; the batch record names it in `closeReason`, and `forced` =
`closeReason !== 'size'`):
- **size** (`closeReason: 'size'`) — the open queue reaches `BATCH_SIZE` events;
- **idle** (`'idle'`) — `BATCH_IDLE_MS > 0` and that many ms passed since the *last* enqueue
  of the open batch; the timer restarts with every event and has no cap;
- **age** (`'timeout'`) — `BATCH_FLUSH_MS > 0` and that many ms passed since the *first*
  enqueue of the open batch; the timer is armed per scope at the first enqueue;
- **`POST /flush`** (`'flush'`) — run-end partial-batch policy.

Both timers `0` = size-only batching, the experiment default; the timers are cleared at every
boundary. Only the sensitivity cell `idle-5s` sets `BATCH_IDLE_MS=5000`.

**Root submission:** both variants → `POST GATEWAY_URL/internal/anchor-root` (bearer
`GLEIPNIR_TOKEN`) with `{batchId, merkleRoot, meta}`. Anchoring sends
`meta = {scopeId: 'shared', leafCount}`: no caseId, so the chaincode scope is `shared` and the
gateway commits on `coc-main`. Parallel-Anchored sends `meta = {scopeId, leafCount, caseId}`
with caseId = scopeId = the case (`case-NNN`): the gateway commits on that case's own channel,
and the chaincode keys the root by `meta.caseId`. Receipts are first PUT without a txId, then
re-PUT with the committed `rootRef.txId`. (The earlier Parallel-Anchored design, campaigns 1–5,
sent its roots to a separate anchor-client for an anchor channel; that path no longer exists.)

**Receipt** (what is PUT to the receipt-store):
`{eventId, evidenceId, event, leafHash, siblingPath[], batchId, leafIndex, rootRef}` —
`event` is the CoC event exactly as enqueued (the off-chain trail copy);
`leafHash` is unchanged = SHA-256 of the canonical event, so the verification service can
recompute the leaf from `event`.

**Batch record** (one per closed batch in `/status.batches[]`, kept for the process
lifetime): `{batchId, scopeId, leafCount, root, receiptStatus, rootStatus, txId, degraded,
error, openedAt, closedAt, committedAt, closeReason, forced, delayMs:{min,mean,max},
enqueuedAtMs[]}` (`enqueuedAtMs` only with `?events=1`). Timestamps are ISO-8601; `openedAt` =
first enqueue, `closedAt` = boundary, `committedAt` = root submit returned (null if it
failed). `delayMs` = `committedAt − enqueue time` over the batch's events; null when not
committed. `enqueuedAtMs` = each event's enqueue time (epoch ms, leaf order), from which
`collect.py` takes the exact per-event delay. `counters` adds `forced` (batches closed by a
timer or `/flush`). One log line per committed batch repeats these timestamps (`batch <id>
committed root … closeReason=… openedAt=… closedAt=… committedAt=… delayMs=min/mean/max`), so
the anchoring delay can also be read from logs.

## Inputs / outputs

- **In:** CoC events (HTTP), env config (below).
- **Out:** receipts PUT to `RECEIPT_STORE_URL`; one root POSTed per batch to the gateway;
  one log line per committed batch.

Env: `PORT=4001`, `VARIANT`, **`BATCH_SIZE=100`** (one grid for both anchored
variants), **`BATCH_FLUSH_MS=0`** (age timer), **`BATCH_IDLE_MS=0`** (idle timer),
`BATCH_EPOCH` (batchId namespace per run), `RECEIPT_STORE_URL`, `GATEWAY_URL`,
`GLEIPNIR_TOKEN`, `LOG_LEVEL`. `experiment.py` writes `BATCH_SIZE`, both timers and a fresh
`BATCH_EPOCH` into `network/compose/.env` for every run.

## Does NOT

- Submit to the ledger itself (delegates to the gateway).
- Persist receipts itself (delegates to receipt-store).
- Verify proofs (that is the verification service).
- Persist the open batch: it lives only in this process's memory (see Failure modes).
- Measure Fabric commit time independently: `committedAt` is when the root submission
  *returned* to the batcher (the gateway awaits the commit), so the anchoring delay includes
  the submit round-trip.

## Failure modes

- **receipt-store unreachable** — each PUT retries once; if it still fails the batch is
  marked `degraded` in `/status` (receipts are never dropped silently).
- **duplicate eventId** in an open batch → `409`.
- **root submit failure** — receipts are kept, batch `rootStatus:"failed"` + `degraded` in
  `/status`, `committedAt`/`delayMs` stay null; no partial on-chain state.
- **partial batch at run end** — `POST /flush` closes and processes every open queue.
- **age and idle timers** — each closes its batch at most once; whichever boundary comes
  first clears both. They are `unref`'d, so they never keep an otherwise-idle process alive.
- **crash or restart: the open batch is lost** (known limit). An open batch exists only in
  this process's memory. Events accepted (`202`) whose receipts are not written yet (their
  batch is still open, or is still being processed) are lost when the process dies: no
  receipt, no trail entry, no root, and no record of the loss (`orchestration/crash-test.sh`
  shows it for an open batch). Run `/flush` before teardown.
- **batch ids after a restart** — the per-scope sequence also restarts at `b000000`. With a
  fixed `BATCH_EPOCH` in the container's environment (`experiment.py` sets one per run) the
  restarted process reuses batch ids: a root whose `(scope, batchId)` is already on the
  ledger is refused (roots are write-once; `rootStatus: "failed"`, `degraded`), and the
  receipts of that batch name the earlier root, so their events fail verification
  (`root-mismatch`). `experiment.py` recreates the batcher with a fresh `BATCH_EPOCH` for every
  run; after any other restart set a new `BATCH_EPOCH`, or leave it empty (the process start
  time is used).

## Test

```bash
npm install && npm test    # node:test — Merkle vectors + boundary/age-timer/idle-timer/degraded/routing flows
```
