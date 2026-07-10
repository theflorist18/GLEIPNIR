# Chunk 1 — Static invariant/ban sweep + Merkle spec + paper cross-check

**Date:** 2026-07-05 · **Method:** 3 parallel finder agents (bans/hygiene, semantic invariants,
paper-vs-code) → adversarial verification. Workflow verifier agents were killed by a Pro
session-limit reset mid-run; every finding was instead **re-verified inline by the lead agent**
(each cited file:line re-read, both sides of every mismatch quoted). Verification status below
reflects that inline pass: **17/17 CONFIRMED**.

**Paper text extracted to** `docs/audit/paper-extract.txt` (from `Pre-Thesis Paper.docx`;
paper line numbers below refer to that file). The paper (Jun 12) predates the code, so for
paper-vs-code drift the "proposed fix" states **which side should move**.

---

## Verdict summary

- **Terminology bans: essentially clean.** One literal violation in an enforced surface
  (YAML comment), one borderline README prose hit. No CouchDB, no lockb0x code/deps, no
  ZK/Poseidon/rollup-sequencer/OpenTimestamps/CASE/UCO anywhere in source.
- **Semantic invariants: all hold.** AccessLog never touches the head key; no MVCC retry
  loops; receipt-store correctly un-hardened; binaries hashed-and-discarded; Merkle semantics
  correct with normative vectors pinned in both services; chaincode deterministic.
- **One structural contract question:** the two `merkle.js` files are semantically identical
  but not literally byte-identical, while CONTRACTS §4 says "MUST be byte-identical" (F5).
- **The real risk cluster is the measurement harness vs the paper's promises** (F6–F13):
  the paper promises multi-channel load distribution + aggregate throughput (blocker),
  receipt-store size measurement, byte-per-log regression, and a smoke-regime shape that the
  code doesn't implement; conversely the code implements verification latency end-to-end but
  the paper's metric table omits it.

## Findings (all CONFIRMED; fixes deferred to Chunk 6)

### Blocker

- **F6 · `orchestration/sweep.py:139` — Parallel variants drive ONE channel per cell; no aggregation anywhere.**
  Paper line 130: "Offered load is distributed across the channels, and throughput is reported
  both per channel and aggregated"; Table 3 line 158 repeats it. Code:
  `netcfg = f"networks/case-{cell.get('channels', 1):03d}.yaml"  # first case as representative`
  → one Caliper run against one single-channel config (and the comment says "first case" while
  the expression selects `case-<channelCount>`, e.g. channels=5 → case-005);
  `benchmark/benchmarks/steady-parallel-anchored.yaml` hard-codes `caseId: case-001`;
  `collect.py` has no cross-channel aggregation. **RQ1/RQ2 channel-scaling answers are
  impossible without this.** Fix: **code moves** — drive all provisioned case channels
  concurrently (workloads already accept `roundArguments.channel/caseId`) and add per-channel +
  summed throughput to collect.py; also fix the comment/selection inconsistency.

### Bug

- **F1 · `chaincode/evidence/evidence` — committed 20,583,070-byte Linux ELF** (unstripped,
  debug_info; blob `bbd84d1`, tracked since 7febcd2) and not gitignored, so rebuilds will show
  as modified and can be re-committed. Fix: new commit `git rm --cached` + .gitignore entry
  (no history rewrite; blob stays in history — acceptable and noted).
