# OWASP Top 10 (2021) review — GLEIPNIR evidence-library web-app tier

Date: 2026-07-24 · Base branch: `owasp-top10-review` (off `main`) · Method: static
review of the off-chain stack (gateway, frontend, Node services) + live probes against
the running **standard** variant, plus the prior S1–S20 review as the source of truth.

**Scope (locked with the authors):** the web-application tier only — `gateway/`,
`frontend/`, `services/*`. The Fabric network, orderers/peers, and CA configuration are
out of scope (benchmark- and SHA-sensitive). Every change keeps the static
`GLEIPNIR_TOKEN` service path byte-compatible and never perturbs the benchmark write
path. Live probes run exclusively against the sacrificial `qa-*` users + "QA Test Bench"
case; the 24-exhibit manual-test fixture is never touched (verified by trail delta).

**How to read this.** Each category gives: *what the class is → the GLEIPNIR control →
evidence (file:line) → live-probe result → new fix applied (N#) → residual caveat (D#/C1)*.
Legend: **[FIXED]** already remediated under an S-number; **[NEW]** a gap this OWASP pass
found and fixed (N1–N5); **[CAVEAT]** intentional, documented-as-designed (D1–D4, C1) —
**not** a defect.

Prior review: `docs/audit/security-review.md` (S1–S20, all fixable items resolved).

---

## A01 — Broken Access Control

**What it is.** Users acting outside their intended permissions: authorization bypass,
insecure direct object references (IDOR, horizontal), privilege escalation (vertical),
missing function-level access control, forced browsing.

**GLEIPNIR controls.**
- Two-principal bearer auth: static service token vs. opaque user session; the user is
  re-fetched per request so deactivation/role-change propagate immediately
  (`gateway/src/auth.js:22-41`).
- Object-level authz on **every** evidence/case route via `ensureEvidenceAccess`
  (role ladder viewer/contributor/lead; unknown id → 404 to stop probing) and
  `ensureCaseLead` (admin bypass, non-participant → 404, live global-role recheck)
  — `gateway/src/app.js:287-331`. **[FIXED S4]** (stale case-lead), **[FIXED S14]**
  (lead cannot add an admin to a roster), **[FIXED S1]** (`requireService` on
  `/internal/anchor-root`).
- Non-admin case list/detail is scoped by injected `participant` filters and the
  "404 don't leak existence" pattern throughout (`app.js:348,384-386,486-487,561-562`).
- Admin metadata bypass does **not** extend to blob content: download forces admins
  through case participation (`ensureEvidenceAccess(...,{content:true})`, `app.js:815`).

**Live-probe result (`scratchpad/probe-a01.sh`, 14/14 pass, standard variant).**
- `/internal/anchor-root`: investigator **403**, admin **403**, service token passes the
  gate (downstream 400, not a gate block) — S1 confirmed.
- Vertical: investigator → **403** on `POST/GET /admin/users` and `POST /cases`.
- Horizontal IDOR: outsider → **404** foreign case, **403** foreign evidence + download;
  bogus evidence id → **404** (no enumeration).
- M18 admin blob barrier off-case: metadata **200**, download **403**.
- `GET /runs` intentionally open to any authenticated principal (incl. service token) —
  confirmed 200; it exposes only run metadata (sweep tooling reads it, `app.js:876-878`).

**New fixes:** none required — controls present and confirmed live.

**Residual caveat — [CAVEAT D4].** The §12-8 admin blob barrier is *self-serviceable*:
an admin can add themselves to a roster and then download. The control is **auditability**
(a self-grant always leaves an immutable, attributed `PARTICIPANT_ADDED` row), not
prevention. Documented so the thesis does not overclaim it as an access barrier.

> **Test-environment note.** In the WSL dev mount, `services/case-registry` and the
> gateway's `library.integration.test.js` cannot run — their `better-sqlite3` native
> module was built for Windows and fails to load under Linux with `invalid ELF header`.
> This is unrelated to any change here (a pure-JS edit does not touch native modules); the
> authoritative coverage for those paths is the live `smoke-library.sh` + `functional-test.sh`
> against the correctly-built containers. All non-native gateway suites and the
> filesystem-only evidence-store suite run clean.

---

## A02 — Cryptographic Failures

**What it is.** Sensitive data exposed through weak, missing, or misused cryptography:
plaintext transport, weak hashing, non-constant-time secret comparison, poor randomness.

**GLEIPNIR controls.**
- Passwords: async **scrypt** (16-byte salt, 64-byte key), verified with
  `crypto.timingSafeEqual`, fail-closed on truncated hashes; unknown usernames still run
  full scrypt to defeat enumeration (`gateway/src/users.js:33-48,64-67`). **[FIXED S6]**.
- Randomness is CSPRNG throughout: session tokens `randomBytes(32)`, salts
  `randomBytes(16)`, ids `randomUUID()`, rollback tokens `randomBytes(16)`. No
  `Math.random` in any security path.
- Evidence integrity: RFC 6920 `ni:///sha-256` proof, bytes hashed then discarded
  (`gateway/src/ni.js`); binaries never touch the chain.
- TLS: gRPC-over-TLS to Fabric orderers/peers (`gateway/src/fabric.js:61-65`). No weak/
  legacy primitives (no MD5/SHA-1/DES/ECB, no custom crypto).

**New fix applied — [NEW N1].** The service/internal bearer tokens were compared with
plain `===`/`!==` (`auth.js:26`, `case-registry:229`, `evidence-store:84`) — the only
secret comparisons in the codebase that were **not** constant-time, leaking length and
prefix-match position through timing. Replaced with a length-guarded constant-time helper
`safeEqual(a,b)` that hashes both sides to a fixed 32-byte digest before
`crypto.timingSafeEqual` (so it never throws on a length mismatch), mirroring the password
path. Applied in all three services. Unit-verified: `gateway/test/auth.test.js` (2 new
tests — correctness incl. length-mismatch + service-token byte-compat); full auth suite
22/22. Live re-probe of the running containers happens after the Chunk 11 image rebuild.

**Residual caveat — [CAVEAT D3].** Off-chain traffic (gateway ↔ services ↔ frontend) is
plaintext HTTP with an absolute-only session TTL — non-production posture, single host, no
TLS termination. Stated in the thesis caveats; not changed here (out of the web-app-tier
code scope and by design).

---

## A03 — Injection

**What it is.** Untrusted input interpreted as code/commands: SQL injection, OS command
injection, cross-site scripting (XSS), CSV/formula injection, header/log injection.

**GLEIPNIR controls.**
- **SQL:** `better-sqlite3` prepared statements throughout `services/case-registry`; every
  dynamic `WHERE` is built from literal fragments with user values bound as `@named`
  params; `LIKE` escapes `% _ \` with `ESCAPE '\'`; enum inputs validated against
  allow-lists (**[FIXED]** — S-review round 2, "SQL injection: none").
- **Command:** no `child_process`/`exec`/`eval`/`Function` in any request path (only
  operator-run orchestration scripts, not request-reachable).
- **XSS:** React auto-escapes all rendered user content; **no** `dangerouslySetInnerHTML`
  anywhere; the only `<iframe>` is `sandbox=""` + `referrerPolicy="no-referrer"` and only
  for content confirmed `application/pdf` by magic-byte sniff (**[FIXED S11+S20]**); nginx
  CSP `script-src 'self'` + `X-Content-Type-Options: nosniff` (**[FIXED S12]**).
- **CSV formula:** `gateway/src/csv.js` `neutralize()` prefixes any cell beginning
  `= + - @ TAB CR` with `'` (**[FIXED S10]**), server- and client-side.

**Live-probe result (`scratchpad/probe-a03.sh`, standard variant).**
- SQLi payloads (`' OR '1'='1`, `'; DROP TABLE cases;--`, `%' UNION SELECT * FROM users --`,
  `\`) in case + evidence search → **200**, treated as literal, no 500/leak; the `cases`
  table answers normally afterward. An unknown `flag` enum is ignored (filter not applied,
  returns the normal visible set) — injection-safe because the query is parameterized
  regardless.
- **S10:** a label `=HYPERLINK("http://evil","click")` in the CoC CSV export comes out as
  `"'=HYPERLINK(...`— neutralized with a leading apostrophe.
- **Stored XSS:** a `<script>…</script><img onerror=…>` note body round-trips as the exact
  literal (stored as data, not interpreted server-side); the notes endpoint is served as
  `application/json` (nosniff-safe), and React escapes it on render.

**New fixes:** none required — controls present and confirmed live.

**Residual caveat:** none for this category.

---

## A04 — Insecure Design

**What it is.** Weaknesses rooted in missing or ineffective control *design* (as opposed to
implementation bugs): absent threat modeling, missing security requirements, insecure
business-logic flows.

**GLEIPNIR controls / design posture.**
- **Explicit threat model.** STRIDE surface is deliberately materialized as four
  separately-deployed units so the model maps 1:1 to artifacts (`docs/ARCHITECTURE.md:475`):
  batcher, receipt store (tampering/repudiation), anchor-client identity/MSP
  (spoofing/elevation), chaincode lifecycle (tampering/DoS).
- **Structural security invariants** (not bolt-ons): evidence binaries always off-chain
  (ledger holds only the `ni` proof); MVCC-conflict-freedom is structural via composite
  event sub-keys `(evidenceId, monotonicCounter)`, not client retry loops; case↔evidence
  linkage is off-chain only; users are deactivated-never-deleted so audit actor
  attribution always resolves; notes are append-only.
- **Prior systematic review.** The S1–S20 pass (`docs/audit/security-review.md`) is itself
  the design-level control audit; all `fix`-class items are resolved, S18 is a documented
  design trade, C1 is contract-frozen.

**This OWASP pass — consolidated design ledger.**

| Class | Items |
|---|---|
| **[FIXED]** S-items relevant to web-app tier | S1, S4, S5, S6, S7, S9, S10, S11, S12, S13, S14, S15, S16, S17, S19, S20 |
| **[NEW]** gaps found + fixed here | **N1** constant-time token compare (A02/A07) · **N2** gateway-origin security headers (A05) · **N3** session idle timeout (A07) · **N4** security-event logging (A09) · **N5** dependency scan + benchmark lockfile (A06/A08) · **N6** terminal error handler — malformed-body stack-trace leak (A05/A09, found by live probe) |
| **[CAVEAT]** intentional, do-NOT-fix | **D1** receipt store un-hardened (availability, not integrity, exposure) · **D2** committed default secrets (reproducible local-dev) · **D3** plaintext HTTP + absolute-only TTL + non-empty-only password policy · **D4** self-serviceable admin blob barrier (auditability, not prevention) · **S18** synchronous auto-log couples read availability to chain health (correct for CoC) |
| **[STOP-and-ask]** needs contract amendment | **C1** the single shared static `GLEIPNIR_TOKEN` authenticates every route incl. internal; mechanism frozen by Caliper/smoke dependence — not touched |

**New fixes:** design-review only; the N-fixes land in their own categories (A02/A05/A06/A07/A09).

**Residual caveats:** D1–D4, S18, C1 as tabled above — these are measured thesis
properties and belong in the paper's security-caveats section, not the defect list.

---

## A05 — Security Misconfiguration

**What it is.** Insecure defaults, unnecessary exposure, missing hardening: open ports,
verbose errors, missing security headers, default credentials, over-permissive config.

**GLEIPNIR controls (verified live, `scratchpad/probe-a05.sh`).**
- **[FIXED S2]** Internal service ports **4002–4006 refuse from the host** (probe: all 5
  refuse); only `gateway:3000` and `frontend:8081` are published.
- **[FIXED S12]** The nginx SPA edge sets `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a real CSP
  (all confirmed present on `:8081`).
- **[FIXED S7]** `trust proxy: 1` for correct client-IP throttling.
- Node services run as non-root (`USER node`); no CORS surface (same-origin SPA via the
  nginx `/api` proxy).

**New fixes applied.**
- **[NEW N2]** The gateway's own origin (`:3000`) set **no** security headers — anything
  reaching it directly (bypassing nginx) got bare responses (probe confirmed the gap).
  Added a response-header middleware in `gateway/src/app.js`: `nosniff`, `X-Frame-Options:
  DENY`, `Referrer-Policy: no-referrer`, and a strict `default-src 'none'; frame-ancestors
  'none'` CSP (the API returns only JSON, so it can be maximally strict). Response-side
  only — success bodies and the service-token path are byte-unchanged.
- **[NEW N6 — found by live probe]** A **malformed JSON body** to any endpoint returned
  Express's **default HTML error page with a full stack trace and internal container paths**
  (`/app/node_modules/body-parser/...`). S15 sanitized only the per-route `wrap()` handler;
  `express.json()` throws its parse error in middleware *before* the routes, bypassing it.
  Added a **terminal error-handling middleware** that keeps the client-error status, logs
  any 5xx detail server-side, and returns a generic JSON body (`{"error":"invalid request
  body"}` for a 400). Unit-verified: `app.test.js` (N2 headers present; N6 malformed body →
  generic 400 with no `SyntaxError`/`node_modules`/`/app/`/`<pre>` leak). Live re-probe
  after the Chunk 11 rebuild.

**Residual caveat — [CAVEAT D2].** Default secrets (`dev-token`, `internal-dev-token`,
`admin-dev-password`) are committed in `network/compose/.env` for a reproducible local-dev
thesis artifact. The deeper design residual (single shared static token) is **C1**
(STOP-and-ask, not touched). Out-of-scope infra items noted but not changed (web-app tier
only): CA `-d` debug flag, ccaas `tls_required:false`, Fabric ports on `0.0.0.0`.
