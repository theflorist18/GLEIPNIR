# GLEIPNIR audit — consolidated report (chunks 1–6)

Date: 2026-07-10 · Fix pass executed inline with author sign-off on all four fix
bundles, F25 = flatten chaincode, F5 = unify byte-identical, commits incl. audit
artifacts. Full findings detail lives in `chunk-1` … `chunk-5b` files beside this
report; this file is the roll-up and the go/no-go.

## Verdict

**71 findings (F1–F71): 6 blockers, 17 bugs, 12 contract-drifts, 36 notes.**
All 6 blockers and all 17 bugs are **fixed and committed**; the contract doc is
corrected to match verified reality; the remaining items are paper-side edits,
author-optional improvements, and live-run watch items (all listed below).

**Go for chunk 7** (live E2E) and — after chunk 7 is green — **go for a first
benchmark run**. No known static blocker remains on any of the four variant
pipelines, including the previously-dead RQ2 (anchoring) path.

## Fix commits (this pass; base was `0a8e33d`)

| Commit | Scope | Findings |
|---|---|---|
| `3b8366f` | git hygiene | F1 (ELF untracked + ignored + .dockerignore), F67 (case-template.yaml tracked; ignore narrowed to `case-[0-9]*.yaml`), F4 (paper drafts ignored) |
| `e28693f` | chaincode | F25 (flat §5 head via embedded CodexEntry + wire-shape test), F62 (ordering comments) |
| `c0046a3` | services + gateway | F5 (merkle.js byte-identical + equality tests), F23 (batcher bearer token), F44 (epoch-unique batchIds), F54 (malformed-receipt guard), F55 (fetchMs spans body+parse), F56 (priv_sk-first key loading), F57 (batched caseId validation), F66 (pathToFileURL), F68-secondary (batched evidenceId) |
| `bacddcb` | Docker images | F58 + F69 (npm ci + lockfile COPY ×7 images, no fallback) |
| `4557d2d` | network | F2/F3 (terminology), F23 (compose token), F44 (BATCH_EPOCH pass-through) |
| `6f46f2e` | benchmark | F45 (SetTimeFinal deleted), F6/F24 (multi-channel spread rounds + `channels` workload arg + parallel-c* network configs), F13/F20/F27/F38 (ALL round files generated from sweeps.yaml, incl. smoke + verify; load sweep restored for Parallel variants) |
| `8af1403` | orchestration | F8 (RQ2 verify runs per cell), F9 (receipt-store du), F12/F70 (storage deltas, bytes/event, `--baseline` compression, canonical checkpoints), F30 (manifest seeding), F44 (per-cell epoch), F46 (hoisted installs), F47 (newest-key normalize), F48 (marker-anchored parsing), F71 (teardown guard) |
| `77edb73` | frontend | F31 (nginx healthz), F33/F49 (eventId-keyed verify + session trail + honest badge states), F68 (caseId threading), F70 (Checkpoint type) |
| `594d2f8` | CONTRACTS.md | F26, F28, F29, F32, F34, F39, F42, F43, F51, F64 + F44/F57 documentation |

**F1 note (as required):** the 20.6 MB ELF blob remains in *history* (blob
`bbd84d1`, first tracked at `7febcd2`) — removing it would rewrite the SHAs the
thesis cites, which is forbidden. It is gone from HEAD, ignored, and excluded
from image build contexts.

## Verification of the fix pass

Every touched module re-ran its HANDOFF §8 test subset:

- Chaincode: `go vet && go test` in `golang:1.25.5` — **8/8** (incl. new flat-wire assertion).
- merkle-batcher **9/9**, verification **10/10**, anchor-client **6/6**, gateway
  **13/13** (each suite gained regression tests: merkle byte-equality ×2,
  malformed-receipt, batcher auth header + epoch batchIds, batched-caseId-400).
- Frontend `tsc --noEmit && vite build` — clean (known chunk-size warning).
- `docker compose config -q` — base + parallel-anchored profiles clean.
- `bash -n` ×7, `py_compile` ×3 — clean; `npm run gen:rounds` — 19 files, all parse.
- collect.py exercised against a synthetic caliper.log + checkpoints fixture —
  **13/13** checks (round dedupe, per-channel deltas, bytes/event, compression math,
  seeded-manifest merge).
- Portability facts verified live, not recalled: `du -sb` works in
  `node:20.19-alpine` (BusyBox build includes `-b`); earlier: GNU coreutils in
  `fabric-peer:2.5.15`.

## Fixed-by-design decisions (author-approved this pass)

- **F25**: chaincode moved — the stored head is now the flat §5 mapping. No ledger
  existed, so no migration.
