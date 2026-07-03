# services/merkle-batcher

**Responsibility:** accumulate CoC events off-chain into per-scope batches and, at a batch
boundary, build a SHA-256 Merkle tree, persist one receipt per event (to the receipt-store)
and submit the single root for on-chain commit. Used by the **Anchoring** and
**Parallel-Anchored** variants.

Port **4001**. Node 20, Express. The Merkle primitives (`src/merkle.js`) are byte-for-byte
identical to the verification service and match docs/CONTRACTS.md §4 (canonical JSON,
leaf/interior hashing, odd-node **promote**, sibling paths).

## Public interface (REST/JSON)

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `POST` | `/events` | CoC event (CONTRACTS §5) → `202 {batchId, leafIndex}` |
| `POST` | `/flush` | force a batch boundary on every non-empty queue → `/status` body |
| `GET` | `/status` | queue depths, batch counters, per-batch state, `degraded` flag |

**Scope selection:** `VARIANT=anchoring` → all events go to scope `shared`;
`VARIANT=parallel-anchored` → scope = `event.caseId` (per-case queues).
**Batch size:** `BATCH_N` (anchoring) or `BATCH_K` (parallel-anchored).
**Root submission:** anchoring → `POST GATEWAY_URL/internal/anchor-root`; parallel-anchored
→ `POST ANCHOR_CLIENT_URL/roots`. Receipts are first PUT without a txId, then re-PUT with
the committed `rootRef.txId`.

## Inputs / outputs

- **In:** CoC events (HTTP), env config (below).
- **Out:** receipts PUT to `RECEIPT_STORE_URL`; one root POSTed per batch to the gateway or
  anchor-client.

Env: `PORT=4001`, `VARIANT`, `BATCH_N=100`, `BATCH_K=25`, `RECEIPT_STORE_URL`,
`GATEWAY_URL`, `ANCHOR_CLIENT_URL`, `LOG_LEVEL`.

## Does NOT

- Submit to the ledger itself (delegates to gateway / anchor-client).
- Persist receipts itself (delegates to receipt-store).
- Verify proofs (that is the verification service).

## Failure modes

- **receipt-store unreachable** — each PUT retries once; if it still fails the batch is
  marked `degraded` in `/status` (receipts are never dropped silently).
- **duplicate eventId** in an open batch → `409`.
- **root submit failure** — receipts are kept, batch `rootStatus:"failed"` + `degraded` in
  `/status`; no partial on-chain state.
- **partial batch at run end** — `POST /flush` closes and processes every open queue.
- **restart** — open (un-flushed) queues and the per-scope batch sequence are in memory;
  a restart loses un-batched events and resets sequence numbering (documented limitation;
  run `/flush` before teardown).

## Test

```bash
npm install && npm test    # node:test — Merkle vectors + full boundary/routing/degraded flows
```
