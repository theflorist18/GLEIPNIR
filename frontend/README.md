# frontend

**Responsibility:** the evidence-library SPA — one React + Vite
(TypeScript) app with real login, role-aware navigation, and multi-page
routing (react-router v6). It **talks only to the API gateway** (`/api/v1`,
proxied); it never contacts Fabric or any service directly.

Port **8081** (nginx). Serves for all variants; the library pages are wired
for **Standard and Anchoring** (Parallel variants keep the benchmark path
only).

## Structure (docs/ARCHITECTURE.md §5)

- `src/auth/` — `AuthContext` (session token in sessionStorage, `GatewayClient`
  owner, 401 → drop session and flag `sessionEnded`, which the login page shows
  as "Your session ended — sign in again."), `LoginPage`, `RequireAuth`,
  `RequireRole`.
- `src/components/` — `EvidenceCard`, `MerkleBadge`, `SessionTrail`,
  `AuditTrailTimeline` (the CoC trail as a vertical timeline),
  `TeamRoster` (roster list + add-member modal, shared by `CaseDetailPage`
  and `LeadDashboardPage`), `Layout/TopBar` + `Layout/Sidebar` (role-aware nav).
- `src/components/ui/` — the in-repo primitive kit: `Tabs`, `Stepper`,
  `Modal`, `Timeline`, `Badge`, plus `Icon` (+ the placeholder `BrandMark`)
  and `Chips` (`StatusPill`, `Avatar`, `CopyButton`). No third-party
  component library; covered by vitest + Testing Library (`npm test`, jsdom).
- **Visual system:** `src/tokens.css` (only the design tokens the SPA uses;
  imported first by `styles.css`) · `public/icons/sprite.svg` (currentColor
  symbols, same-origin for the CSP) · `public/fonts/` (self-hosted OFL woff2,
  latin subset: Figtree, Caprasimo, JetBrains Mono — licences alongside).
  Light by default, dark follows `prefers-color-scheme` unless the user menu's
  Theme picker sets `[data-theme]` (localStorage); print always forces light.
  The brand mark is a placeholder.
- `src/roles.ts` — display labels for the 3-tier roles (admin / lead /
  investigator) and the case roles; pages never hardcode role strings.
- `src/lib/ni.ts` — RFC 6920 ni-URI via `crypto.subtle`, byte-identical to
  `gateway/src/ni.js` (vector-tested; needs a secure context — localhost
  qualifies).
- `src/pages/investigator/` — `IngestPage` (a 4-step wizard — case +
  category, forensic metadata with ITEM-NNN auto-suggest, file + local
  WebCrypto ni-URI hash, review; the server's `integrityProof` is compared
  against the local hash after upload), `MyCasesPage`, `CaseDetailPage`
  (tabs: Overview / Evidence / Activity; Categories and Team are
  press-to-expand sections of Overview; Team shows the roster to every
  participant, with add/remove/role-change (directory picker, in-place role select) for admin/case-lead; Categories
  gets one-click preset adds, custom add, delete for the same gate; the
  Evidence tab has text/category/flag/status filters plus a client-side
  CSV export of exactly the filtered rows — metadata only, not auto-logged),
  `EvidenceDetailPage` (tabs: Overview
  with metadata + flag control / Chain of Custody timeline + verify +
  transfer/access forms / Examiner Notes composer; Download is hidden from an
  admin who is not on the case; inline Preview for image/video/audio/PDF/text
  via the authed download route — explicit load, auto-logged as a download),
  `SearchPage` (evidence + case search,
  participant-scoped server-side), `CoCReportPage`
  (`/cases/:caseId/report`, rendered outside the shell and print-optimized —
  browser print is the PDF path; CSV download alongside; fetching it
  auto-logs one ACCESS per exhibit server-side).
- `src/pages/lead/` — `LeadDashboardPage` (`/lead/dashboard`,
  lead+admin): the caller's lead cases, flagged evidence
  (NEEDS_LEAD_REVIEW / HIGH_PRIORITY, server-scoped), merged recent team
  activity, and a My-team card — per-led-case roster with add/remove
  member picked from the user directory (`GET /users/directory`; the
  case-lead role offers only global leads; server enforces the last-lead
  409).
- `src/pages/admin/` — `UsersPage`, `CasesAdminPage` (all-cases list, status,
  categorize; admins create cases from `MyCasesPage` and manage rosters in
  `CaseDetailPage`'s Team section).
  There is no benchmark page: the benchmark is driven by the desktop app
  `orchestration/benchapp.pyw`. `Op` is `CREATE | TRANSFER | ACCESS |
  DISPOSE` and the status pill shows `DISPOSED` (legacy `REMOVED` rows
  tolerated).

Routes: `/login` public; `/ingest`, `/cases[/:caseId]`,
`/evidence/:evidenceId`, `/search` require a session; `/admin/users`,
`/admin/cases` require the admin role (server-enforced too). nginx's
`try_files … /index.html` keeps deep links refresh-safe.

**Verification is per event** (receipts are keyed by eventId), so Verify
targets on the evidence page come from write responses captured this session
(`SessionTrail`); Verify and the Merkle badge switch on once a write comes back
`batched: true` (Anchoring / Parallel-Anchored). **Demo tip:** with the compose default `BATCH_SIZE` a demo
batch may never close, so Verify legitimately reports *not yet anchored* —
bring the network up with a small batch (e.g. `BATCH_SIZE=5` in
`network/compose/.env`) to see green badges. On the anchored variants the
evidence page's trail is read from the receipt store (the off-chain trail);
evidence written before receipts carried a copy of the event shows an empty
trail there, as expected.

Views, downloads, and exports of an evidence item are logged **server-side**
automatically (synchronous `AccessLog` under the signed-in username) — the
trail on the evidence page grows as you use it; that is the feature.

## Inputs / outputs

- **In:** user actions; a session from `POST /api/v1/auth/login`.
- **Out:** REST calls to `/api/v1/*` through `src/api.ts` (`GatewayClient`).
  No benchmark/runs API — benchmarks are driven host-side by the desktop app
  `orchestration/benchapp.pyw`.

## Does NOT

- Talk to Fabric or the off-chain services directly (only the gateway).
- Hold secrets beyond the opaque session token (no service token in the UI).
- Run benchmarks itself.

## Failure modes

- Gateway unreachable / non-2xx → inline error (`GatewayError` status + body).
- 401 anywhere → session dropped, redirected to `/login`.
- 403/404 on case/evidence pages → "no access" state (server-side scoping).
- Verify on a non-anchoring variant (no `batched` write this session) → badge
  shows N/A.

## Build / dev

```bash
npm install
npm run build          # tsc --noEmit && vite build  (the CI gate)
npm run dev            # Vite dev server, proxies /api -> http://localhost:3000
```

Production image: multi-stage `node:20.19-alpine` build → `nginx:alpine`
(`nginx.conf` serves the SPA on :8081 and proxies `/api/` → `gateway:3000`).
