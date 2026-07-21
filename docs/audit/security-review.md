# Security review — evidence library (M12–M25)

Date: 2026-07-21 · Base commit: `326ad56` · Reviewer method: dimension-parallel agent
review with author adjudication.

Scope: the off-chain evidence-library stack (gateway, case-registry, evidence-store,
frontend) and the service exposure around it. The chaincode, Fabric network topology and
Caliper machinery are in scope only where the library touches them.

## Remediation status (Chunk 4, commit pending)

| Finding | Status |
|---|---|
| S1 anchor-root service gate | **fixed** + test |
| S2 internal ports unpublished | **fixed** (verified live: 4002-4006 refuse from host) |
| S3 4001 loopback bind | **fixed** (full anchoring `/flush` re-test deferred to Chunk 9) |
| S4 ensureCaseLead live-role recheck | **fixed** + test |
| S5 password reset kills sessions | **fixed** + test |
| S7 trust proxy | **fixed** + test |
| S10 CSV formula neutralisation | **fixed** (server + client) + test |
| S11 iframe sandbox | **fixed** |
| S12 security headers / CSP | **fixed** (verified live: SPA + Recharts render, no CSP violation) |
| S13 sessionStorage token | **fixed** (verified live) |
| S14 lead cannot add admin to roster | **fixed** + test |
| S15 generic gateway error body | **fixed** |
| S16 evidence-store generic errors | **fixed** |
| S6 async scrypt | **deferred** — invasive across boot + 3 test files; medium DoS on local-dev; do in isolation |
| S17 rate-limit auto-log routes | **deferred** — pairs with S6 (shared rate-limit utility); benchmark path unaffected |
| S9 evidence-store DELETE scope guard | **deferred** — largely resolved by S2 (4006 no longer host-reachable) |
| S19 LIMIT on list/search | **deferred** — low; behaviour change needs a frontend check |
| S20 server-side content sniffing | **deferred** — S11 sandbox is the load-bearing mitigation; sniffing is defence-in-depth |

Deferred items are tracked as a follow-up; none is high-severity once S1/S2 land.

---

Findings are ranked by severity and classified:

- **fix** — a genuine defect fixable without breaking a binding invariant.
- **document-as-designed** — real, but deliberately so; hardening it would destroy a
  measured property of the thesis. Belongs in the paper's security-caveats section.
- **needs-contract-amendment** — fixing it would change a frozen contract → STOP and ask.

## Coverage and confidence (read this before acting)

This pass is **incomplete** and the reader must not treat it as a clean bill of health:

| Dimension | Status |
|---|---|
| Authentication / session / credentials | reviewed |
| Authorization / RBAC vs CONTRACTS §6/§12-7/§12-8 | reviewed |
| Network exposure / secrets / service trust | reviewed |
| Frontend security | reviewed |
| Injection & output encoding (backend SQL, path traversal, filename handling) | reviewed (round 2, inline, author-verified) |
| Error handling / info leakage / DoS | reviewed (round 2, inline, author-verified) |

The planned adversarial-verification stage **did not run** (every verifier agent failed on
the session limit). Two reviewers also ran while the safety classifier was unavailable.
Consequently **no finding here carries agent verification**; instead the author
independently re-read the cited code for every finding marked ✅ below. Findings marked ⚠️
are carried from the reviewers' reading and are *not* independently confirmed — verify
before acting on them.

The final two dimensions were completed in a second, inline pass (S15–S20 below); every
claim there was read directly from the source by the author, so they are all ✅.

---

## HIGH

### S1 — `/internal/anchor-root` is authenticated but not principal-gated ✅
`gateway/src/app.js:755` · classification: **fix** · contract: CONTRACTS §6

Global `auth.authenticate` admits *any* principal, so a plain investigator session — the
lowest role — can `POST /internal/anchor-root` and commit arbitrary Merkle roots to
`coc-main` on the Anchoring variant. Nothing downstream re-checks the caller.

Because the chaincode keys roots on `(scopeId,batchId)` and rejects duplicates, an attacker
can also **squat a predictable batchId** so the genuine batch's `CommitAnchorRoot` fails —
denying verification for every event in that batch.

