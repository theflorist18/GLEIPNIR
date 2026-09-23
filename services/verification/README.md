# services/verification

**Responsibility:** measure verification/audit latency — fetch an event's receipt →
recompute the leaf from the event copy and fold the O(log₂N) Merkle branch → verify against
the anchored root. Used by the **Anchoring** and **Parallel-Anchored** variants. This is a
**first-class, required metric** (the numerator of the latency-vs-storage tradeoff, thesis
RQ2).

Port **4004**. Node 20, Express. `src/merkle.js` is byte-for-byte identical to the
merkle-batcher (docs/CONTRACTS.md §4; both test suites assert it).

## Public interface (REST/JSON)

| Method | Path | Result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `GET` | `/verify/:eventId` | `{ok, reason?, latencyMs, leafSource:"event"\|"receipt", steps:{fetchMs,recomputeMs,compareRootMs}}` |

Timing uses `process.hrtime.bigint()`. Steps:
1. **fetchMs** — GET receipt from `RECEIPT_STORE_URL` (headers + body + JSON parse: the body
   is the sibling path, whose size is the N-dependent quantity).
2. **recomputeMs** — when the receipt carries `event` (the CoC event copy written by the
   batcher since the supervisor brief 2026-09-22), the leaf is **recomputed** as SHA-256 of
   the canonical event (`leafSource:"event"`); otherwise the stored `leafHash` is used
   (`leafSource:"receipt"`, legacy receipts). Either way the leaf is folded up `siblingPath`
   to the implied root. The leaf hashing is inside this step: it is part of the audit cost.
3. **compareRootMs** — read the anchored root and compare:
   - `VARIANT=anchoring` → `GET GATEWAY_URL/internal/anchor-root/:scopeId/:batchId` (bearer).
   - `VARIANT=parallel-anchored` → `GET ANCHOR_CLIENT_URL/roots/:caseId/:batchId`
     (caseId = `receipt.rootRef.scopeId`).

With `VERIFY_METRICS_PATH` set, every completed (3-step) verify appends one JSON line
`{ts, eventId, ok, leafSource, fetchMs, recomputeMs, compareRootMs, latencyMs}`; error paths
(partial steps) are not recorded.

## Inputs / outputs

- **In:** `eventId` (path), env config.
- **Out:** verification result with per-step latencies; optional metrics JSONL. No other
  writes anywhere.

Env: `PORT=4004`, `VARIANT`, `RECEIPT_STORE_URL`, `GATEWAY_URL`, `ANCHOR_CLIENT_URL`,
`GLEIPNIR_TOKEN`, `VERIFY_METRICS_PATH` (empty = off), `LOG_LEVEL`.

## Does NOT

- Verify signatures or schema — deliberately **off** the timed path, so the measurement
  isolates Merkle-verification cost (not signature/schema-validation cost). The receipt
  shape check (`leafHash` hex-64, well-formed `siblingPath`) runs before the timed steps.
- Trust the stored `leafHash` when an event copy is present — a tampered `event` in the
  un-hardened receipt store yields `root-mismatch`, not a pass.
- Compare the recomputed leaf against the stored `leafHash` separately (the root fold
  already fails on any difference).
- Hold any Fabric session (reads roots via the gateway or anchor-client).
- Write receipts or roots.

## Status codes / failure modes

- `200 {ok:true}` — recomputed root matches the anchored root.
- `200 {ok:false, reason:"root-mismatch"}` — **tamper signal** (event copy, sibling path or
  stored leaf altered), not a server error.
- `404 {ok:false, reason:"missing-receipt"}` — no receipt for the event.
- `404 {ok:false, reason:"missing-anchor-root"}` — root not yet committed.
- `422 {ok:false, reason:"malformed-receipt"}` — the un-hardened store served junk; the
  service stays up.
- `502 {ok:false, reason:"anchor-read-error" | "receipt-store-error"}` — upstream unreachable.
- **metrics sink unwritable** — appends are fire-and-forget and ignored; verification still
  answers (only the RQ2 log is empty).

## Test

```bash
npm install && npm test    # node:test — Merkle vectors + byte-identity, happy/tamper/missing/anchor-error/parallel paths, leafSource both ways
```
