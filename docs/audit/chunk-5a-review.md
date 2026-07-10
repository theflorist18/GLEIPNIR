# Chunk 5a — /code-review: core (chaincode + services + gateway)

Date: 2026-07-07 · Session: chunk 5a of the audit plan
(`C:\Users\LENOVO\.claude\plans\okay-since-i-am-shimmering-squirrel.md`)

**Method:** /code-review skill at **high** effort over the whole-codebase diff vs the
empty tree (`git diff 4b825dc…904 HEAD -- chaincode services gateway`, excluding the
F1 ELF, lockfiles, go.sum — 51 files, 3,759 lines). Per the chunk-4 ops directive,
**zero agent fan-out**: all 8 finder angles (line-scan, removed-behavior, cross-file
tracer, reuse, simplification, efficiency, altitude, CLAUDE.md conventions) and the
1-vote verification were executed inline by the lead, every cited line read first-hand.
Angle B (removed-behavior) is vacuous against an empty-tree base — repurposed as a
semantic-invariant re-audit of the read files. Candidates were deduped against F1–F53
before verification (F23/F44/F25/F5/F47-as-scoped etc. not re-reported). Findings are
recorded, NOT fixed (fix pass = chunk 6). Numbering continues from chunk 4's F53.

## Verdict summary

**0 new blockers, 4 bugs, 1 contract-drift, 8 notes (F54–F66).** The core holds up
well under line-level review: the chaincode is deterministic and its MVCC design is
exactly as contracted, the Merkle code is correct against the normative vectors, and
the gateway/service seams match CONTRACTS §4–§9 (as chunk 3 established). The four
bugs are all "the happy path is fine, the edge kills you" defects: a malformed receipt
**crashes the verification service process** (F54), the RQ2 latency metric silently
**excludes receipt body transfer/parse time** (F55), the gateway/anchor-client keystore
loader has the **same stale-key hazard as F47** and would survive F47's fix (F56), and
batched parallel-anchored writes **skip caseId validation** and silently land in the
`shared` scope (F57).

## Findings

### Bug

- **F54 · A malformed receipt crashes the verification service — unguarded synchronous
  throw in an Express 4 async handler = unhandled rejection = process exit.**
  `services/verification/src/index.js:90`: `computeRoot(receipt.leafHash,
  receipt.siblingPath || [])` runs OUTSIDE any try/catch inside the `async (req,res)`
  handler (`:65`). If `receipt.leafHash` is missing or not a string,
  `Buffer.from(undefined, 'hex')` throws TypeError (same for a non-array
  `siblingPath` or a step missing `hash` in `computeRoot`, merkle.js:49-57). Express 4
  (installed: 4.22.2 — verified in node_modules; async rejections are NOT routed to
  the error handler) discards the rejected promise → unhandled rejection → **Node 20
  default kills the process**. Reachability: the receipt-store deliberately accepts
  ANY JSON body (`receipt-store/src/index.js:48-59`, un-hardened by design — an empty
  `PUT` stores `{}`), so one junk/corrupted-but-parseable receipt takes down the RQ2
  metric service mid-run; every subsequent /verify fails until Docker restarts it.
  Note the irony: the receipt-corruption scenario is exactly the availability
  exposure the thesis *measures* — verifying a corrupt witness must yield a graceful
  `ok:false`/4xx, not a crash. Unit tests miss it because every test receipt is
  well-formed. **Verdict: CONFIRMED** (mechanism constructible end-to-end).
  *Fix (chunk 6):* validate receipt shape after parse (leafHash hex string,
  siblingPath array of {pos,hash}) → 502/422 `malformed-receipt`; or wrap steps 2–3
  in try/catch. Keep it OFF the timed path (validate before t1).

