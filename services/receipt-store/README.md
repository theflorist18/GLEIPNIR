# services/receipt-store

**Responsibility:** persist each event's off-chain witness
(`{leafHash, siblingPath[], batchId, leafIndex, rootRef}`), one JSON file per `eventId`.
Used by the **Anchoring** and **Parallel-Anchored** variants.

Port **4002**. Node 20, Express. Files under `DATA_DIR` (named volume `receipt-data`).

## Public interface (REST/JSON)

| Method | Path | Result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `PUT` | `/receipts/:eventId` | store/overwrite receipt → `{ok:true, eventId}`; `400` if `eventId` not `[A-Za-z0-9._:-]+` |
| `GET` | `/receipts/:eventId` | receipt JSON; `404` if missing; `400` on bad id |

## Inputs / outputs

- **In:** receipt documents (from the merkle-batcher), `DATA_DIR`, `PORT`.
- **Out:** receipt JSON on GET. Nothing else — no callbacks, no on-chain writes.

## Does NOT — and MUST NOT

- **Harden.** No hash chains, no signatures, no replication, no integrity proofs on
  receipts. This weaker-than-on-chain guarantee is intentional and is a **measured property
  of the design** (a stated thesis caveat), not a bug. The urge to harden this store is
  itself the finding — record it in the thesis; do not code it away.
- Compute Merkle trees or verify proofs (batcher builds, verification checks).

**Integrity caveat (belongs in the thesis):** only the Merkle *root* is on-chain and
tamper-evident. The sibling paths stored here are off-chain. Losing or corrupting a receipt
is an **availability exposure of the witness** (the proof can no longer be reconstructed),
**not an integrity exposure of the ledger** (the anchored root still cannot be forged).

## Failure modes

- **receipt loss / corruption** → that event becomes unverifiable (availability, not
  integrity — see caveat).
- **missing receipt** → `404`.
- **invalid eventId** → `400` (also the path-traversal guard).
- **disk full / write error** → `500`.

## Test

```bash
npm install && npm test    # node:test — put/get roundtrip, upsert, 404, 400 traversal guard
```
