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