CONTRACTS.md:327 states the batcher authenticates to this route with `GLEIPNIR_TOKEN`;
nothing grants user sessions access. Restricting it to the service principal therefore
*implements* the contract rather than changing it.

**Fix.** Add a `requireService` guard and apply it to both `/internal/anchor-root` routes.
The batcher and verification service both use the service token, so the benchmark path is
untouched.

### S2 — internal service ports are published on all host interfaces ✅
`network/compose/compose-services.yaml:62,77,110,122,140,158` · classification: **fix**
· contract: CONTRACTS §6 lines 185-186 declare case-registry/evidence-store *internal-only*

Confirmed published: `4001` batcher, `4002` receipt-store, `4003` anchor-client, `4004`
verification, `4005` case-registry, `4006` evidence-store — none bound to loopback.

The gateway is where **every** user, role and per-case ACL decision lives. Publishing 4005
and 4006 puts a complete bypass of that layer on the host, gated only by
`internal-dev-token` — a value committed in the repo. One header enumerates every case,
roster and evidence row, or reads/deletes any blob. 4001–4004 have **no authentication at
all**: reaching 4003 lets an attacker submit roots on `anchor-main` signed by the fixed
`AnchorClientMSP` identity, which is one of the thesis's held-constant experimental
controls.

**Fix (corrected — see S3).** Remove the `ports:` block for 4002, 4003, 4004, 4005, 4006.
Bind 4001 to `127.0.0.1:4001:4001` — **not** removal. Add a one-line note to CONTRACTS §6
that these are not host-exposed.

### S3 — ⚠️→✅ correction: 4001 **cannot** simply be unpublished (RQ2 data would silently zero)
`benchmark/workload/verify.js:28,46` · classification: **fix (constraint on S2)**

My implementation plan asserted that only `gateway:3000` was needed on the host. **That was
wrong**, and I verified the correction directly: `verify.js:28` defaults
`BATCHER_URL` to `http://localhost:4001` and line 46 POSTs `/flush` from the host during the
RQ2 verify workload (documented in `benchmark/README.md:28`).

The call is wrapped in `.catch(() => {})`, so removing the port **fails silently**: batches
never close, verification returns `missing-anchor-root`, and the thesis's RQ2 dataset is
quietly invalid with no error anywhere. Loopback binding preserves Caliper's access while
removing LAN and cross-container reach.

---

## MEDIUM

### S4 — `ensureCaseLead` never re-checks the caller's current global role ✅
`gateway/src/app.js:242-251` · classification: **fix** · contract: CONTRACTS §12-8

The guard short-circuits admins, then checks only the **case** role row. A user demoted from
global `lead` to `investigator` keeps every case-lead power (roster management, categories,
case update) on cases where a stale `lead` participant row survives. Since the contract says
users are deactivated and never deleted, demotion is a realistic operation.

`auth.js` re-fetches the user on every request, so `req.principal.role` is live — the fix is
reliable.

**Fix.** After the case-role check, also require `req.principal.role === 'lead'`.

### S5 — admin password reset does not invalidate the target's live sessions ✅
`gateway/src/app.js:178`, `gateway/src/sessions.js:35` · classification: **fix**

`sessions.js` exports only `{create, get, destroy}` — `destroy` is by token, and the reset
route never calls it. Password reset is the standard response to a suspected compromise, yet
an attacker holding a stolen token keeps full access for the remainder of the 8-hour TTL.
Deactivation and role change *do* propagate immediately, so this is an inconsistency in an
otherwise coherent model.

**Fix.** Add `destroyForUser(userId)` to `sessions.js` and call it after a successful reset.

### S6 — synchronous `scryptSync` on the unauthenticated login route ✅
`gateway/src/users.js:29,40` · classification: **fix**

Both hashing and verification use `crypto.scryptSync`, blocking the Node event loop. The
login route is unauthenticated and, by design (§6), performs full scrypt work even for
unknown usernames to prevent timing-based enumeration. A modest request rate with random
usernames therefore stalls the **entire gateway** — every authenticated read included.
The per-username throttle cannot bound it because each request uses a fresh username.

**Fix.** Use the async `crypto.scrypt` (promisified) so the KDF runs on the libuv
threadpool. The dummy-hash timing equalisation is preserved verbatim.

