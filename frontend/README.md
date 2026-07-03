# frontend

**Responsibility:** the operator/demo SPA — one React + Vite (TypeScript) app with two
scopes. It **talks only to the API gateway** (`/api/v1`, proxied); it never contacts Fabric
or any service directly.

Port **8081** (nginx). Serves for all variants.

## Scopes (ARCHITECTURE §5)

- **Scope B — CoC demo** (`src/demo.tsx`): `CreateEvidenceForm`, `TransferCustodyForm`,
  `AccessLogForm`, `EvidenceCard` (Codex-style signed card), `AuditTrail` (event timeline),
  `MerkleBadge` (green VERIFIED / red MISMATCH / N-A — Anchoring variants only).
- **Scope A — operator dashboard** (`src/dashboard.tsx`): `VariantSelector`,
  `SweepConfigForm` (mirrors `benchmark/sweeps.yaml`), `RunControl` (live status),
  `ThroughputChart` (per-channel + aggregate), `LatencyChart` (write + verification),
  `StorageChart` (ledger/state growth), `RunHistory`, `RunCompare`.

## Public interface

The SPA consumes the gateway public API through `src/api.ts` (`GatewayClient`). Types mirror
docs/CONTRACTS.md §5 (evidence/event) and §10/§11 (run manifest/checkpoints); all metric
fields are optional and read defensively, since a *requested-but-not-executed* run has none.

## Inputs / outputs

- **In:** operator actions; a bearer token (settings, default `dev-token`).
- **Out:** REST calls to `/api/v1/*`. Run **execution is host-side** (`orchestration/sweep.py`)
  — `RunControl` says so explicitly and only polls the results manifest.

## Does NOT

- Talk to Fabric or the off-chain services directly (only the gateway).
- Upload evidence binaries for storage (create only sends metadata / an ni-URI hash).
- Run benchmarks itself.

## Failure modes

- Gateway unreachable / non-2xx → inline error (`GatewayError` status + body).
- Verify on a non-anchoring variant → badge shows N/A.
- Missing metric fields → charts render an empty-state note.

## Build / dev

```bash
npm install
npm run build          # tsc --noEmit && vite build  (the CI gate)
npm run dev            # Vite dev server, proxies /api -> http://localhost:3000
```

Production image: multi-stage `node:20.19-alpine` build → `nginx:alpine`
(`nginx.conf` serves the SPA on :8081 and proxies `/api/` → `gateway:3000`).
