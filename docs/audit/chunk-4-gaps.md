# Chunk 4 — Known-gaps deep scrutiny (HANDOFF §9)

Date: 2026-07-07 · Session: chunk 4 of the audit plan
(`C:\Users\LENOVO\.claude\plans\okay-since-i-am-shimmering-squirrel.md`)

**Method:** the planned 6-item fan-out (5 agents, items 2+3 merged) was launched but **all
five agents died on the Pro session limit before returning anything** (347k subagent tokens,
zero cached results). Per the chunk-1/chunk-3 precedent, the entire chunk was then executed
**inline by the lead**, reading every cited line first-hand. This chunk had a unique
ground-truth advantage: the pinned Caliper 0.6.0 is installed at
`benchmark/node_modules/@hyperledger/{caliper-core,caliper-cli}`, so connector/report claims
were verified against the **actual installed source**, not docs-from-memory. Findings are
recorded, NOT fixed (fix pass = chunk 6). Numbering continues from chunk 3's F43.

## Verdict summary

**2 new blockers, 4 bugs, 4 notes (F44–F53), and per-item verdicts for all six HANDOFF §9
gaps.** The two blockers are again "passes unit tests, dies on the live wire" defects:
every rest-mode Caliper round crashes on a phantom `TxStatus.SetTimeFinal` API (F45), and
the anchoring/parallel-anchored sweeps corrupt from the second cell onward because batch
ids restart at zero while the ledger persists (F44). The good news: the anchor-root scope
round-trip (item 1) is **consistent in both variants** with a complete quote chain, the
CCaaS package-id wiring and keystore paths are correct for the primary bring-up flow, the
research digests were spot-verified **accurate** against installed sources, and collect.py's
parser is format-compatible with the real 0.6.0 log — its one real defect is round
double-counting (F48).

## Item verdicts (HANDOFF §9 ↔ plan chunk-4 items)

| Item | Verdict |
|---|---|
| 1. Anchor-root scope round-trip | **CONSISTENT both variants** (quote chain below); F40 classified working-as-intended; new sibling blocker F44 (batchId reuse) |
| 2. CCaaS package-id wiring | **WIRED CORRECTLY** for standard/anchoring + sweep path; F46 bug for `up.sh --channels >1`; F52 note (early ccaas start) |
| 3. Keystore paths | **CORRECT on fresh runs** end-to-end; F47 bug on re-enrollment (key/cert mismatch risk) |
| 4. Caliper REST connector | **BLOCKED — F45** (`SetTimeFinal` TypeError kills every rest-mode round); everything else contract-compliant; research digest exonerated |
| 5. collect.py parsing | **Format-compatible with real 0.6.0 output**; F48 double-count bug; minor notes F53 |
| 6. Verify-button fix design | Design delivered (frontend-only, no contract change) under F49; F41 classified under F50 |

## Findings

### Blocker

- **F44 · Batch ids restart at zero on every batcher recreate while the ledger persists —
  all anchoring cells after the first fail every root commit, and verification reads the
  PREVIOUS cell's root at the colliding key (false tamper signals).**
  Chain (all lead-verified): the batcher's sequence is in-memory —
  `services/merkle-batcher/src/index.js:44` (`const queues = new Map();` holding `{ seq, … }`),
  `:52-53` (`batchIdFor = \`${scopeId}-b${String(seq).padStart(6,'0')}\``), reset to 0 on
  process start. `orchestration/sweep.py:124-130` recreates the batcher between sweep cells
  (`set_env_var("BATCH_N", …); recreate_batcher()` — `docker compose … up -d --force-recreate
  merkle-batcher`, sweep.py:65-70) and **never wipes the network between cells or
  repetitions**. The chaincode rejects duplicate keys: `chaincode/evidence/contract.go:150-156`
  — `existing, err := stub.GetState(rootKey); … if existing != nil { return fmt.Errorf("anchor
  root for scope %q batch %q already exists", scopeID, batchId) }`. Consequence for
  `sweep.py --variant anchoring`: cell N=10 commits roots `shared-b000000…` (hundreds); cells
  N=50/100/250 restart at `shared-b000000` → **100 % of their root commits are rejected**
  (`rootStatus:'failed'`, batcher index.js:155-160). Worse than plain failure: the new cells'
  receipts still reference `rootRef.batchId = shared-b000000…`, whose on-chain key holds the
  **first cell's** root, so `GET /verify/:eventId` returns HTTP 200 `ok:false root-mismatch`
  (verification/src/index.js:111-113) — indistinguishable from tampering. RQ2 data survives
  only for the first cell; the same collision hits parallel-anchored K-cells (`case-NNN`
  scopes reused across K values) and ANY mid-run batcher restart. Classification: **code-bug**
  (design gap: batchId uniqueness assumes a fresh ledger per batcher lifetime).
  *Fix (chunk 6):* make batchIds unique per batcher process — e.g. bake a startup epoch into
  the id (`${scopeId}-${epochMs}-b${seq}`) or have sweep.py pass a per-cell `BATCH_EPOCH` env
  it already knows how to set. batchId is an opaque string at every consumer (receipt
  `rootRef.batchId`, chaincode composite key, verification query), so no contract shape
  changes — confirm CONTRACTS §5's example format is illustrative, not normative.

