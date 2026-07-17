# frontend

**Responsibility:** the evidence-library SPA (M14) — one React + Vite
(TypeScript) app with real login, role-aware navigation, and multi-page
routing (react-router v6). It **talks only to the API gateway** (`/api/v1`,
proxied); it never contacts Fabric or any service directly.

Port **8081** (nginx). Serves for all variants; the library pages are wired
for **Standard and Anchoring** (Parallel variants keep the benchmark path
only).

## Structure (ARCHITECTURE §5)

- `src/auth/` — `AuthContext` (session token in localStorage, `GatewayClient`
  owner, 401 → drop session), `LoginPage`, `RequireAuth`, `RequireRole`.
- `src/components/` — `EvidenceCard`, `AuditTrail`, `MerkleBadge`,
  `SessionTrail` (promoted verbatim from the old `demo.tsx`),
  `AuditTrailTimeline` (M21: the CoC trail as a vertical timeline),
  `Layout/TopBar` + `Layout/Sidebar` (role-aware nav).
- `src/components/ui/` — the M21 in-repo primitive kit: `Tabs`, `Stepper`,
  `Modal`, `Timeline`, `Badge`. Deliberately NO component library — styled on
  the existing `styles.css` tokens, covered by vitest + Testing Library
  (`npm test`, jsdom).
- `src/roles.ts` — display labels for the 3-tier roles and case roles (M18);
  pages never hardcode role strings.
- `src/lib/ni.ts` — RFC 6920 ni-URI via `crypto.subtle`, byte-identical to
  `gateway/src/ni.js` (vector-tested; needs a secure context — localhost
  qualifies).
- `src/pages/investigator/` — `IngestPage` (M22: a 4-step wizard — case +
  category, forensic metadata with ITEM-NNN auto-suggest, file + LOCAL
  WebCrypto ni-URI hash, review; the server's `integrityProof` is compared
  against the local hash after upload), `MyCasesPage`, `CaseDetailPage`
  (metadata + evidence roster),
  `EvidenceDetailPage` (card + trail + Merkle badge + download/export +
  transfer/access forms), `SearchPage` (evidence + case search,
  participant-scoped server-side).
- `src/pages/admin/` — `UsersPage`, `CasesAdminPage` (roster + categorize),
  `DashboardPage` (the old operator dashboard, now admin-gated: variant/sweep
  config, run control, charts, history/compare — execution stays host-side,
  `orchestration/sweep.py`).
- `src/settings.tsx` — trimmed to the display `variant` only; the token input
  is gone (login replaced it).

Routes: `/login` public; `/ingest`, `/cases[/:caseId]`,
`/evidence/:evidenceId`, `/search` require a session; `/admin/users`,
`/admin/cases`, `/admin/dashboard` require the admin role (server-enforced
too). nginx's `try_files … /index.html` keeps deep links refresh-safe.

**Verification is per event** (receipts are keyed by eventId), so Verify
targets on the evidence page come from write responses captured this session
(`SessionTrail`). **Demo tip:** with the default `BATCH_N=100` a demo batch
may never close, so Verify legitimately reports *not yet anchored* — bring
the network up with a small batch (e.g. `BATCH_N=5`) to see green badges.

Views, downloads, and exports of an evidence item are logged **server-side**
automatically (synchronous `AccessLog` under the signed-in username) — the
trail on the evidence page grows as you use it; that is the feature.

## Inputs / outputs

- **In:** user actions; a session from `POST /api/v1/auth/login`.
- **Out:** REST calls to `/api/v1/*` through `src/api.ts` (`GatewayClient`).
  Run **execution is host-side** — the dashboard only polls the manifest.

## Does NOT

- Talk to Fabric or the off-chain services directly (only the gateway).
- Hold secrets beyond the opaque session token (no service token in the UI).
- Run benchmarks itself.

## Failure modes

- Gateway unreachable / non-2xx → inline error (`GatewayError` status + body).
- 401 anywhere → session dropped, redirected to `/login`.
- 403/404 on case/evidence pages → "no access" state (server-side scoping).
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