### S7 — `trust proxy` unset: the login throttle collapses to one global key per username ✅
`gateway/src/app.js:102` · classification: **fix** · contract: CONTRACTS §6 line 243
("throttled per (IP, username)" — the IP dimension is not actually realised)

Confirmed: no `app.set('trust proxy', …)` anywhere in `gateway/src`. Behind nginx every
request carries nginx's socket IP, so the `${req.ip}|username` key degenerates to
per-username. Five bad guesses against the known `admin` account lock it out for **every**
client for the window — an unauthenticated account-lockout DoS.

**Fix.** `app.set('trust proxy', 1)` (exactly one hop). Do **not** use `true`; document the
residual that a client reaching `:3000` directly can still spoof `X-Forwarded-For` — an
accepted local-dev caveat.

### S8 — batcher `/flush` is unauthenticated on a world-published port ⚠️
`services/merkle-batcher/src/index.js:266` · classification: **fix**

During a steady-state run, anything that can POST `/flush` turns configured `N=250` / `K=50`
batches into many small partial batches. Nothing in `manifest.json` records that it happened,
so the compression and latency numbers would be wrong **and unexplained**. This is a
research-integrity risk more than a security one. Addressed by the S2/S3 loopback bind; do
**not** add a token, since `verify.js:46` calls it unauthenticated.

### S9 — evidence-store `DELETE /blobs/:id` is not scope-enforced ⚠️
`services/evidence-store/src/index.js:156` · classification: **fix (low after S2)**

The contract scopes this route to ingest rollback; the code enforces nothing. Combined with
the published 4006 and the committed token, one request permanently destroys an evidentiary
binary while the ledger keeps the trail — producing a permanently unverifiable exhibit.
Largely neutralised by removing the host port; a defence-in-depth guard (rollback token or
refuse once the blob is indexed) is optional.

### S10 — CSV formula injection in the CoC export ✅
`gateway/src/csv.js:9` and `frontend/src/pages/investigator/CaseDetailPage.tsx:36`
· classification: **fix**

`cell()` implements RFC-4180 quoting only. User-controlled fields (evidence label, original
filename, acquisition location, handed-over-by, case name, note/transfer text) flow into the
export un-neutralised, so a value beginning `=`, `+`, `-`, `@`, TAB or CR executes when the
lead opens the court CSV in Excel — the intended workflow for this artifact.

**Fix.** Prefix such values with `'` before quoting, in both the server encoder and the
client-side export. No machine consumer re-parses these files, so the shape change is safe;
extend `gateway/test/csv.test.js`.

### S11 — blob preview iframe has no `sandbox` ✅
`frontend/src/pages/investigator/EvidenceDetailPage.tsx:95` · classification: **fix**

A user-uploaded PDF is rendered in a same-origin `blob:` iframe with full frame privileges
and no `sandbox`. Uploading is available to any case contributor, and the viewer is typically
a lead or admin. Combined with S12 (token in `localStorage`), active content in the frame is
a plausible path to session theft.

**Fix.** `sandbox=""` plus `referrerPolicy="no-referrer"`; the built-in PDF viewer does not
need `allow-scripts`.

### S12 — no CSP / `X-Frame-Options` / `X-Content-Type-Options` on the SPA origin ⚠️
`frontend/nginx.conf:5` · classification: **fix**

Without `frame-ancestors`/XFO the app can be framed and clickjacked onto destructive
controls (transfer custody, flag). A CSP is also the main structural mitigation for S11/S13.

**Fix.** Add XFO `DENY`, `nosniff`, `Referrer-Policy: no-referrer`, and a conservative CSP.
Verify the Vite bundle still loads.

---

## LOW

### S13 — session bearer token in `localStorage` ⚠️
`frontend/src/auth/AuthContext.tsx:61` · classification: **fix (small) / partly by design**

Script-readable, persists across tabs, 8-hour absolute TTL. Mitigated by React escaping and
the absence of `dangerouslySetInnerHTML`. `sessionStorage` is a cheap improvement; an
HttpOnly cookie is **not** appropriate here (the gateway is header-authenticated by contract
and cookies would add CSRF surface).