- **F45 · Every rest-mode Caliper round aborts on its first transaction:
  `TxStatus.SetTimeFinal` does not exist in Caliper 0.6.0.**
  `benchmark/connectors/rest/index.js:64`: `status.SetTimeFinal(Date.now());` — but the
  installed `caliper-core/lib/common/core/transaction-status.js` (0.6.0) defines **no
  `SetTimeFinal` method**; `time_final` is set only inside `SetStatusSuccess(time)` (:76-79)
  and `SetStatusFail()` (:109-112). Line 64 sits **after** the connector's try/catch (which
  wraps only the fetch, index.js:57-63), so every `_sendSingleRequest` call throws
  `TypeError: status.SetTimeFinal is not a function`. `ConnectorBase.sendRequests`
  (installed connector-base.js:82-96) catches it, marks the tx failed, and **re-throws** —
  "re-throwing an error allows for the worker to exit doing further work" — i.e. the worker
  abandons the round. All rest-mode benchmarks (anchoring, parallel-anchored, verify rounds)
  are dead on arrival; unit checks missed it because `node --check` only parses syntax and no
  Caliper run has executed (HANDOFF §9.6 said exactly this — and itself named `SetTimeFinal`
  as the API to check, the same phantom method). Classification: **code-bug**.
  *Fix (chunk 6):* delete index.js:64 — `SetStatusSuccess()`/`SetStatusFail()` already stamp
  `time_final` at response time, so timing semantics are preserved (create at :48 before the
  HTTP call, final on completion). One line.
  *Root-cause note:* `docs/research/caliper-0.6.0.md` Q5 (:342-347) is **correct** (uses only
  `SetStatusSuccess/SetStatusFail`); the phantom API was introduced in the connector
  implementation, then echoed into HANDOFF §9.6's checklist. The digest is exonerated.

### Bug

- **F46 · `up.sh --variant parallel|parallel-anchored --channels N>1` aborts at the second
  channel: duplicate chaincode install is unguarded.** `deploy_app_chaincode` runs once per
  channel (up.sh:124-130) and re-installs the identical package on both orgs each time
  (up.sh:72-75) with **no failure guard**, under `set -euo pipefail` (up.sh:12). Chaincode
  install is org-scoped, not channel-scoped, so the second call is a duplicate — and the
  author demonstrably knows duplicate installs exit non-zero, because the *same operation* in
  `orchestration/provision-channel.sh:26,28` carries `|| true`. First channel succeeds; second
  channel's install error kills bring-up. The benchmark path is unaffected (sweep.py provisions
  via the guarded provision-channel.sh), so this bites only the documented
  `up.sh --channels N` flow. Classification: **code-bug** (with a needs-live-run caveat on the
  exact peer CLI exit behavior in 2.5.15 — the `|| true` in the sibling script is the repo's
  own evidence). *Fix (chunk 6):* hoist the two installs out of the per-channel loop (install
  once per org before looping), which is also faster; or mirror the `|| true`.