- **F55 · RQ2 verification latency systematically excludes receipt body download +
  JSON parse — `fetchMs` is stamped before `r.json()`.**
  `services/verification/src/index.js:73-81`: `t0` → `await fetch(...)` (resolves on
  HEADERS) → `steps.fetchMs = msSince(t0)` (`:74`) → … → `receipt = await r.json()`
  (`:81`, unmeasured). `latencyMs` is defined as the sum of the three steps (`:107`),
  so the witness's body transfer + parse — the only part of the fetch that scales
  with the O(log N) sibling path, i.e. with the thesis's independent variable N —
  falls outside the reported audit latency. On localhost Docker this is sub-ms, but
  it is a *systematic, N-correlated* undercount in the exact metric RQ2 reports.
  **Verdict: CONFIRMED.** *Fix (chunk 6):* move the `fetchMs` stamp after
  `await r.json()` (and stamp the 404/!ok early-returns where they are). One-line
  reorder; re-pin the README's step definitions.

- **F56 · Gateway and anchor-client load the alphabetically-first keystore file —
  the service-side sibling of F47, and it survives F47's fix.**
  `gateway/src/fabric.js:18-22` (`firstFile`: `readdir → sort → [0]`), used for
  `keystore` at `:26`; identical logic in `services/anchor-client/src/fabric.js:20-26,31`.
  After a re-enrollment over a live crypto tree (the F47 trigger: fabric-ca ADDS a
  second hash-named key beside the old one), hex-named keys always sort before
  `priv_sk` (`0-9a-f` < `p`), so `firstFile` picks the alphabetically-first HEX key —
  50/50 the stale one → gateway/anchor-client sign with a key that no longer matches
  `signcerts/cert.pem` → opaque endorsement/auth failures. Crucially, F47's planned
  fix (normalize `priv_sk` to the newest key in registerEnroll.sh) does NOT protect
  these services: they never read `priv_sk` preferentially, and the stale hex key
  remains in the directory. Fresh runs are safe (one hex key + identical `priv_sk`
  copy). **Verdict: CONFIRMED** (conditional on the same re-enrollment scenario as
  F47). *Fix (chunk 6, design together with F47):* in both fabric.js files prefer
  `priv_sk` when present (it becomes authoritative post-F47), else newest mtime —
  or have the F47 fix delete stale keys so the directory holds exactly one.

- **F57 · Batched parallel-anchored writes skip caseId validation — a missing/invalid
  caseId silently lands events in the `shared` scope instead of failing 400.**
  `gateway/src/variantRouter.js:46-51`: `routeWrite` for batched variants enqueues
  immediately and never calls `channelFor`, so the `CASE_RE` guard (`:34-42`) that
  protects the direct `parallel` path never runs for `parallel-anchored`.
  `gateway/src/app.js:45` then defaults the event's caseId: `caseId: caseId || 'shared'`
  → batcher (parallel-anchored: `scopeId = event.caseId`, batcher index.js:232)
  builds a `shared`-scope K-batch → anchor-client happily commits scope `shared` to
  anchor-main. Result: a client that forgets caseId in the per-case variant gets 202s
  and its events silently pool in a scope that shouldn't exist in this variant (mixed
  across cases), while the same omission on the direct parallel path is a 400. Reads
  are asymmetrically strict (routeRead → channelFor → 400). Today's callers (Caliper
  workloads, smoke) always pass caseId, so this is latent — but it's the exact class
  of silent default that F40/F51 flagged for documentation, now WITHOUT the
  round-trip consistency excuse. **Verdict: CONFIRMED.** *Fix (chunk 6):* in
  `routeWrite`, when `isParallel(variant)`, validate `CASE_RE.test(caseId)` before
  enqueue (batched) as well as before submit (direct).

### Contract-drift

- **F58 · Service images are built WITHOUT the committed lockfiles — `COPY package.json`
  + `npm install` in all five Node Dockerfiles → non-reproducible images.**
  `gateway/Dockerfile:3-4` and the identical pattern in
  `services/{merkle-batcher,receipt-store,anchor-client,verification}/Dockerfile`:
  only `package.json` is copied and `npm install --omit=dev` resolves dependencies
  fresh at build time, so image contents drift with the npm registry (e.g. express
  `^4.21.2` already resolves to 4.22.2) — while `package-lock.json` IS committed for
  every module (verified: git ls-files) and the thesis's reproducibility story pins
  the stack and cites configs by SHA. The measured SUT (gateway is ON the measured
  REST path) should be byte-reproducible from the cited commit.
  **Verdict: CONFIRMED.** *Fix (chunk 6):* `COPY package.json package-lock.json ./`
  + `RUN npm ci --omit=dev` in all five Dockerfiles. Related hygiene:
  `chaincode/evidence/` has NO .dockerignore, so its `COPY . .` (Dockerfile:12) drags
  the 20.6 MB F1 ELF into every build context/layer — moot once F1's `git rm` lands,
  but add a .dockerignore anyway.

