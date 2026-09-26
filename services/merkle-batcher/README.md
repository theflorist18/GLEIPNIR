# services/merkle-batcher

**Responsibility:** accumulate CoC events off-chain into per-scope batches and, at a batch
boundary, build a SHA-256 Merkle tree, persist one receipt per event (to the receipt-store)
and submit the single root for on-chain commit. Used by the **Anchoring** and
**Parallel-Anchored** variants. Its per-batch timestamps are the source of the
**anchoring delay** metric (supervisor brief 2026-09-22).

Port **4001**. Node 20, Express. The Merkle primitives (`src/merkle.js`) are byte-for-byte
identical to the verification service and match docs/CONTRACTS.md §4 (canonical JSON,
leaf/interior hashing, odd-node **promote**, sibling paths).

## Public interface (REST/JSON)

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `POST` | `/events` | CoC event (CONTRACTS §5) → `202 {batchId, leafIndex}` |
| `POST` | `/flush` | force a batch boundary on every non-empty queue → `/status` body |
| `GET` | `/status` | `{variant, batchSize, flushTimeoutMs, queues, counters, degraded, batches[]}` |

**Scope selection:** `VARIANT=anchoring` → all events go to scope `shared`;
`VARIANT=parallel-anchored` → scope = `event.caseId` (per-case queues).

**Batch boundary** (any of):
- **size** — the open queue reaches `BATCH_SIZE` events (`forced:false`);
- **time** — `BATCH_FLUSH_MS > 0` and that many ms passed since the *first* enqueue of the
  open batch (`forced:true`); the timer is armed per scope at the first enqueue and cleared
  at the boundary. `0` = size-only batching (the experiment default; held constant);
- **`POST /flush`** — run-end partial-batch policy (`forced:true`).

**Root submission:** anchoring → `POST GATEWAY_URL/internal/anchor-root` (bearer
`GLEIPNIR_TOKEN`); parallel-anchored → `POST ANCHOR_CLIENT_URL/roots`. Receipts are first
PUT without a txId, then re-PUT with the committed `rootRef.txId`.

**Receipt** (what is PUT to the receipt-store):
`{eventId, evidenceId, event, leafHash, siblingPath[], batchId, leafIndex, rootRef}` —
`event` is the CoC event exactly as enqueued (the off-chain trail copy);
`leafHash` is unchanged = SHA-256 of the canonical event, so the verification service can
recompute the leaf from `event`.

**Batch record** (one per closed batch in `/status.batches[]`, kept for the process
lifetime): `{batchId, scopeId, leafCount, root, receiptStatus, rootStatus, txId, degraded,
error, openedAt, closedAt, committedAt, forced, delayMs:{min,mean,max}}`. Timestamps are
ISO-8601; `openedAt` = first enqueue, `closedAt` = boundary, `committedAt` = root submit
returned (null if it failed). `delayMs` = `committedAt − enqueue time` over the batch's
events (per-event enqueue timestamps are kept in the open queue); null when not committed.
`counters` adds `forced` (batches closed by timer or `/flush`). One log line per committed
batch repeats these timestamps (`batch <id> committed root … forced=… openedAt=… closedAt=…
committedAt=… delayMs=min/mean/max`), so the anchoring delay can also be read from logs.

## Inputs / outputs

- **In:** CoC events (HTTP), env config (below).
- **Out:** receipts PUT to `RECEIPT_STORE_URL`; one root POSTed per batch to the gateway or
  anchor-client; one log line per committed batch.

Env: `PORT=4001`, `VARIANT`, **`BATCH_SIZE=100`** (one grid for both anchored
variants), **`BATCH_FLUSH_MS=0`**, `BATCH_EPOCH` (batchId namespace per run),
`RECEIPT_STORE_URL`, `GATEWAY_URL`, `ANCHOR_CLIENT_URL`, `GLEIPNIR_TOKEN`, `LOG_LEVEL`.

## Does NOT

- Submit to the ledger itself (delegates to gateway / anchor-client).
- Persist receipts itself (delegates to receipt-store).
- Verify proofs (that is the verification service).
- Measure Fabric commit time independently: `committedAt` is when the root submission
  *returned* to the batcher (the gateway/anchor-client await the commit), so the anchoring
  delay includes the submit round-trip.

## Failure modes

- **receipt-store unreachable** — each PUT retries once; if it still fails the batch is
  marked `degraded` in `/status` (receipts are never dropped silently).
- **duplicate eventId** in an open batch → `409`.
- **root submit failure** — receipts are kept, batch `rootStatus:"failed"` + `degraded` in
  `/status`, `committedAt`/`delayMs` stay null; no partial on-chain state.
- **partial batch at run end** — `POST /flush` closes and processes every open queue.
- **flush timer** — fires at most once per open batch; a size boundary reached first
  cancels it. It is `unref`'d, so it never keeps an otherwise-idle process alive.
- **restart** — open (un-flushed) queues and the per-scope batch sequence are in memory;
  a restart loses un-batched events and resets sequence numbering (documented limitation;
  run `/flush` before teardown). `BATCH_EPOCH` keeps batchIds unique across restarts.

## Test

```bash
npm install && npm test    # node:test — Merkle vectors + boundary/timer/degraded/routing flows
```