- **F8 · `orchestration/sweep.py:30-35` — `steady-verify.yaml` never wired into the sweep.**
  `grep -i verify sweep.py` → zero matches; BENCH_CONFIG maps variants only to the four write
  benchconfigs. Verification latency (RQ2's numerator) is never collected per (N|K, repetition)
  cell. Fix: **code moves** — run the verify benchmark per anchoring/parallel-anchored cell.
- **F9 · `orchestration/checkpoint.py` — receipt-store size never measured.** Paper line 128:
  "its size is therefore measured and reported separately". `grep -i receipt checkpoint.py` →
  zero matches; probes cover only peer block stores + stateLeveldb. Fix: **code moves** — add a
  `du -sb /data` probe of the receipt-data volume (it's the cost side of the anchoring
  storage trade-off); else the paper sentence must be deleted.
- **F12 · `orchestration/collect.py` — byte-per-log regression + payload-compression
  computation not implemented anywhere.** Paper Table 3 line 171-173 and ARCHITECTURE §4.7
  `regress(runId)` promise it; `grep -ri "regress|byte.per.log" orchestration/*.py` → zero
  matches. Fix: **code moves** — regression over checkpoints.jsonl (slope bytes/event per
  channel) + compression-vs-Standard in payload bytes, before the results chapter.
- **F13 · `orchestration/sweep.py:120-122` — `--regime smoke` runs steady 1000-tx rounds under
  `smoke-*` runIds; `sweeps.yaml` regimes block has no consumer** (grep for
  `logs_per_case|min_events_per_channel` → only sweeps.yaml itself). Paper line 33 defines
  smoke as 10 cases × 10–25 logs. Labelling separation itself is clean. Fix: **code moves** —
  select smoke benchconfigs (or generate smoke rounds from `regimes.smoke`) when
  `--regime smoke`; or the paper re-describes the smoke test.

### Contract-drift

- **F2 · `network/orderer.yaml:8` — banned phrase "system channel" in a YAML comment** (an
  enforced surface; the thesis cites this file by SHA). Verified verbatim:
  `# the removed "system channel" neutralized to honor the terminology ban — no` — the
  neutralizing comment itself contains the phrase. Fix: reword (e.g. "the legacy bootstrap
  channel (removed in Fabric 3.0)").
- **F5 · `services/verification/src/merkle.js` vs `services/merkle-batcher/src/merkle.js` —
  not byte-identical**, though CONTRACTS §4's heading and both files' own headers demand it.
  Diff confirmed non-empty: differing comments; `buildTree`/`siblingPath` only in batcher;
  `computeRoot` only in verification. **Hash semantics are identical and both pin the
  normative V1/V2 vectors** (roots `015abd7f…f862`, `c859dbaf…6d2f`), so nothing is wrong
  today — but no mechanism (shared file/sync test) prevents silent divergence. Fix: author
  decision — (a) make files literally identical (superset), or (b) amend CONTRACTS §4 to
  "hash-behavior-identical, enforced by the shared normative vectors". Do not silently pick.
- **F7 · paper Table 3 (extract lines 150-174) — omits verification/audit latency entirely**,
  while CLAUDE.md mandates it as first-class for RQ2 and the code measures it
  (`services/verification` → `{ok,latencyMs,steps}`; `steady-verify.yaml`). Fix: **paper
  moves** — add the metric row + RQ2 reference.
- **F10 · paper line 128 — "The receipt-and-index layer follows … the redundancy idea"
  (RollStore [12])** contradicts the un-hardened invariant and the shipped code
  (`receipt-store/src/index.js:7-17`: "NO hash chains, NO signatures, NO replication").
  Nuance: the same paper paragraph states the availability caveat correctly — this is a
  wording over-claim. Fix: **paper moves** — "cited as the known mitigation, deliberately NOT
  implemented so the weaker guarantee remains a measured property."
- **F11 · paper Table 3 lines 159-161 — Latency defined as "submit-to-commit" for all
  variants**, but the Anchoring/Parallel-Anchored path is measured by the custom REST
  connector, which self-documents (`benchmark/connectors/rest/index.js:15-16`): "latency/
  throughput from this connector reflect the BFF path (enqueue or verify), NOT the raw
  peer-gateway path". Fix: **paper moves** — define latency per write path so cross-variant
  numbers aren't presented as the same quantity.

### Note

- **F3 · `network/README.md:26` — "No system channel."** Borderline: negative rule-statement
  in README prose (not in CLAUDE.md's enforced surface list, but not in HANDOFF's allowed
  list either). Fix: reword or add to the known-allowed list.
- **F4 · `.gitignore` — untracked `HANDOFF.md`, `Pre-Thesis Paper.*`, `docs/audit/` are not
  ignored**, risking accidental commit of binary thesis drafts into a never-rewritten history.
  Fix: decide — ignore them or deliberately commit them (chunk 6 offers this).
- **F14 · paper line 124 — "endorsement policy is identical across all channels and variants"**
  contradicted by anchor-main's `AND('AnchorClientMSP.member')` (vs app channels'
  `OR('Org1MSP.peer','Org2MSP.peer')`) and by the paper's own line 132. Fix: **paper moves** —
  scope the claim to CoC app channels.
- **F15 · paper lines 32/122 — "two peer organisations"**, but Parallel-Anchored adds a third
  (AnchorClientMSP: peer0-anchor + ca-anchor, CONTRACTS §12.1). Fix: **paper moves** — state
  the base topology + the documented anchor-org extension and why (endorsement requires an
  endorsing peer in that MSP).
- **F16 · paper methodology — no mention of the repetition loop** (`sweeps.yaml repetitions: 3`,
  `sweep.py:132`), which CLAUDE.md requires for statistical validity. Grep of the extract for
  repetition/mean±spread language: nothing. Fix: **paper moves** — state repetitions and
  mean ± spread reporting.
- **F17 · paper line 132 — "records … the load the anchoring traffic places on the anchor
  channel"**, but no instrument measures anchor-main tx load (only its storage via
  peer0-anchor checkpoints). Fix: either derive analytically (roots/s = event rate ÷ K +
  block-store growth) and say so, or add a probe; wording must match what is done.

