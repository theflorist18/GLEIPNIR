# Chunk 5b — /code-review: periphery (benchmark + orchestration + network + frontend)

Date: 2026-07-07 · Session: chunk 5b of the audit plan
(`C:\Users\LENOVO\.claude\plans\okay-since-i-am-shimmering-squirrel.md`)

**Method:** /code-review skill at **high** effort over the whole-codebase diff vs the
empty tree, scoped to `benchmark/`, `orchestration/`, `network/`, `frontend/`
(excluding `frontend/dist`, lockfiles, images — 54 tracked files + the *untracked*
`benchmark/networks/case-template.yaml`, ~5,100 lines). Per the chunk-4 ops directive,
**zero agent fan-out**: all finder angles (line-scan, cross-file tracer, reuse,
simplification, efficiency, altitude, CLAUDE.md conventions, ban re-sweep) and the
1-vote verification were executed inline by the lead, every cited line read first-hand.
`network/core.yaml` (777 l) and `orderer.yaml` (444 l) are verbatim 2.5.15 sampleconfig
already line-audited in chunks 1 & 3, so they were **ban-swept + invariant-checked**
(GoLevelDB pin, no CouchDB, "system channel") rather than re-read line-by-line.
Candidates were deduped against F1–F66 before verification (F6/F24/F27/F44/F45/F46/
F47/F48/F13/F30/F33/F49/F57/F41/F50 not re-reported). Findings are recorded, NOT fixed
(fix pass = chunk 6). Numbering continues from chunk 5a's F66.

**Two Fabric/npm facts were VERIFIED against the live toolchain, not recalled**
(CLAUDE.md rule 4) — both refuted a candidate finding:
- `du -sb` inside `hyperledger/fabric-peer:2.5.15` → **GNU coreutils 8.32** (150 KB
  binary, not BusyBox), exit 0, bytes captured. checkpoint.py's storage measurement is
  portable → **no finding** (the "alpine/BusyBox lacks -b" hypothesis was wrong).
- `js-yaml@^4.3.0` (benchmark/package.json) → 4.3.0 **exists** on the registry
  (4.0.0→4.3.0) and the committed lockfile pins it → **no finding**.

## Verdict summary

**1 new blocker, 1 bug, 3 notes (F67–F71).** The periphery is in good shape: the
Caliper workloads thread `caseId` correctly through every variant, the connector/network
configs match the 0.6.0 conventions chunk 3/4 established, the compose topology and
`configtx` profiles are internally consistent, bans are clean (only the known F2/F3), and
GoLevelDB is pinned in config **and** every peer env. The one **blocker (F67)** is a
`.gitignore` glob that swallows the Parallel variant's network-config *template* —
invisible on the author's machine, fatal on a clean checkout (the SHA the thesis cites).
The one **bug (F68)** answers this chunk's carried-forward watch item: the CoC **demo**
never threads `caseId` past the create form, so it cannot operate the `parallel` variant
at all (every read/direct-write 400s). The F58 frontend-Dockerfile watch item resolves
to a milder note (F69): the frontend *does* use the lockfile, unlike the five services.

## Findings

### Blocker

