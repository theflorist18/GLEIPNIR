# services/receipt-store

**Responsibility:** persist each event's off-chain witness
(`{leafHash, siblingPath[], batchId, leafIndex, rootRef}`) **plus the CoC event copy**
(`evidenceId`, `event`), one JSON file per `eventId`, and keep a plain per-evidence index
so an evidence's off-chain trail can be listed back. Used by the **Anchoring** and
**Parallel-Anchored** variants (supervisor brief 2026-09-22: the off-chain trail).

Port **4002**. Node 20, Express. Files under `DATA_DIR` (named volume `receipt-data`):
`DATA_DIR/<eventId>.json` (receipt) and `DATA_DIR/idx/<evidenceId>.txt` (one `eventId` per
line, first-PUT order).

## Public interface (REST/JSON)

| Method | Path | Result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `PUT` | `/receipts/:eventId` | store/overwrite receipt → `{ok:true, eventId}`; if the body carries `evidenceId`, append `eventId` to `idx/<evidenceId>.txt` unless already listed (idempotent — every receipt is PUT twice, before/after the root txId); `400` if `eventId` or `evidenceId` is not `[A-Za-z0-9._:-]+` |
| `GET` | `/receipts/:eventId` | receipt JSON; `404` if missing; `400` on bad id |
| `GET` | `/receipts?evidenceId=X` | JSON **array** of receipts in index order (`[]` if none); `400` if `evidenceId` missing/invalid |

Index order = first-PUT order, which is the batcher's leaf order within a batch. Consumers
needing a strict timeline sort by `event.ts`.

## Inputs / outputs

- **In:** receipt documents (from the merkle-batcher), `DATA_DIR`, `PORT`.
- **Out:** receipt JSON on GET; receipt arrays on the list endpoint. Nothing else — no
  callbacks, no on-chain writes.

## Does NOT — and MUST NOT

- **Harden.** No hash chains, no signatures, no replication, no integrity proofs on
  receipts **or on the index**. The index is a text file of ids and the `event` field is a
  plain copy — nothing more. This weaker-than-on-chain guarantee is intentional and is a
  **measured property of the design** (a stated thesis caveat), not a bug. The urge to
  harden this store is itself the finding — record it in the thesis; do not code it away.
- Compute Merkle trees or verify proofs (batcher builds, verification checks — and the
  verification service recomputes the leaf from `event`, so a tampered copy here fails
  root verification rather than being trusted).
- Sort, filter or reconcile the trail (the gateway assembles it).

**Integrity caveat (belongs in the thesis):** only the Merkle *root* is on-chain and
tamper-evident. The sibling paths and event copies stored here are off-chain. Losing or
corrupting a receipt is an **availability exposure of the witness** (the proof can no longer
be reconstructed), **not an integrity exposure of the ledger** (the anchored root still
cannot be forged).

## Failure modes

- **receipt loss / corruption** → that event becomes unverifiable (availability, not
  integrity — see caveat). On the list endpoint, an indexed `eventId` whose file is missing
  or unparsable is **skipped** and logged; the array is shorter than the index.
- **index loss** → `GET /receipts?evidenceId=X` returns `[]` although the receipts exist
  (per-eventId GET still works). Same availability-only exposure.
- **missing receipt** → `404`.
- **invalid eventId / evidenceId** → `400` (also the path-traversal guard). A rejected PUT
  writes nothing.
- **concurrent PUTs of the same eventId** — the index append is check-then-append, not
  atomic; the batcher PUTs a batch's receipts sequentially, so only a cross-batch retry of
  one eventId can race, and the list endpoint de-duplicates on read.
- **disk full / write error** → `500`.

## Test

```bash
npm install && npm test    # node:test — put/get roundtrip, upsert, 404, 400 traversal guard, index + listing
```