- **F47 · Re-running enrollment over an existing crypto tree can silently pair a NEW cert
  with an OLD private key.** `network/crypto/registerEnroll.sh:59-63`
  (`normalize_client_key`): `key="$(ls "${msp}/keystore/" | head -1)"; cp … priv_sk`.
  Fabric CA re-enrollment (header comment :16 — "re-enrolling overwrites") overwrites
  `signcerts/cert.pem` but **adds** a second hash-named key beside the old one (and the stale
  `priv_sk`); hex names always sort before `priv_sk`, and `ls | head -1` picks the
  alphabetically-first hex key — 50/50 the old one → Caliper/anchor-client sign with a key
  that no longer matches the cert, failing with opaque auth errors. `up.sh` re-runs enrollment
  by default (no `--skip-crypto`, up.sh:45-51), so a second `up.sh` on a live tree is the
  trigger. Fresh runs are correct (exactly one key in a new keystore). Classification:
  **code-bug** (operational footgun). *Fix (chunk 6):* in `normalize_client_key`, take the
  newest real key and drop the stale copy: `rm -f priv_sk` first, then
  `ls -t … | grep -v priv_sk | head -1`; or wipe the identity's msp dir before enroll.

- **F48 · collect.py records every round twice.** Installed
  `caliper-core/lib/manager/report/report.js`: each round is printed once in its own table
  (`Logger.info('### Test result ###')` + `printTable`, :198-200) **and** pushed into
  `resultsByRound` (:195), which is re-printed at the end as the `### All test results ###`
  table (:177-183) — same label, same numbers. `orchestration/collect.py:57-88` parses
  **every** `|`-delimited 8-cell row in the tee'd log with no table anchoring, so
  `manifest.rounds` contains each round **twice** (identical duplicate dicts). Averages per
  label survive; anything that counts or sums rounds (repetition accounting, the byte-per-log
  regression inputs, paper tables) double-counts. Classification: **code-bug**.
  *Fix (chunk 6):* parse only lines after the **last** `### All test results ###` marker
  (one-line anchor), or dedupe identical (label,succ,fail,…) tuples.

- **F49 · Demo Verify button: F33 confirmed at the exact hop, PLUS the badge hangs at
  "Merkle: …" forever on failure — and the chunk-6 fix design (frontend-only).**
  Mechanics: `frontend/src/api.ts:160-162` sends `GET /evidence/:id/verify` with **no
  `?eventId=`**; the gateway falls back to the path id (`req.query.eventId || req.params.id`,
  gateway/src/app.js:136) → verification receives an *evidenceId* → receipt-store 404 →
  `missing-receipt`. In `frontend/src/demo.tsx:160-166`, `doVerify` sets `setVerify('pending')`
  and the thrown `GatewayError` is swallowed by `run()` (:11-19), whose message renders in the
  *left column's* Load card (:176) — so the badge (:129-140) sticks at `Merkle: …` with no
  recovery path. Classification: **code-bug** (demo call-site; service verified correct).
  **Fix design (chunk 6), constraints honored (frontend→gateway only; verification service,
  chaincode, and route list unchanged — the gateway route already accepts `?eventId=`):**
  1. `api.ts`: `verifyEvidence(id, eventId)` → append `?eventId=${encodeURIComponent(eventId)}`.
  2. **eventId source — write responses, which carry `eventId` in EVERY variant**
     (`gateway/src/variantRouter.js:50` batched `{batched:true, eventId, batchId, leafIndex}`;
     `:54` direct `{txId, evidenceId, eventId}`). `demo.tsx` keeps a per-evidence session log:
     an `onEvent({eventId, op, ts})` callback threaded into `CreateEvidenceForm` /
     `TransferCustodyForm` / `AccessLogForm` (which today discard responses, demo.tsx:64,82),
     appended to component state.
  3. UI: render the captured session events as rows with per-row **Verify** buttons (this list
     is also the natural stand-in trail for batched variants where the on-chain trail is empty
     — see F50); header badge shows the latest result. Button hidden/disabled outside
     anchoring/parallel-anchored (already the case, demo.tsx:186).
  4. Badge states — critical: **pending-vs-tamper must not be conflated.** 404
     `missing-receipt` (batch not yet closed: receipts are only PUT at the boundary,
     batcher index.js:141-146) and 404 `missing-anchor-root` (root not yet/never committed)
     render as "pending / not yet anchored"; only HTTP 200 `ok:false` `root-mismatch`
     (verification index.js:111-113) renders red as MISMATCH; error paths reset the badge
     instead of freezing it. Demo note: with default N=100 a demo batch may never close —
     document "run demos with small BATCH_N" in the frontend README (batcher `/flush` is not
     reachable through the gateway, and adding a proxy route would change the §6 contract —
     not proposed).
  Files touched: `frontend/src/api.ts`, `frontend/src/demo.tsx`, `frontend/src/types.ts`
  (VerifyResult.reason enum), frontend README. No gateway/service/chaincode changes.