- **F5**: code moved — one `merkle.js`, deployed byte-identically, equality-tested.
- **F6 measurement semantics**: multi-channel cells drive all channels concurrently
  in one round; Caliper's round number is the **aggregate**; per-channel is derived
  as aggregate/C (uniform round-robin by construction) and labelled as derived.
  *The paper should state this definition* (it currently just says "per channel and
  aggregated").

## Remaining — paper-side edits (repo cannot fix these; RQ chapter accuracy)

| ID | Paper change needed |
|---|---|
| F7 | Add verification/audit latency to Table 3 (it IS measured; RQ2 depends on it) |
| F10 | Reword: RollStore redundancy is *cited, deliberately not implemented* — the un-hardened witness is a measured property |
| F11 | Define latency per write path: fabric-mode = submit-to-commit; rest-mode = BFF enqueue path (the custom connector measures the gateway path) |
| F14 | Scope "identical endorsement policy" to CoC app channels (anchor-main differs by design) |
| F15 | State base topology = 2 orgs + the documented anchor-org extension |
| F16 | State the repetition loop (3×) and mean ± spread reporting |
| F17 | Anchor-channel load: either derive analytically (roots/s = rate÷K) or claim only storage |
| F60 | Metric wording: verification fetches the *receipt (witness)*, not the event; receipt-swap property belongs in the availability caveat |
| F50/F41 | State the batched-variant demo caveat: on-chain reads are empty by design; the SPA's session trail is the off-chain view |
| F62 | Where GetAuditTrail output is described: order is client proposal-timestamp order (single host ⇒ single clock) |
| F13 | Smoke regime now matches the paper's "10 cases × 10–25 logs" via `regimes.smoke`-generated configs — no paper change needed anymore, but re-check the sentence against `smoke-*.yaml` |

## Remaining — author-optional code items (deliberately NOT done; ask if wanted)

- **F59** — batcher PUTs receipts serially (2×N round-trips per batch) and leaves
  some response bodies unconsumed; bounded-concurrency + body draining would tighten
  the anchoring tail at N=250.
- **F61** — REMOVE events record no actor; `ctx.GetClientIdentity()` in `detail`
  would be deterministic and forensically material.
- **F63** — `CreateEvidence` doesn't require `entry.ID == evidenceId` (all current
  callers pass them equal).
- **F65** — no inter-service fetch timeouts (hang-not-fail during live debugging;
  adding budgets near the measured path must be done carefully).
- **F26-code** — optionally add `caseId` to the on-chain event record (doc now
  documents the two shapes instead).

## Chunk 7 watch list (live E2E)

- **F35**: up.sh health-waits only orderer0's ops port before the 3-orderer osnadmin
  join loop — slow orderer1/2 can fail bring-up (left unfixed by design; chunk 7
  observes first).
- **F52**: expect ccaas placeholder-id crash-loop noise before the resolved-id
  recreate.
- **F46 caveat**: confirm duplicate-install exit behavior on 2.5.15 is moot now that
  installs are hoisted (they run once).
- **F53**: calibrate collect.py MVCC counting + degenerate-round rows against a real
  caliper.log.
- **F18/F21/F22**: wget ignores SSL_CERT_FILE (use curl/git/go); gocache volume is
  warm; budget for Docker Desktop startup.
- **F67 regression check**: provision `case-001` from a clean tree
  (`git stash -u` or fresh clone) — the template is now tracked, so this must pass.
- **New code paths to watch live**: batcher auth (F23) against the real gateway
  token; BATCH_EPOCH flow through compose; multi-channel spread rounds against
  provisioned channels (`channels` arg ↔ `parallel-c*.yaml`); nginx healthz.

## Go / no-go

- **Chunk 7 (up.sh --variant standard + smoke): GO.** Standard-path fixes are
  committed and unit-verified; watch list above.
- **First benchmark run: GO after chunk 7 is green**, in this order:

```bash
# 1) bring-up + functional gate (chunk 7)
./orchestration/up.sh --variant standard
./orchestration/smoke-standard.sh
./orchestration/down.sh --wipe

# 2) smoke each remaining variant once (functional, cheap)
python orchestration/sweep.py --variant anchoring --regime smoke
python orchestration/sweep.py --variant parallel --regime smoke
python orchestration/sweep.py --variant parallel-anchored --regime smoke

# 3) steady-state, Standard first (it is the baseline for compression)
python orchestration/sweep.py --variant standard
python orchestration/sweep.py --variant anchoring
python orchestration/sweep.py --variant parallel
python orchestration/sweep.py --variant parallel-anchored

# 4) compression vs baseline (per anchoring run, after both manifests exist)
python orchestration/collect.py run-anchoring-N50-r0 --baseline run-standard-base-r0
```

Between variant sweeps: `./orchestration/down.sh --wipe` then fresh `up.sh`
(cells within one sweep intentionally share the network; variants must not).

## Chunk 7 result (2026-07-10) — GREEN

Step 1 above executed live: `up.sh --variant standard` exit 0 from a fresh
tree, smoke PASS 6/6, `down.sh --wipe` clean. Two live-only bugs found and
fixed (F72 registerEnroll nested-cacerts NodeOU corruption; F73 package_ccaas
missing channel-artifacts dir after the F46 hoist) — details, watch-list
observations (F35 didn't bite; F52 no crash-loop; F46 single install; healthz
200s) and the host-environment runbook are in `chunk-7-live-e2e.md`.
**Steps 2–4 are GO.** Prereq for any run on this machine: the compose images
must already exist (`chunk-7-build-images.sh`) — the MITM proxy breaks
in-build TLS if compose ever builds them itself.