### Note

- **F59 ·** Batcher boundary work is serialized per receipt: `processBatch` PUTs N
  receipts one-by-one (`merkle-batcher/src/index.js:143-145`) and re-PUTs them
  one-by-one after commit (`:165-168`) → 2×N sequential HTTP round-trips per batch;
  at N=250 the root submit (and the window where /verify returns
  `missing-anchor-root`) is delayed by hundreds of RTTs. Additionally, several fetch
  responses are never consumed (`putReceipt` reads no body on either outcome,
  `:70-75`; `submitRoot` skips the body on !ok, `:97,111`; verification's 404 paths,
  `verification/src/index.js:47,55`) — undici keeps those sockets alive until GC,
  so sustained load accumulates connections. Off the client-visible write path
  (post-202), so note not bug. *Fix idea:* bounded-concurrency `Promise.all` for the
  PUT fan-out; `await resp.text()`/`resp.body?.cancel()` on every non-consumed path.

- **F60 ·** Verification is **receipt-based, not event-based**: nothing off-chain
  binds eventId → leafHash (receipts carry only the hash, batcher index.js:119-126;
  event bytes exist nowhere off-chain post-batch), so `ok:true` attests "this
  receipt's leaf folds to the anchored root", not "this event's content is intact" —
  swapping two receipts within a batch verifies clean. This is consistent with the
  un-hardened-witness caveat (an off-chain receipt swap cannot forge the ledger) but
  the thesis and CLAUDE.md phrase the metric as "fetch **event** → recompute branch
  → verify root"; the implementation fetches the *witness*. Paper/CLAUDE.md wording
  should say "fetch receipt (witness)" and state the receipt-swap property as part
  of the availability-exposure caveat. Author wording decision; no code change
  proposed (embedding event bytes in receipts would change the §5 receipt shape).
  Cross-refs F41/F50 (no on-chain events in batched variants).