- **F67 · The Parallel variant's Caliper network-config TEMPLATE is git-ignored, so
  channel provisioning fails on any clean checkout of the cited SHA.**
  `.gitignore:13` — `benchmark/networks/case-*.yaml` — is meant to ignore the
  *generated* per-case configs (`case-001.yaml`, …) that `provision-channel.sh` emits,
  but the glob **also matches the hand-authored source `case-template.yaml`**
  (`git check-ignore` confirms; `git ls-files` shows it untracked; it exists only in the
  author's working tree). `provision-channel.sh:45-47` reads it under `set -euo pipefail`:
  `TEMPLATE=".../case-template.yaml"; sed "s/__CHANNEL__/${CASE_ID}/g" "${TEMPLATE}" > "${OUT}"`
  — a missing template makes `sed` exit non-zero and abort the script. `sweep.py:73-75`
  (`ensure_channels` → `provision-channel.sh`) drives this for `parallel`/`parallel-anchored`,
  and `sweep.py:138-139` then points Caliper at `networks/case-00N.yaml` which was never
  emitted → the round loads a non-existent network config. (`sweep.py`'s `run()` uses
  `check=False`, so the provisioning failure is *swallowed* and only surfaces as a Caliper
  network-config error — worse, not better.) On the author's machine the untracked file is
  present so everything works today; on a fresh clone / co-author / CI the Parallel variant
  cannot be provisioned. This is the exact reproducibility property the thesis stakes its
  credibility on (CLAUDE.md: configs cited by SHA). Sibling of F1 (the inverse git-hygiene
  bug: F1 commits a file that shouldn't be tracked; F67 ignores a file that must be).
  **Verdict: CONFIRMED** (`.gitignore` glob + `git check-ignore` + `set -e` semantics all
  read first-hand). *Fix (chunk 6):* narrow the ignore to
  `benchmark/networks/case-[0-9]*.yaml` (matches `case-001.yaml`, not `case-template.yaml`)
  and `git add benchmark/networks/case-template.yaml`. Scoped to the already-broken Parallel
  path (F6/F24) but an **independent, one-line** cause.

### Bug

- **F68 · The CoC demo threads `caseId` only into Create — Load/Transfer/Access/Verify
  omit it — so the demo cannot operate a gateway deployed in the `parallel` variant
  (every read + direct write 400s).** *(Answers the chunk-5a watch item: does the frontend
  send caseId in parallel variants? — No, except on create.)*
  `frontend/src/demo.tsx`: only `CreateEvidenceForm` has a `caseId` input and sends it
  (`:28,:36,:47`); `TransferCustodyForm` (`:64` → `client.transferCustody(id, {newCustodian,
  reason})`) and `AccessLogForm` (`:82` → `client.accessLog(id, {actor, action})`) send
  none, and `refresh()`'s `getEvidence`/`getAudit` (`:155`) and `verifyEvidence` (`:164`)
  send none. The `caseId` typed at create is **not retained** in demo state (only the
  evidenceId is). `frontend/src/types.ts` has no `caseId` on `TransferCustodyRequest`/
  `AccessLogRequest` (`:98-107`), and `api.ts` never adds a `?caseId=` query. Downstream,
  `gateway/src/variantRouter.js` `channelFor` (`:34-42`) throws **400** for parallel
  variants when `caseId` fails `CASE_RE`, and `routeRead` (`:58-61`) calls it on **every**
  read. `settings.tsx:5-6` confirms the SPA's variant selector is *display-only* — the real
  routing variant is the gateway's env `VARIANT`. So against `up.sh --variant parallel`
  (which writes genuine per-case on-chain evidence the demo is *designed* to show): create
  succeeds (201, returns evidenceId) → `onCreated` → `refresh(evidenceId)` → `getEvidence`
  **without caseId** → **400** immediately; Transfer/Access → **400**. The gateway already
  accepts `caseId` on the write body (`app.js:101,109`) and the read query
  (`app.js:124,129`), so the fix is **frontend-only** (design WITH F49): hold `caseId` in
  demo state, send it in the transfer/access bodies and as `?caseId=` on the reads, and add
  the field to the two request types. Secondary: the **batched** create response omits
  `evidenceId` — `routeWrite` batched branch returns `{batched, eventId, ...placement}`
  where `placement` = `{batchId, leafIndex}` (variantRouter.js:50; batcher `/events`
  index.js:244) vs the direct branch's `{txId, evidenceId, eventId}` (`:54`) — so
  `demo.tsx:38` `if (res.evidenceId) onCreated(...)` never fires on anchoring/parallel-
  anchored (independent of caseId). Benchmark data is **unaffected** (the Caliper workloads
  in `benchmark/workload/*.js` correctly thread `caseId` via `roundArguments` on create,
  transfer, and access — verified). Distinct from F57 (server-side `shared` default on the
  batched write path) and F33/F49 (verify `eventId` gap). **Verdict: CONFIRMED** (full
  demo→api→router→app trace read first-hand). *Fix (chunk 6):* frontend caseId threading
  as above; optionally add `evidenceId` to the batched `routeWrite` body for demo symmetry.

### Note

- **F69 ·** `frontend/Dockerfile:4-5` uses `COPY package.json package-lock.json* ./` +
  `RUN npm ci || npm install` — it *does* use the committed lockfile and prefer `npm ci`,
  making the frontend **better** than the five services in F58. But the `|| npm install`
  fallback means any lockfile/package.json drift (or the `package-lock.json*` glob matching
  nothing) **silently degrades to a fresh, non-reproducible resolve** instead of failing the
  build. The frontend is not on the measured SUT path (F58's concern was the gateway), so
  low stakes — but for a thesis that cites images by commit, a silent fallback is the wrong
  default. *(Resolves the F58 frontend-Dockerfile watch item.)* *Fix:* drop the fallback
  (`RUN npm ci`) now that the lockfile is committed, or keep it but `echo` a loud warning.
  Fold into the F58 chunk-6 Dockerfile pass. Cross-ref F58.

- **F70 ·** The storage-metric pipeline has a shape mismatch that will bite once it's wired.
  `checkpoint.py:73` computes `state_bytes` **once per container** (GoLevelDB is a single
  `stateLeveldb` dir shared by all channels — correct) but writes it onto **every**
  `(container, channel)` row, so a naïve per-channel sum double-counts world state. And the
  JSONL row shape `{runId,label,tsUtc,container,channel,blockstoreBytes,stateBytes}` does
  **not** match `frontend/src/types.ts` `Checkpoint` `{ledgerBytes:Record<ch,number>,
  stateBytes, events}` (`:148-155`) that `dashboard.tsx StorageChart` (`:135-149`) consumes
  — nothing reshapes `checkpoints.jsonl` → `manifest` → `RunDetail.checkpoints`. This is
  downstream of the already-recorded byte-per-log-unwired (chunk 1) and manifest-missing-§10
  (F30) gaps; recorded here as the concrete shape drift the chunk-6 wiring must reconcile.
  *Fix (with the byte-per-log wiring):* aggregate blockstore per channel, carry state once
  per peer, and settle on one Checkpoint schema across `checkpoint.py`/`collect.py`/`types.ts`.

- **F71 ·** `orchestration/teardown-channel.sh` does **not** validate its `CASE_ID` arg
  (`provision-channel.sh:11-13` enforces `^case-[0-9]{3}$`; teardown does not), and
  `:20` `rm -f "${REPO_ROOT}/benchmark/networks/${CASE_ID}.yaml"` would delete the
  (untracked, F67) `case-template.yaml` if misinvoked as `teardown-channel.sh case-template`.
  Minor hygiene; add the same `case-NNN` guard. Ties to F67 (once the template is committed,
  an accidental delete is at least recoverable via git).

## Clean checks (inline, condensed)

- **Bans/conventions (re-swept over all periphery):** "system channel" appears only at
  `orderer.yaml:8` (F2) and `network/README.md:26` (F3) — **both already recorded**; zero
  couchdb/lockb0x/zk/poseidon/rollup/OTS/CASE-UCO-jsonld. GoLevelDB pinned in
  `core.yaml:684` *and* the peer env (`compose-net.yaml:167,205,245`). Images pinned via
  `.env` (FABRIC 2.5.15 / CA 1.5.19 / TOOLS 2.5.15), never `:latest`. Caliper CLI pinned
  `0.6.0` exactly (benchmark/package.json).
- **Caliper wiring:** `contracts` (not `contractIds`) key in coc-main/case-template;
  `caliper.blockchain` = module path for the REST connector; bind string
  `fabric:fabric-gateway` documented (README). REST connector drains bodies
  (`resp.text().catch`) — no F59-style socket leak on this path. `/flush` (verify.js RQ2
  dependency) **exists** at batcher index.js:250. F45 (`SetTimeFinal`, connector `:64`)
  re-confirmed present, already recorded.
- **Workload caseId (the invariant this chunk watched):** create/transfer/access all thread
  `caseId` from `roundArguments` (createEvidence.js:29, transferCustody.js:42,
  accessLog.js:57; `payloads.js:35` conditional spread) — the **benchmark** path is correct;
  only the **demo** (F68) is not.
- **Orchestration:** `configtx` has both `AppChannel` + `AnchorChannel` profiles matching
  every `create_channel` call (lib.sh); osnadmin 3-orderer 201 assertion present;
  `du -sb` at the named-volume ledger paths **verified working** in the real peer image;
  ports/hosts/volumes cross-consistent across the three compose files and `lib.sh`.
- **Frontend:** talks only to `/api/v1` (api.ts is the sole network seam); nginx preserves
  the `/api` path (`proxy_pass` no trailing URI); charts read every metric defensively;
  `tsc --noEmit && vite build` gate. F33/F49 verify-button gap re-confirmed at
  api.ts:160-162 (no `?eventId`), already recorded.

## Ops note

Executed 100 % inline (zero subagents), per the chunk-4 directive — comfortable in one Pro
window. The two verified-not-recalled refutations (du/js-yaml) are the takeaway: on this
codebase, **run the check** before writing a Fabric/npm/portability finding.

## Handoff

- **Chunk 6 fix-list additions:** **F67** (`.gitignore` glob → `case-[0-9]*.yaml` +
  `git add case-template.yaml` — blocker, one-line, do WITH F1 git-hygiene), **F68**
  (frontend caseId threading on transfer/access/read + retain created caseId + add to the
  two request types; optional batched-response `evidenceId` — design WITH F49), **F69**
  (drop `|| npm install`, fold into F58 Dockerfile pass), **F70** (reconcile the Checkpoint
  schema when wiring byte-per-log), **F71** (case-NNN guard in teardown-channel.sh).
- **Chunk 7 watch items (carried):** F67 will surface as a Caliper "network config not
  found" for the Parallel variant if run from a fresh clone — but standard-variant smoke
  (chunk 7's target) does not touch `case-template`, so chunk 7 is unaffected; verify F67's
  fix by provisioning `case-001` from a `git stash -u`/clean tree. Plus the standing F35
  (orderer1/2 health waits), F46 (dup-install exit on `--channels>1`), F52 (ccaas
  placeholder-id noise), F53 (MVCC-count calibration).
