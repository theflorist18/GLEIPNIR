# Backend code review — gateway + library services

Date: 2026-07-21 · Base commit: `60573e0` · Scope: non-security correctness and quality of
the gateway BFF and the case-registry / evidence-store services. Security was covered
separately (`security-review.md`); the four chaincode ops and their ISO/IEC 27037 clause
comments were left untouched.

## Findings

### B1 — non-ASCII evidence filenames were corrupted (and a latent header crash) — **fixed**
Severity: medium

`multer`/`busboy` decode a multipart filename as **latin1** by default, but browsers send it
as UTF-8 (RFC 7578). So a file uploaded as `証拠.pdf` was stored — and shown in the CoC
court report — as mojibake `è¨¼æ .pdf`. For a forensic system whose report reproduces the
original filename, that is a real data-quality defect.

Worse, the naive correction (re-decode to true UTF-8) exposes a latent crash: the recovered
name can contain code points > 255, and `serviceClients.put` puts it verbatim into the
`x-original-filename` HTTP header. HTTP header values must be latin1, so
`new Request(...)` throws `TypeError: Cannot convert argument to a ByteString` — the ingest
would 502. (Confirmed by direct repro against Node's `fetch`.)

**Fix (coordinated, ingest path only — the benchmark JSON path never touches these):**
1. `gateway/src/app.js` `decodeUploadFilename()` — re-interpret the latin1 bytes as UTF-8 to
   recover the true name (ASCII names are unchanged; ASCII ⊂ latin1 ⊂ the round-trip).
2. `gateway/src/serviceClients.js` — `encodeURIComponent` the name into
   `x-original-filename`, so any code point survives the header as ASCII.
3. `services/evidence-store/src/index.js` — `decodeURIComponent` it back for storage; serve
   downloads with an RFC 5987 `Content-Disposition` (`filename="<ascii fallback>";
   filename*=UTF-8''<pct>`) so a Unicode name never throws when the header is set.

Tests: evidence-store round-trips a Unicode name and serves it via `filename*`
(`evidence-store/test`), and the gateway integration test uploads `証拠 file.pdf` through the
real multipart path and asserts the read-model row shows the true name, not mojibake.

### B2 — redundant case fetch on categorised ingest — **documented, not changed**
Severity: low (efficiency)

In `libraryIngest`, `ensureCaseIngest(req, caseId)` GETs the case, and then — when a
`categoryId` is supplied — the category validation GETs the *same* case again. One avoidable
internal round-trip on the ingest path. Correctness is fine; folding the two reads together
would entangle the authz check with the category check for no behavioural gain, so it is left
as a noted micro-inefficiency.

## Verified correct — no change needed

- **case-registry migrations.** The M18 `role_in_case` CHECK widening rebuilds the table
  inside a transaction and is idempotent (re-run sees `'lead'` already in `sqlite_master` and
  skips); M19 metadata columns use `addColumnIfMissing`; the pre-M18 rows all carry
  now-still-valid roles, so the `INSERT ... SELECT` cannot violate the new CHECK. Fresh DBs
  take the full `CREATE` and skip the rebuild. Covered by the "M18 table rebuild keeps rows"
  test.
- **M25 / M25b backfills.** Preset-category seeding touches only zero-category cases; the
  audit-history backfill materialises derivable events once, guarded by
  `WHERE NOT EXISTS (... case_audit_log ...)`. Both idempotent across reboots; tested.
- **CoC report assembly.** Trail reads are bounded (chunks of 4). The one-`AccessLog`-per-
  exhibit loop is the documented synchronous-logging contract (see S17/S18 in the security
  review), not a defect; both json and csv paths log identically because logging precedes the
  format branch.
- **Two-phase ingest.** blob PUT → chain commit (best-effort blob delete on commit failure) →
  index register. A failure after the append-only commit leaves committed-but-unindexed
  evidence and 502s — a deliberate, documented tradeoff (the chain is the source of truth;
  the index is a rebuildable read-model).
- **`serviceClients`.** Case-registry client is a status-preserving pass-through (never throws
  on non-2xx, so gateway routes forward the registry's own codes); evidence-store client
  streams the blob via the raw `Response` without buffering. Both correct.
- **`wrap()` error taxonomy.** Status-carrying errors pass through; `isNotFound` maps to 404;
  everything else is a logged-server-side generic 502 (S15).

## Gates
gateway 59/59 (+1 B1 integration), evidence-store 9/9 (+1 B1 round-trip), case-registry 22/22
(unchanged), frontend unaffected. Live `smoke-library.sh` re-run after the image rebuild.
