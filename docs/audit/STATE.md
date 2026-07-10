# GLEIPNIR audit — cross-session state

Plan (binding, chunk definitions + facts every session needs):
`C:\Users\LENOVO\.claude\plans\okay-since-i-am-shimmering-squirrel.md`

Each session: read this file + the plan + HANDOFF.md (untracked!), execute exactly ONE chunk,
write `chunk-<N>-*.md`, update this checklist, stop. Findings are recorded, not fixed, until
chunk 6. Never `git clean` (HANDOFF.md and Pre-Thesis Paper.* are untracked). Never rewrite
git history.

## Checklist

- [x] **Chunk 1 — invariant/ban sweep + Merkle spec + paper cross-check** (2026-07-05):
      17/17 findings confirmed → `chunk-1-invariants.md`. 1 blocker (sweep.py drives one
      channel per Parallel cell, no aggregation), 5 bugs (committed ELF; verify-benchmark,
      receipt-store du, byte-per-log regression, smoke-regime shape all unwired), 5
      contract-drifts (incl. "system channel" in orderer.yaml comment; merkle.js files not
      byte-identical though semantically equal), 6 notes. Bans otherwise clean; all semantic
      invariants HOLD. Paper: 42 claims checked — 23 match, 7 mismatch, 4 not-implemented,
      8 paper-only. Paper text at `paper-extract.txt`.
      *Ops note: the workflow's verify fan-out (17 agents) hit the Pro session limit; findings
      were verified inline by the lead instead. Future chunks: keep verify stages lean
      (batch several findings per verifier agent).*
- [x] **Chunk 2 — module build/test re-verification** (2026-07-05): all 10 modules
      reproduce HANDOFF §2 exactly — 47/47 tests (Go 8, batcher 8, receipt-store 5,
      anchor-client 6, verification 8, gateway 12), frontend build + compose config
      (both profiles) + all syntax/yaml checks clean, caliper pin 0.6.0 confirmed,
      gen:rounds output byte-identical to committed YAMLs. In-container TLS canary for
      chunk 7 explicitly exercised and GREEN (git + cold go get with CA bundle). 0 new
      bugs; 5 notes F18–F22 → `chunk-2-tests.md` (F18: GnuTLS wget ignores
      SSL_CERT_FILE — chunk 7; F20: parallel/verify round YAMLs hand-maintained —
      chunk 3 must cross-check vs sweeps.yaml).
- [x] **Chunk 3 — cross-module contract audit** (2026-07-06): 5 tracers (36 raw
      findings, 169 clean checks) → deduped to 21, verified inline by lead (verify
      agents hit session limits twice) → `chunk-3-contracts.md`, F23–F43.
      **2 new blockers:** F23 batcher→gateway /internal/anchor-root has no bearer
      token → every Anchoring root commit 401s (RQ2 dead in live runs); F24
      steady-parallel-anchored.yaml hardcodes case-001 → K×channels sweep is a
      no-op (sibling of F6). 4 bugs (F25 head record nests codex vs §5-flat +
      frontend reads flat; F27 parallel round files only 50tps vs loads {25,50,100};
      F33 verify-button eventId gap confirmed = HANDOFF §9.5), 6 contract-drifts
      (§7 env list ×4, report.json vs caliper.log, manifest missing §10 fields,
      frontend healthz, §8 CA enumeration), 10 notes (F35 up.sh waits only orderer0
      ops → chunk 7). All 8 cc signatures + ports + volumes + routing matrix +
      sweeps.yaml constants otherwise verify clean end-to-end.
      *Ops: ~5-6 subagents per Pro window is the ceiling — single-phase workflows,
      verify inline.*
- [x] **Chunk 4 — known-gaps scrutiny** (2026-07-07): all 6 HANDOFF §9 items closed →
      `chunk-4-gaps.md`, F44–F53. **2 new blockers:** F44 batchIds restart at 0 on
      batcher recreate while the ledger persists → every anchoring/parallel-anchored
      sweep cell after the first fails all root commits AND yields false root-mismatch
      tamper signals (sibling of F23/F24); F45 rest connector calls nonexistent
      `TxStatus.SetTimeFinal` → TypeError kills every rest-mode round (fix = delete 1
      line; verified against the INSTALLED caliper-core 0.6.0, which also verified the
      research digests accurate). 4 bugs: F46 up.sh --channels>1 aborts (unguarded dup
      install), F47 re-enrollment key/cert mismatch (`ls | head -1`), F48 collect.py
      double-counts every round (per-round + final table both parsed), F49 verify
      button (F33) + badge stuck at pending; frontend-only fix design delivered.
      Item-1 round-trip: CONSISTENT both variants, full quote chain (F51); F41
      classified working-as-intended + demo/paper gap for author (F50). collect.py
      parser otherwise format-compatible with real 0.6.0 output (ramac ASCII, no ANSI
      on data rows). *Ops: 5-agent fan-out died on session limits with ZERO results
      (347k tokens); entire chunk executed inline by lead. Chunks 5-7: no fan-out.*