- **F61 ·** The REMOVE audit event records no actor in ANY variant: chaincode passes
  `""` (`contract.go:122`) and the gateway's leaf event does too (`app.js:117` —
  the DELETE body's actor is ignored). For a chain-of-custody system, "who disposed
  of the evidence" is forensically material. The §3 signature `RemoveEvidence(id,
  reason)` is contract-fixed, but the chaincode could record the invoker's MSP/cert
  CN via `ctx.GetClientIdentity()` (deterministic — from the signed proposal) in
  `detail`, and the gateway could accept `body.actor` for the leaf event. Author
  decision (touches stored shapes only additively).

- **F62 ·** Audit-trail order is **client proposal-timestamp order, not commit
  order**: sortKey uses `GetTxTimestamp` (client-set) and `keys.go:41-42` claims
  "sortable by commit time" — over-claim; skewed client clocks reorder the forensic
  trail (contract_test.go:251-278 itself demonstrates insertion order ≠ trail order).
  Harmless in the single-host benchmark (one clock); fix the comment and state the
  ordering semantics in the thesis where GetAuditTrail output is described.

- **F63 ·** `CreateEvidence` never checks `entry.ID == evidenceId`
  (`contract.go:38-45`): a mismatched pair stores a head whose `codex.id` differs
  from its state key. All current callers pass them equal (gateway app.js:29;
  workloads verified in chunk 3). One-line guard; author call.

- **F64 ·** Cross-batch duplicate eventIds silently re-point the witness: the 409
  guard is per OPEN batch only (`q.ids` reset at trigger, batcher index.js:181-182),
  and the receipt-store PUT is an upsert — a client retry of an already-batched
  event enqueues into the NEXT batch and its receipt overwrites the original,
  orphaning the old batch's leaf. UUID eventIds make organic collisions negligible;
  document as the retry semantics of the enqueue path (at-most-once per batch, not
  per ledger). Cross-ref F44 (batchId collisions are the severe sibling).

- **F65 ·** No inter-service fetch has a timeout (gateway→verification app.js:137,
  gateway→batcher batcherClient.js:10, batcher→store/sinks index.js:70/87/102,
  verification→store/roots index.js:44/51/73): a hung upstream converts into an
  indefinitely hung client request / an indefinitely open batch, i.e. unbounded
  latency tails instead of fail-fast during live runs. `AbortSignal.timeout(ms)` per
  call if wanted; keep the chosen budget out of the timed verification steps.

- **F66 ·** anchor-client's run-directly detection hand-rolls the file URL
  (`index.js:182`: `` new URL(`file://${argv[1].replace(/\\/g,'/')}`) ``) — wrong on
  Windows (`file://C:/…` puts the drive in the URL *host*; never equals
  import.meta.url's `file:///C:/…`), so `node src/index.js` on the host silently
  does nothing — while the imported `pathToFileURL` (`:16`) that solves exactly this
  sits unused. Fine inside the Linux container (`/app/src/index.js` round-trips).
  *Fix:* `import.meta.url === pathToFileURL(process.argv[1]).href`.

## Clean checks (inline, condensed)

- **Bans/conventions re-swept during read:** no "system channel"/couchdb/lockb0x/
  zk/poseidon/rollup/OTS in any in-scope file; images pinned node:20.19-alpine /
  golang:1.25.5 / fabric-gateway 1.11.0 exact; chaincode ops exactly the contracted
  eight; ISO/IEC 27037 clause comments present on all four CoC ops.
- **Semantic invariants (re-verified at line level):** AccessLog is a single
  appendEvent, never touches the head (contract.go:96-100); readActiveHead used only
  by Transfer/Remove; no tx-retry loop anywhere (batcher's receipt re-PUT is HTTP
  availability handling, per chunk-1 ruling); receipt-store un-hardened with only the
  charset guard; payload bytes hashed-and-discarded (ni.js; app.js:24-27); chaincode
  uses GetTxTimestamp only, JSON marshalling deterministic (sorted map keys), no
  wall-clock, no map-order leakage (GetAuditTrail preserves iterator order).
- **Merkle (both copies):** canonicalJSON sorts keys recursively at every depth,
  arrays preserved; interior hash over hex-DECODED bytes; odd node PROMOTED —
  `siblingPath`'s promoted-node index arithmetic verified by hand for 3/5-leaf
  shapes; V1/V2 normative vectors pinned in both test suites; batcher's
  enqueue-time batchId/leafIndex match the closed batch exactly.
- **Cross-file tracing:** batcher→anchor-client body matches anchor-client's
  validation; receipt shape field-for-field = verification's reads; anchor-client
  caseId injection last-wins (F51 chain reconfirmed); gateway wrap() covers every
  route (the one unguarded async throw is F54, in verification); memStub's
  composite-key encoding faithfully mirrors the real shim (nul-delimited), so the
  Go tests' range-scan semantics are trustworthy.
- **Angle B (removed behavior):** vacuous — empty-tree base, no deletions to audit.

## Ops note

Executed 100 % inline (zero subagents), per the chunk-4 directive. Inline high-effort
review of ~3.8k lines fits comfortably in one Pro window with full file reads +
verification; recommend the same for chunk 5b.

## Handoff

- **Chunk 5b:** same mechanism over benchmark/orchestration/network/frontend;
  carry F57 (check the frontend/demo actually sends caseId in parallel variants) and
  F58 (frontend Dockerfile lockfile usage) forward as watch items.
- **Chunk 6 fix list additions:** F54 (receipt-shape guard in verification — small,
  do with F49's badge states), F55 (one-line fetchMs reorder — REQUIRED before any
  RQ2 data collection), F56 (prefer priv_sk/newest key in both fabric.js — design
  WITH F47), F57 (CASE_RE check in routeWrite batched path), F58 (npm ci + lockfile
  COPY ×5 Dockerfiles; chaincode .dockerignore), F59–F66 author-optional/doc-side.
- **Chunk 7 watch items:** F54 (a single bad receipt kills verification mid-run —
  restart policy `on-failure` would mask it; watch logs), F65 (hang-not-fail
  symptoms during bring-up debugging).