### Note

- **F50 · F41 classified: working-as-intended at the service layer; a demo/paper expectation
  gap needing an author decision.** Reads always evaluate on-chain in every variant
  (`variantRouter.js:58-61` — deliberate §9 invariance), and in batched variants the CoC
  writes never reach the chaincode, so `getEvidence` 404s and the trail is empty: the demo
  renders "No evidence loaded." / "No audit events." (demo.tsx:91,112) for
  anchoring/parallel-anchored. CLAUDE.md's frontend scope promises a "per-evidence audit trail
  with Merkle verification status" — which is only meaningful in exactly the two variants
  where the trail is empty. Recommendation: (a) document as a stated caveat (reads are not
  part of the measured surface; the ledger holds roots, not events, by design), and (b) the
  F49 session-event list doubles as an honest client-side trail ("events this session,
  off-chain view") without any contract change. Author decides in chunk 6.

- **F51 · F40 closed: the scope round-trip is CONSISTENT in both variants — the silent
  `"shared"` default is real but round-trips correctly. Full quote chain:**
  *Anchoring:* batcher derives `scopeId = 'shared'` (`index.js:232`), receipts carry
  `rootRef:{scopeId:'shared', batchId, txId}` (:125), root submit body is
  `{batchId, merkleRoot, meta:{scopeId, leafCount}}` (:105-109 — no `caseId` key); gateway
  passes meta through verbatim (`app.js:143-147`); chaincode unmarshals only
  `caseId`/`leafCount` (`model.go:119-122`), `CaseID` stays empty → `scopeID = defaultScopeID`
  ("shared", `contract.go:141-144`); verification queries
  `/internal/anchor-root/shared/<batchId>` from the receipt's rootRef
  (verification `index.js:94-95,51-57`) → `ReadAnchorRoot("shared", batchId)` (app.js:150-153)
  → same composite key. *Parallel-anchored:* batcher `scopeId = event.caseId` (:232), submit
  body `{caseId: scopeId, batchId, merkleRoot, meta:{leafCount}}` (:90-95); anchor-client
  injects caseId authoritatively — `JSON.stringify({ ...metaObj, caseId })`
  (anchor-client `index.js:97-98`) → chaincode `scopeID = meta.CaseID = case-NNN`; verification
  reads anchor-client `/roots/<caseId>/<batchId>` (:43-49) → `ReadAnchorRoot(caseId, batchId)`
  (anchor-client :111). Field spellings verified end-to-end: `merkleRoot` (model.go:110 ↔
  both readers fold `.merkleRoot`), `leafCount`, `batchId` — all strings/ints round-trip; URL
  encoding safe for `shared`/`case-NNN`. Auth on every hop consistent (verification→gateway
  bearer ✓, all other internal hops unauthed on both sides) — apart from known F23.
  Recommendation: keep the default but document it in CONTRACTS §3/§9 (or send an explicit
  `caseId:"shared"` from the batcher's anchoring path — semantically identical; author call).

- **F52 ·** `up.sh:55` (`compose … up -d`) starts **all** base-profile services — including
  `ccaas-evidence` with `CHAINCODE_ID=${CCAAS_ID_APP:-unset}` (compose-net.yaml:271) before
  any package id exists, and gateway/frontend before channels exist. Benign by design
  (the ccaas server is recreated with the resolved id at up.sh:78 *before*
  approve/commit/first-invoke; compose detects the .env change), but expect crash-loop noise
  from the placeholder-id ccaas at bring-up. **Chunk-7 watch item**, alongside F35.

- **F53 ·** collect.py minor edges (all needs-live-run to calibrate, none blocking):
  degenerate rounds print `N/A`/`-` cells → `int()/float()` throws → row silently skipped
  (an all-failed round still parses: Succ/Fail stay numeric, latencies `-` → `_num`→None ✓);
  a zero-duration round yields `Infinity` TPS which Python accepts as `float('inf')`;
  `count_mvcc` greps the whole log so one conflict logged at multiple levels overcounts —
  calibrate the failure-class denominator on the first live run.

## Clean checks (lead-verified, condensed)

- **Item 1:** complete both-variant scope/batchId/root round-trip (F51 quote chain); receipt
  re-PUT after commit preserves `rootRef` verbatim, adding only `txId`
  (batcher index.js:164-167); duplicate-eventId 409 per open batch (:237-239); partial-batch
  `/flush` closes per-scope queues deterministically via the inflight set (:249-254).
- **Item 2:** `calculatepackageid` capture is clean — package_ccaas's stdout is exactly the
  id line (peer CLI logs → stderr; tars/printfs silent; `tail -1 | tr -d '\r'` defensive,
  lib.sh:109-118); the same captured `pkgid` feeds `.env`, approve `--package-id`, and the
  ccaas restart; `set_env_var` (lib.sh:121-128) and sweep.py's `set_env_var` (:48-62) both
  do line-replace-or-append — no clobbering between `CCAAS_ID_*`, `BATCH_N/K`, `VARIANT`;
  compose interpolates `.env` from `--project-directory network/compose` on every invocation;
  ccaas address contract holds end-to-end: connection.json `ccaas-evidence:9999` (lib.sh:113)
  ↔ compose hostname + `CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999` (compose-net.yaml:264-271) ↔
  `main.go:22-23` reads `CHAINCODE_ID`/`CHAINCODE_SERVER_ADDRESS`; anchor lane symmetric
  (`ccaas-evidence-anchor`, `CCAAS_ID_ANCHOR`, up.sh:95-114); ordering correct: package →
  install → recreate-with-id → approve → commit (server live with the right id before any
  endorsement); provision-channel.sh idempotency guard (osnadmin channel list, :16-17) makes
  sweep.py's repeated `ensure_channels` safe.
- **Item 3:** fresh-run keystore chain correct: `fabric-ca-client enroll -M` produces
  `signcerts/cert.pem` + one hashed key; `normalize_client_key` runs for exactly the client
  identities anything references (User1@org1/org2 :141, anchorclient :149);
  `benchmark/networks/coc-main.yaml:22,24` paths (`msp/keystore/priv_sk`,
  `msp/signcerts/cert.pem`, `../network/…` workspace-relative with Caliper cwd=benchmark/)
  resolve; compose identity paths (gateway `User1@org1…/msp`, anchor-client
  `anchorclient@anchor…/msp`, compose-services.yaml:28-29,106-107) match the enrollment tree;
  connection profile peer URL `grpcs://localhost:7051` + TLS CA path correct for host-side
  Caliper; NodeOUs config.yaml written into every MSP incl. clients; TLS material normalized
  to ca.crt/server.crt/server.key; org-level MSPs get cacerts+tlscacerts (configtx-ready);
  registration types (peer/admin/client) line up with the endorsement policies
  (`OR('Org1MSP.peer','Org2MSP.peer')`, `AND('AnchorClientMSP.member')`).
- **Item 4 (vs installed 0.6.0 source):** connector loading verified —
  `caliper.blockchain: ./connectors/rest/index.js` → `loadModuleFunction` treats `./` as an
  external module resolved via `resolvePath` (caliper-utils.js:145-161), factory name
  `ConnectorFactory` (constants.js:40) loaded at launchManager.js:58 / launchWorker.js:71 —
  our exports match (index.js:69-75, incl. the `workerIndex === -1` manager case);
  `ConnectorBase.sendRequests` handles submit/finish events itself — subclass only implements
  `_sendSingleRequest` ✓; `TxStatus` created before the HTTP call → latency spans the full
  round trip ✓; stats gate on `IsCommitted()` only — **no `IsVerified()` requirement in
  0.6.0** (transaction-statistics-collector.js:94), so the missing `SetVerification(true)` on
  the success path is harmless; report math reads exactly the getters the collector provides
  (report.js:153-172). **Research digests spot-verified accurate:** binding aliases
  `fabric:2.4/2.5/3/fabric-gateway` → `@hyperledger/fabric-gateway@1.5.0` confirmed in the
  installed caliper-cli (lib/lib/config.yaml:49-53) matching caliper-0.6.0.md Q1; Q5's
  connector contract and code sample correct; report-columns row (:444) byte-matches
  report.js:137; the issue-#1418 numerator caveat (:445) matches report.js:168 — collect.py's
  successful-only policy is soundly derived. fabric-2.5.md's calculatepackageid-before-install
  claim (:151-153) corroborated by the working up.sh flow.
- **Item 5:** table rendering verified from installed source: `table.getBorderCharacters('ramac')`
  is pure ASCII (`|`, `-`, `+` — table/dist/getBorderCharacters.js:79-100), the table is
  logged as ONE `Logger.info('\n' + t)` message (report.js:126) so interior lines carry no
  logger prefix and no ANSI codes (colorizer wraps the whole message; codes land before the
  first newline / after the bottom `+…+` border, never on data rows); separator rows are
  caught by the `set(name) <= set("-+ ")` guard and border rows don't start with `|`;
  sweep.py captures stdout+stderr merged (`stderr=subprocess.STDOUT`, sweep.py:90) so the
  table is guaranteed present in caliper.log; the successful-only math
  `throughput × succ/total` guards `total==0` (collect.py:77-78); `configShas` covers six
  files that all exist at the cited repo paths.
- **Item 6:** gateway verify route already accepts `?eventId=` (app.js:135-136 — no gateway
  change needed for the fix); write responses expose `eventId` in all four variants
  (variantRouter.js:50,54); `MerkleBadge` already has na/pending states to extend
  (demo.tsx:129-140).

## Ops note

The 5-agent single-phase fan-out (effort=high, file-scoped briefs) consumed 347k tokens and
returned **zero** results — all five hit the session limit mid-flight, and since no agent
completed, nothing was resumable from the journal. That is now three chunks (1, 3, 4) where
fan-out died and inline lead verification delivered the chunk. **Recommendation for chunks
5a/5b/6/7: do not fan out at all in this Pro window** — chunk 5a/5b already route through the
/code-review skill (its own mechanism); chunk 6 fixes should be applied by the lead directly
(they are small and surgical); chunk 7 is inherently sequential. If a future chunk truly
needs agents, cap at 2 sequential agents with narrow briefs.

## Handoff

- **Chunk 6 fix list additions (from this chunk):** F44 (blocker — epoch-unique batchIds;
  design with F23/F24 since all three touch the anchoring pipeline), F45 (blocker — delete
  the one `SetTimeFinal` line), F46 (hoist installs out of the per-channel loop), F47
  (normalize_client_key newest-key + rm priv_sk), F48 (anchor collect.py on the last
  `### All test results ###` marker), F49 (verify-button design above — needs F33's author
  sign-off on UI shape), F50 (author decision: caveat text ± session-trail), F51 (document
  the shared-scope default in CONTRACTS).
- **Chunk 7 watch items (adds to F35):** F52 (ccaas placeholder-id crash-loop noise before
  recreate), F46 caveat (confirm duplicate-install exit code on 2.5.15), F53 (calibrate
  MVCC overcount + N/A rows against a real caliper.log).
- **RQ2 viability:** after F23 + F44 + F45 fixes, the anchoring pipeline is
  statically-consistent end-to-end (F51 chain) — no other blocker is known on that path.
