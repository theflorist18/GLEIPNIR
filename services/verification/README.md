# services/verification

**Responsibility:** measure verification/audit latency — fetch an event's receipt →
recompute the O(log₂N) Merkle branch → verify against the anchored root. Used by the
**Anchoring** and **Parallel-Anchored** variants. This is a **first-class, required metric**
(the numerator of the latency-vs-storage tradeoff, thesis RQ2).

Port **4004**. Node 20, Express. `src/merkle.js` is byte-for-byte identical to the
merkle-batcher (docs/CONTRACTS.md §4).

## Public interface (REST/JSON)

| Method | Path | Result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `GET` | `/verify/:eventId` | `{ok, latencyMs, steps:{fetchMs,recomputeMs,compareRootMs}}` |

Timing uses `process.hrtime.bigint()`. Steps:
1. **fetchMs** — GET receipt from `RECEIPT_STORE_URL`.
2. **recomputeMs** — fold `leafHash` up `siblingPath` to the implied root.
3. **compareRootMs** — read the anchored root and compare:
   - `VARIANT=anchoring` → `GET GATEWAY_URL/internal/anchor-root/:scopeId/:batchId` (bearer).
   - `VARIANT=parallel-anchored` → `GET ANCHOR_CLIENT_URL/roots/:caseId/:batchId`
     (caseId = `receipt.rootRef.scopeId`).

## Inputs / outputs

- **In:** `eventId` (path), env config.
- **Out:** verification result with per-step latencies. No writes anywhere.

Env: `PORT=4004`, `VARIANT`, `RECEIPT_STORE_URL`, `GATEWAY_URL`, `ANCHOR_CLIENT_URL`,
`GLEIPNIR_TOKEN`, `LOG_LEVEL`.

## Does NOT

- Verify signatures or schema — deliberately **off** the timed path, so the measurement
  isolates Merkle-verification cost (not signature/schema-validation cost).
- Hold any Fabric session (reads roots via the gateway or anchor-client).
- Write receipts or roots.

## Status codes / failure modes

- `200 {ok:true}` — recomputed root matches the anchored root.
- `200 {ok:false, reason:"root-mismatch"}` — **tamper signal** (not a server error).
- `404 {ok:false, reason:"missing-receipt"}` — no receipt for the event.
- `404 {ok:false, reason:"missing-anchor-root"}` — root not yet committed.
- `502 {ok:false, reason:"anchor-read-error" | "receipt-store-error"}` — upstream unreachable.

## Test

```bash
npm install && npm test    # node:test — Merkle vectors + happy/tamper/missing/anchor-error/parallel paths
```
