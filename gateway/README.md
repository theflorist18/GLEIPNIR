# gateway

**Responsibility:** the backend-for-frontend (BFF). It holds the only
`@hyperledger/fabric-gateway` sessions to the **application** channels (`coc-main`,
`case-*`), computes evidence `integrity_proof` ni-URIs, and encapsulates **variant
routing**. Used by **all four variants**; the frontend and Caliper's REST path talk only to
this service, never to Fabric directly.

Port **3000**. Node 20, Express. Auth: static bearer token (`GLEIPNIR_TOKEN`,
default `dev-token`) — **non-production**, documented as such.

## Public interface (`/api/v1`, JSON)

| Method | Path | Maps to |
|---|---|---|
| `POST` | `/evidence` | `CreateEvidence` (or batcher enqueue) |
| `POST` | `/evidence/:id/transfer` | `TransferCustody` (or enqueue) |
| `POST` | `/evidence/:id/access` | `AccessLog` (or enqueue) |
| `DELETE` | `/evidence/:id` | `RemoveEvidence` (or enqueue) |
| `GET` | `/evidence/:id` | `ReadEvidence` (evaluate, direct) |
| `GET` | `/evidence/:id/audit` | `GetAuditTrail` (evaluate, direct) |
| `GET` | `/evidence/:id/verify?eventId=` | proxy → verification service |
| `POST`/`GET` | `/runs`, `/runs/:id` | run-request store (execution is host-side) |

Internal (no `/api/v1` prefix, still bearer-authed): `POST /internal/anchor-root` and
`GET /internal/anchor-root/:scopeId/:batchId` — the Anchoring variant's root sink on
`coc-main`. `GET /healthz` is unauthenticated.

## Variant routing (docs/CONTRACTS.md §9)

`src/variantRouter.js` decides per active `VARIANT`:
- **standard** → `submit` on `coc-main`.
- **anchoring** → enqueue the CoC event to the merkle-batcher (`202`); root committed at the
  batch boundary via `/internal/anchor-root`.
- **parallel** → `submit` on `case-<id>` (from `caseId`; validated `^case-\d{3}$`).
- **parallel-anchored** → enqueue per-case to the merkle-batcher (`202`).

Reads always evaluate directly, on `coc-main` or the `?caseId=` case channel.

## Inputs / outputs

- **In:** REST/JSON requests; env config.
- **Out:** Fabric submit/evaluate on app channels; enqueue POSTs to the batcher;
  verification proxy; run-request files under `RESULTS_DIR`.

Env: `PORT=3000`, `GLEIPNIR_TOKEN`, `VARIANT`, `BATCHER_URL`, `VERIFICATION_URL`,
`PEER_ENDPOINT`, `PEER_HOST_ALIAS`, `MSP_ID`, `CRYPTO_PATH`, `TLS_CERT_PATH`,
`DEFAULT_CHANNEL=coc-main`, `CC_NAME=evidence`, `RESULTS_DIR=/results`.

## Does NOT

- Store evidence binaries — `payloadBase64` is hashed to an ni-URI, then **discarded**.
- Build Merkle trees, verify proofs, or write the anchor channel (batcher / verification /
  anchor-client own those).
- Execute benchmark runs — `POST /runs` only records a request; `orchestration/sweep.py`
  runs Caliper and writes the manifest the UI polls.

## Failure modes

- `401` — missing/invalid bearer token.
- `400` — parallel variant without a valid `caseId`.
- `404` — read of an unknown key (mapped from the chaincode not-found error).
- `502` — Fabric submit/evaluate error, batcher unreachable, or verification proxy error.

## Test

```bash
npm install && npm test    # node:test — variant matrix, ni-URI vector, auth 401, create-vs-enqueue
```
