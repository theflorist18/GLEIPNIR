# Audit-log live verification (real users, Standard variant)

Date: 2026-07-21 · Stack: `up.sh --variant standard` · Base commit: `f024058`

Purpose: confirm that **real user actions through the browser** produce a correct,
complete, attributable audit record — the on-chain chain of custody, the persistent
case activity log (M25b), and the CoC report. Driven by human users (not the smoke
script), because the smoke exercises the API directly and cannot catch defects that
live in the UI's own call pattern.

## Method

Three seeded role accounts drove the SPA at `:8081`: `dara` (lead), `rizky`
(investigator/contributor), `oscar` (investigator, non-participant), plus the seeded
`admin`. Verification reads were issued with the **service token** — per
`CONTRACTS.md` §6 it never auto-appends an AccessLog, so observing the trail cannot
perturb it. `GET /evidence/:id`, `/download`, `/export` and `/coc-report` were never
used to inspect, since each of those *writes* an ACCESS event.

Case observed: `CASE-264ae8f6…` ("Johnson Bulgary"), evidence `ab257a11…` (ITEM-001).

## Result: two defects found and fixed

### F78 — flag/details changes were written to the case audit log with NO actor

`FLAG_CHANGED` and `EVIDENCE_DETAILS_UPDATED` landed in `case_audit_log` with an
empty actor, while every sibling event (`CASE_CREATED`, `PARTICIPANT_ADDED`,
`NOTE_ADDED`, `EVIDENCE_ADDED`, …) was correctly attributed. Observed live:

```
04:58:54  FLAG_CHANGED  actor=(none)  {"from":"PROCESSED","to":"NEEDS_LEAD_REVIEW"}
04:55:53  NOTE_ADDED    actor=dara    {"noteId":"note-e6f7…"}
```

**Cause.** Both events are emitted by case-registry's `PATCH /evidence-index/:id`
handler, which takes the actor from `req.actor` — the `X-Gleipnir-Actor` header set
by `serviceClients.request(…, opts)` when `opts.actor` is supplied. The gateway's
flag route and details route were the **only** mutating registry calls that omitted
the `opts` argument; six sibling routes pass it. So the header was never sent and the
rows were written unattributed.

**Impact.** Unattributed entries in a chain-of-custody audit log — directly contrary
to `CONTRACTS.md` §6 ("under a user session the audit actor is **always** the
authenticated username"). Not a privilege bug (authz was enforced correctly); a
record-integrity bug: the log could not answer *who* changed an exhibit's flag.

**Fix.** Pass `{ actor: sessionActor(req) }` on both calls, matching the established
pattern. `sessionActor` returns `undefined` for the service token, so the service
path keeps its contract (no forced session attribution).

### F79 — the UI forged chain-of-custody events after every download/export

The on-chain trail showed a `view` ~2 s after each download and export that no
examiner performed:

```
04:55:15  ACCESS  dara  download
04:55:17  ACCESS  dara  view      <- +2.1s, automatic
04:55:32  ACCESS  dara  export
04:55:34  ACCESS  dara  view      <- +2.1s, automatic
```

**Cause.** `EvidenceDetailPage.doDownload`/`doExport` called the page's full
`refresh()` to display the event they had just written. `refresh()` re-reads the
record via `client.getEvidence()` → `GET /evidence/:id`, which **auto-appends
ACCESS('view')**. The refresh intended to *observe* the log instead *extended* it.
The preview loader (`onLogged`) had the same problem.

**Impact.** Every download was recorded as "download + view". The trail overstated
access, attributing to the examiner reads they never made, and could never settle —
each refresh both showed and created an event. In a forensic chain of custody this is
a correctness defect, not cosmetic.

**Fix.** A trail-only `refreshTrail()` that calls `client.getAudit()` (never
auto-logged) is used after download/export/preview. The head record is immutable and
the index/roster do not change on a read, so the trail is the only thing that can have
moved. The initial page load keeps the full `refresh()` — that view is a deliberate
access and *should* be logged.

## Verified correct (no change needed)

| Surface | Observed |
|---|---|
| On-chain trail content | `CREATE` + `ACCESS` with `detail.action` = `view`/`download`/`export`, real `txId`, ISO ts |
| Actor attribution on-chain | Always the authenticated username (`dara`, `rizky`, `admin`) — never client-supplied |
| Notes / flags | Do **not** auto-append an ACCESS (collaboration routes are off the CoC path) |
| CoC report | Exactly one `ACCESS(coc-report)` per exhibit |
| Admin content restriction | Admin `view`/`audit` 200 and logged; blob `download` 403 off-case |
| Non-participant | Case 404, evidence 403 |
| M25 preset categories | 9 seeded per new case |
| Activity feed | ts-DESC, complete, backed by the persistent `case_audit_log` |

Pre-fix rows remain unattributed in the log by design — it is append-only and is not
rewritten.

## Regression tests added

- `gateway/test/library.integration.test.js` — "M25b: flag and details changes are
  actor-attributed in the case audit log", incl. the service-path assertion.
  Verified to fail without the fix (`actual: undefined, expected: 'ivy'`).
- `frontend/src/pages/investigator/evidenceDetail.test.tsx` — asserts a download and
  an export each refresh the trail **only**, leaving `getEvidence` at exactly one
  call. Verified to fail without the fix (`expected 1 times, but got 2 times`).

## Gates after the fixes

gateway 51/51 · case-registry 22/22 · evidence-store 8/8 · frontend vitest 24/24 ·
`tsc --noEmit` + `vite build` clean · live `smoke-library.sh` 17/17 PASS.

## Operational notes

- Run the JS unit gates on the **Windows host**: case-registry's `better-sqlite3` in
  `node_modules` is a Windows build, so under WSL every gateway integration test dies
  with `ERR_DLOPEN_FAILED: invalid ELF header`, and the WSL distro has no toolchain to
  rebuild it. Docker images compile the module themselves, so the live stack is fine.
- A stack left up from a previous session makes `up.sh` fail at CA registration
  (`Identity 'orderer0' is already registered`) — run `down.sh --wipe` first.