### S14 — a case lead can add an **admin** to their case roster ⚠️
`gateway/src/app.js:326` · classification: **fix**

`GET /users/directory` hides admin accounts from leads (M25b: "admins sit above a lead's
access scope"), but the write path does not mirror the rule, and the seeded operator is
literally `admin`. Since participation is exactly what unlocks the §12-8 blob-content check,
a lead can pull an admin into a case's scope.

**Fix.** Mirror the directory rule on `POST`/`PATCH` participants when the caller is a lead.

---

## Round 2 — injection / output encoding, and errors / DoS (all ✅ author-verified)

### Clean results (no action)

- **SQL injection: none.** Every dynamic `WHERE` in `services/case-registry/src/index.js`
  (lines 310-325, 572-592) is assembled from **fixed literal fragments**; all user values are
  bound as named parameters (`@participant`, `@q`, `@flag`, …). `LIKE` patterns escape
  `% _ \` and use `ESCAPE '\'`. The only interpolated identifier, `CATEGORY_ORDER`
  (line 42), is the hardcoded constant `"(name = 'Other'), name"` — not user input.
  better-sqlite3 prepared statements throughout.
- **Path traversal: structurally prevented.** `SAFE_EVIDENCE_ID = /^[A-Za-z0-9._:-]+$/`
  (`services/evidence-store/src/index.js:23`) forbids `/` and `\`, so
  `path.join(dataDir, id)` can never leave the data directory; the `app.param` guard
  (line 69) covers every `:evidenceId` route and also rejects the `.meta.json` suffix,
  closing the sidecar-collision trick. Content-Disposition is sanitised by
  `dispositionName` (line 45).
  *Info only:* the regex admits a bare `..` and `:`. Neither is exploitable — `..`/`.`
  resolve to a directory and fail `EISDIR`, and `:` (an NTFS ADS separator) is inert in the
  Linux container. No change needed; worth knowing if the store is ever run on Windows.

### S15 — gateway `wrap()` returns raw upstream error text to the client ✅
`gateway/src/app.js:140` · classification: **fix** · severity: **low-medium**

```js
return res.status(502).json({ error: 'upstream error', detail: String((err && err.message) || err) });
```
Any unmapped failure surfaces the internal exception message — service hostnames, and
(via S16) absolute container filesystem paths — to any authenticated caller.

**Fix.** Log the detail server-side; return a generic message (optionally a correlation id).
Keep the existing status-carrying and `isNotFound` branches untouched, since routes and
tests depend on their pass-through semantics.

### S16 — evidence-store 5xx handlers leak filesystem paths ✅
`services/evidence-store/src/index.js:96,101,113,131,147,162` · classification: **fix**
· severity: **low**

Six handlers return `detail: err.message`, and Node `fs` errors embed absolute paths
(`ENOENT: no such file or directory, open '/data/<evidenceId>'`). Reachable through the
gateway's 502 detail (S15). Largely contained once 4006 is unpublished (S2), but the
message should still be generic.

### S17 — authenticated ledger-write amplification through the auto-AccessLog ✅
`gateway/src/app.js:257-262`, report loop at `477-479` · classification: **fix**
· severity: **medium**

`logAccess` correctly ignores the service principal, so *unauthenticated* amplification is
not possible. But **any** authenticated user with access to one case can drive unbounded
on-chain writes, and there is **no rate limiting anywhere except the login route**.

The strongest vector is the CoC report: trail reads are nicely bounded (chunks of 4), but
the logging loop is one sequential `AccessLog` **per exhibit**, so a single
`GET /cases/:id/coc-report` on an N-exhibit case commits N ledger transactions. Repeated
fetches inflate ledger size — a quantity this thesis *measures* — and flood the exhibit's
custody trail with noise.

Benchmark data is not at risk: Caliper uses the service token, which never auto-logs.

**Fix.** Add a modest per-session rate limit on the auto-logging read routes (view /
download / export / coc-report). Do **not** make the logging asynchronous or best-effort —
synchronous logging is the documented contract (S18).

### S18 — synchronous auto-log couples read availability to chain health ✅
`gateway/src/app.js:257-262` · classification: **document-as-designed**

Because the ACCESS write is awaited, a slow or down ledger makes evidence reads fail rather
than silently serving unlogged access. That is the correct trade for a chain-of-custody
system and is the stated contract (§6, "synchronously auto-append"). Verified live in
Chunk 2. Record as an availability caveat in the paper; do not "fix".

### S19 — unbounded result sets on list/search ✅
`services/case-registry/src/index.js:324-325, 592` · classification: **fix (low)**

`/cases` and `/evidence-index` search build `SELECT … ORDER BY …` with **no `LIMIT`**. The
case activity feed does it correctly (`Math.min(limit || 50, 200)`, line 684). Harmless at
thesis scale; a capped default plus `limit` parameter is cheap insurance.

### S20 — uploaded MIME type is client-declared and drives the render path ✅
`gateway/src/app.js:594,626-627` · classification: **fix** · severity: **medium**

`req.file.mimetype` and `originalname` are stored verbatim with no server-side content
sniffing. The stored `mimeType` is what the SPA's `previewKind()` consults to decide whether
to render the blob in an **iframe** — so an uploader fully controls that decision by
declaring `application/pdf` for arbitrary bytes. This is the enabling half of S11; the two
should be fixed together.

**Fix.** Sandbox the frame (S11) *and* verify the magic bytes server-side before trusting
the declared type for render decisions — at minimum, only allow the preview path for types
confirmed by content sniffing. Size is already capped at 25 MiB by multer.

---

## Document-as-designed (do NOT "fix")

- **D1 — receipt-store is unauthenticated and un-hardened.** `CLAUDE.md` is explicit: no
  auth, hash chains, signatures or replication. Its weaker integrity is a *measured property*
  and a stated thesis caveat. Note carefully: **removing its host port mapping is not
  hardening** — it adds no integrity mechanism and changes no API — so S2 does not conflict
  with this invariant.
- **D2 — committed default secrets** (`dev-token`, `internal-dev-token`,
  `admin-dev-password`) in `network/compose/.env`. Deliberate for a reproducible local-dev
  thesis artifact.
- **D3 — session tokens over plaintext HTTP with an absolute-only TTL.** Non-production
  posture; belongs in the paper's caveats.
- **D4 — the §12-8 admin blob-content barrier is self-serviceable.** An admin can add
  themselves to a roster and then download. The contract's literal wording is satisfied; the
  control is *auditability* (self-grant always leaves an attributed, immutable
  `PARTICIPANT_ADDED` row), not prevention. Document this in AS-BUILT so the thesis does not
  overclaim it as an access barrier.

## Needs-contract-amendment (STOP and ask)

- **C1 — the service token is a single shared static secret committed to the repo**, and it
  authenticates every route after `/healthz`, internal routes included. Anyone reading the
  thesis artifact can commit anchor roots on the Anchoring variant. The token's semantics are
  frozen (Caliper and the smoke scripts depend on them), so the mechanism must not change.
  The available non-breaking mitigation is to treat the *value* as deployment-variable
  (generate per bring-up, keep `dev-token` as the documented default) — that still touches a
  documented default, hence STOP-and-ask before doing it.

---

## Recommended fix order for Chunk 4

1. S2 + S3 (port exposure, with 4001 on loopback — highest blast-radius reduction, one file)
2. S1 (`requireService` on `/internal/anchor-root`)
3. S4, S5, S7 (authz/session correctness — small, well-understood)
4. S6 (async scrypt)
5. S10, S11 + S20, S12 (CSV neutralisation; iframe sandbox **with** server-side content
   sniffing — fix these two together; security headers)
6. S15, S16 (generic error bodies)
7. S17 (rate-limit the auto-logging read routes)
8. S14, S13, S19, S9 (lower value; S9 mostly resolved by S2)

Every fix must keep the service-token path byte-compatible and must not perturb the
benchmark write path. Re-run: gateway/case-registry/evidence-store unit gates, frontend
vitest + build, and a live `smoke-library.sh`. **After the S2/S3 port change, re-run a
variant smoke that exercises the batcher** (anchoring) to prove `verify.js`'s host `/flush`
still reaches 4001.

All six dimensions are now reviewed. Findings marked ⚠️ (S8, S9, S12, S13, S14) are still
carried from the agent pass without independent confirmation — re-read those before
implementing them.