- [x] **Chunk 5a — /code-review core** (2026-07-07): 8 finder angles + verify, **fully
      inline (zero subagents, per chunk-4 directive)** over all 51 files/3,759 lines →
      `chunk-5a-review.md`, F54–F66. 0 blockers, **4 bugs**: F54 malformed receipt
      crashes the verification service (unguarded throw, Express 4 + Node 20 = process
      exit); F55 RQ2 latency excludes receipt body download/parse (fetchMs stamped
      before r.json() — fix REQUIRED before RQ2 data); F56 gateway+anchor-client
      firstFile() stale-key hazard survives F47's fix; F57 batched parallel-anchored
      writes skip CASE_RE → silent 'shared'-scope fallback. 1 contract-drift: F58
      Dockerfiles ignore committed lockfiles (npm install, not npm ci) ×5 services.
      8 notes F59–F66 (incl. F60 verification is receipt-based — receipt-swap verifies
      clean; thesis wording). Core otherwise clean: invariants/Merkle/determinism all
      re-verified at line level; no dupes of F1–F53 re-reported.
- [x] **Chunk 5b — /code-review periphery** (2026-07-07): benchmark + orchestration +
      network + frontend, **fully inline (zero subagents)** over 54 files (+ untracked
      case-template.yaml), ~5,100 lines → `chunk-5b-review.md`, F67–F71. **1 new blocker:**
      F67 `.gitignore:13` glob `case-*.yaml` swallows the SOURCE `case-template.yaml`
      (untracked) → provision-channel.sh (`set -e`) aborts on clean checkout → Parallel
      variant unprovisionable from the cited SHA (works only on author's tree; sibling of
      F1). **1 bug:** F68 CoC demo threads caseId only into Create — Load/Transfer/Access/
      Verify omit it → `parallel`-variant demo 400s on every read+direct-write (answers the
      5a watch item: frontend does NOT send caseId except on create); frontend-only fix WITH
      F49; secondary batched-create response omits evidenceId (variantRouter:50 vs :54).
      3 notes: F69 frontend Dockerfile `npm ci || npm install` fallback silently degrades
      reproducibility (resolves F58 frontend watch — frontend IS better than the 5 services),
      F70 checkpoint state-per-channel duplication + checkpoints.jsonl↔types.ts shape drift,
      F71 teardown-channel.sh unvalidated CASE_ID. **Two candidate findings REFUTED by live
      verification (not recalled):** `du -sb` works in fabric-peer:2.5.15 (GNU coreutils
      8.32, NOT BusyBox) → checkpoint.py storage portable; `js-yaml@^4.3.0` valid (4.3.0
      exists, lockfile pins it). Bans clean (only known F2/F3); GoLevelDB pinned everywhere;
      workload caseId threading correct; `/flush` exists (RQ2 dep). *Ops: inline fits one Pro
      window; run the check before writing any Fabric/npm/portability finding.*
- [x] **Chunk 6 — fix pass + consolidated REPORT.md** (2026-07-10): author approved all
      four bundles + F25=flatten chaincode + F5=unify byte-identical + commit artifacts.
      **All 6 blockers + all 17 bugs fixed** across 9 commits (`3b8366f`..`594d2f8`,
      one per module group; see REPORT.md table): F1/F67/F4 hygiene; F25/F62 chaincode
      (flat §5 head, 8/8 Go tests); F5/F23/F44/F54-F57/F66/F68b services+gateway
      (suites now 9/10/6/13 with new regression tests); F58/F69 npm ci ×7; F2/F3 +
      compose token/epoch; F45 + F6/F24 spread rounds + ALL round files generated from
      sweeps.yaml (F13/F20/F27/F38); F8/F9/F12/F30/F46/F47/F48/F70/F71 orchestration
      (collect.py verified vs synthetic fixture 13/13); F31/F33/F49/F68 frontend
      (build clean); CONTRACTS.md corrected (F26/F28/F29/F32/F34/F39/F42/F43/F51/F64).
      Deliberately NOT fixed: F35 (chunk-7 watch), F59/F61/F63/F65/F26-code
      (author-optional), paper-side F7/F10/F11/F14-F17/F50/F60 (listed in REPORT.md).
      ELF blob stays in history (no rewrite). → `REPORT.md` (go/no-go: **GO for
      chunk 7**; benchmarks GO after chunk 7 green, exact command order inside).
- [x] **Chunk 7 — live E2E run** (2026-07-10): **GREEN** — `up.sh --variant standard`
      exit 0 (fresh tree, ~80 s), smoke PASS 6/6, `down.sh --wipe` clean →
      `chunk-7-live-e2e.md`, F72–F73 (both found live, both FIXED this chunk):
      **F72** registerEnroll `cp -r` into the CA-admin-created `msp/cacerts` nests
      `cacerts/cacerts` → two `ls` entries → newline inside every NodeOU config.yaml →
      peers fail YAML parse, orderers panic loadLocalMSP (flat-copy fix, both org
      functions); **F73** package_ccaas wrote to `channel-artifacts/` before any
      `mkdir` — the F46 install hoist moved packaging ahead of create_channel's mkdir
      (mkdir now in package_ccaas). Watch list: F35 did NOT bite (3×201 first try),
      F52 NO crash-loop (placeholder quiet, RestartCount=0), F46 install ran once per
      org, nginx+gateway /healthz 200, early gateway start harmless (lazy connect).
      Environment established for all future runs (see chunk-7-live-e2e.md §Env):
      Ubuntu-22.04 WSL orchestration host (fabric-ca-client 1.5.19 extracted from the
      pinned CA image, jq, proxy CA trusted), Docker Desktop WSL integration (BOM-less
      settings-store.json!), images pre-built with build-time CA injection
      (`chunk-7-build-images.sh` — re-run only if the engine image store resets).
      **First benchmark: GO** per REPORT.md order; carry-forward watch: F23 token,
      F44 epoch, F53 calibration, spread rounds, F67 clean-tree case-001.