## Clean checks (verified OK — condensed)

**Bans:** "system channel" clean everywhere except F2/F3; `couchdb` zero hits in code/config
(core.yaml:684 `stateDatabase: goleveldb`; all three peers set
`CORE_LEDGER_STATE_STATEDATABASE=goleveldb`); `lockb0x` only as the allowed conceptual
attribution (frontend/src/demo.tsx:6-7 comment); poseidon/opentimestamps/zk/CASE/UCO/jsonld —
zero hits outside rule-quoting docs; `rollup` only as vite's bundler in a lockfile.
`.gitattributes` sane (LF-forced scripts, binary-marked images). Git history: exactly 7
linear commits, milestone-referenced, no merges; only one blob >1 MB (the F1 ELF). README.md
quickstart matches CONTRACTS §11 and the file tree; pinned-stack line matches CLAUDE.md.

**Semantic invariants (all hold, key cites):**
- AccessLog = a single `appendEvent` call (contract.go:96-100); head key written only by
  Create/Transfer/Remove; even "reject if removed" head-reads are documented as forbidden
  (contract.go:89-93). sortKey = `zeroPad19(tsNanos)+"-"+txID[:12]` from the signed proposal
  (keys.go:43-50) — matches CONTRACTS §3 verbatim.
- No transaction-submit retry anywhere (gateway/src/fabric.js:74-83 submits once, throws
  COMMIT_FAILED; anchor-client returns 502 on failure). The batcher's single receipt-PUT
  retry (merkle-batcher/src/index.js:64-81) is HTTP availability handling, not tx resubmission.
- receipt-store (index.js, 89 lines): bare writeFile/readFile per eventId; only guard is a
  path-traversal charset check — input sanitation, not hardening. Un-hardened as required.
- Binaries: ni.js hashes → `ni:///sha-256;…`, bytes dropped in scope (app.js:22-27
  "bytes discarded here"); events/receipts carry hashes only; batcher state is in-memory.
- Merkle: SHA-256 only; interior hash over hex-DECODED concatenated bytes; odd node PROMOTED;
  single-leaf root == leaf; sibling `pos` = sibling's side, fold `pos=="L" ? H(sib||cur) :
  H(cur||sib)` — both services; both test suites pin V1+V2+parent+sibling-path vectors
  matching CONTRACTS §4 exactly.
- Determinism: zero `time.Now` in chaincode; all timestamps from `GetTxTimestamp`; Detail maps
  serialized via json.Marshal (sorted keys); GetAuditTrail preserves iterator order, no maps.

**Paper claims fully cross-checked:** 42 claims inventoried → **23 match, 7 mismatch,
4 not-implemented, 8 paper-only** (prose/thesis-chapter scope). All mismatch/not-implemented
items are captured as F6–F17. Notable matches: pinned stack (Table 1 == .env/Dockerfiles/
package.json exactly), sweep constants (Table 2 == sweeps.yaml), variant-invariance of
chaincode/API/workloads, channel-participation-only provisioning, MVCC structural design,
config-SHA reproducibility (collect.py stamps gitCommit + per-file blob SHAs), deferred-scope
self-restraint (paper itself withholds CASE/UCO and public-chain anchoring claims).

## Handoff to next chunks

- **Chunk 2** (build/test re-run): start Docker Desktop first; use `go vet && go test`, never
  bare `go build` (avoids regenerating the F1 ELF into the working tree).
- **Chunk 5a/5b** (/code-review): exclude `chaincode/evidence/evidence` from the diff.
- **Chunk 6** (fixes): F1 removal + .gitignore are mandatory items; F5 needs an author
  decision (contract wording vs file unification); F6/F8/F9/F12/F13 are code-side; F7/F10/F11/
  F14/F15/F16 are paper-side edits (thesis doc, not repo).
