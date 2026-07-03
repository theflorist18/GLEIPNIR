# services/anchor-client

**Responsibility:** submit per-case Merkle roots to the dedicated **anchor channel**
(`anchor-main`), because chaincode in one channel cannot write to another. Used by the
**Parallel-Anchored** variant only.

Port **4003**. Node 20 (ESM), `@hyperledger/fabric-gateway`. Holds the **only** Fabric
session to the anchor channel, under the fixed, held-constant **AnchorClientMSP** identity
(an experimental control — never varied across runs).

## Public interface (REST/JSON)

| Method | Path | Result |
|---|---|---|
| `GET` | `/healthz` | `{ok:true}` |
| `POST` | `/roots` | `{caseId,batchId,merkleRoot,meta}` → submit `CommitAnchorRoot(batchId, merkleRoot, JSON.stringify({...meta, caseId}))` → `201 {txId}` |
| `GET` | `/roots/:caseId/:batchId` | evaluate `ReadAnchorRoot(caseId, batchId)` → root record, or `404` |

`caseId` is injected last into `metaJSON` so the chaincode's `scopeId = meta.caseId` keys the
root record. Root state keys are `(caseId, batchId)`, so concurrent per-case roots write
**distinct** keys and never MVCC-collide.

## Inputs / outputs

- **In:** root-submit requests (from the merkle-batcher), env config.
- **Out:** `CommitAnchorRoot` transactions on `anchor-main`; root records on GET.

Env: `PORT=4003`, `PEER_ENDPOINT=peer0-anchor:11051`,
`PEER_HOST_ALIAS=peer0.anchor.example.com`, `MSP_ID=AnchorClientMSP`, `CRYPTO_PATH`,
`TLS_CERT_PATH`, `ANCHOR_CHANNEL=anchor-main`, `CC_NAME=evidence`.

## Design note (testability)

`src/fabric.js` is a factory that builds a `{submit, evaluate}` contract adapter; it is loaded
only at server start, never imported statically by `src/index.js`. Tests inject a fake adapter
into `createApp({contract})`, so routing/marshaling is tested without grpc/fabric-gateway.

## Does NOT

- Build Merkle trees (the batcher does).
- Touch the per-case application channels (only `anchor-main`).
- Store receipts (the receipt-store does).

## Failure modes

- anchor channel unavailable / endorsement failure → `502`.
- identity/MSP misconfiguration (missing env or crypto files) → startup error.
- unknown `(caseId,batchId)` on GET → `404`.
- commit not successful → `502` (`COMMIT_FAILED`).

## Test

```bash
npm install && npm test    # node:test — arg marshaling, caseId injection, 400/404/502 mapping
```
