# Chunk 3 — Cross-module contract audit (docs/CONTRACTS.md end-to-end)

Date: 2026-07-06 · Session: chunk 3 of the audit plan
(`C:\Users\LENOVO\.claude\plans\okay-since-i-am-shimmering-squirrel.md`)

**Method:** 5 parallel tracer agents (ports/REST, channels/compose/volumes, chaincode
signatures/shapes, env vars, routing/benchmark/orchestration) → 36 raw findings +
169 clean checks. The adversarial-verify fan-out hit Pro session limits twice, so —
per the chunk-1 precedent — all findings were deduplicated (36 → 21) and **verified
inline by the lead**, re-reading both sides of every mismatch at the cited lines.
Substantive findings F23–F33 are all lead-verified; notes are lead-verified except
where marked *tracer-attested*. Findings are recorded, NOT fixed (fix pass = chunk 6).

## Verdict summary

**2 new blockers, 4 bugs, 6 contract-drifts, 10 notes (F23–F43).** The integration
surface is otherwise remarkably tight: all 8 chaincode signatures match every caller
(gateway, workloads, anchor-client) in name/arg-count/arg-order; the §1 port table, §7
env plumbing, §8 volumes/profiles, §9 routing matrix, and §11 orchestration entry
points check out end-to-end (169 clean checks, condensed below). The two blockers are
both "works in unit tests, dies on the live wire" defects — exactly what this chunk
existed to find.

## Findings (numbering continues from chunk 2's F22)

### Blocker

- **F23 · Anchoring-variant root commits always fail 401 — batcher sends no bearer
  token to the gateway's authed `/internal/anchor-root`.**
  `gateway/src/app.js:71-76` auths everything after `/healthz` (`if (token !== cfg.token)
  return res.status(401)...`), which includes `POST /internal/anchor-root`
  (app.js:143); gateway/README.md:25 says internal routes are "still bearer-authed".
  But the batcher's submit (`services/merkle-batcher/src/index.js:102-110`) sends only
  `headers: { 'content-type': 'application/json' }` — no Authorization. Compose gives
  the batcher no `GLEIPNIR_TOKEN` (`network/compose/compose-services.yaml:54-64`;
  verification *does* get it, line 91), and CONTRACTS §7:188-190 likewise lists no
  token for the batcher. Every Anchoring batch → `rootStatus:'failed'`; no root ever
  reaches the ledger; verification 404s; **RQ2 audit-latency is unmeasurable for the
  Anchoring variant in any live run**. Unit tests miss it because the batcher tests
  stub the gateway without auth. (Found independently by 3 tracers.)
  *Fix (chunk 6):* mirror verification — add `GLEIPNIR_TOKEN` to batcher compose env
  + CONTRACTS §7, send `authorization: Bearer ${cfg.token}` in submitRoot (as
  `services/verification/src/index.js:53` does). Parallel-anchored path is unaffected
  (anchor-client `/roots` is unauthed, consistently on both sides).

- **F24 · Parallel-Anchored channel sweep is a no-op — every cell drives only
  `case-001`.** `benchmark/benchmarks/steady-parallel-anchored.yaml:21,34` hardcodes
  `caseId: case-001` in both rounds, while its own header (line 4) claims "sweep.py
  sets caseId + K per cell". sweep.py does not: `orchestration/sweep.py:124-130` sets
  only `BATCH_N`/`BATCH_K` (via `.env` + batcher recreate) and provisions channels
  (`ensure_channels`), never touching workload caseId; the benchconfig path is the
  static YAML (sweep.py:34). So cells `K×channels∈{1,2,5}` provision 1/2/5 channels
  but write to one: the channels axis produces identical single-channel data labelled
  as multi-channel cells. Sibling of chunk-1 **F6** (same axis broken for Parallel via
  netcfg; this is the REST-path mechanism). *Fix (chunk 6, design with F6):* have
  sweep.py generate per-cell round files (or pass caseId per round) so K×channels
  cells actually spread load across the provisioned `case-*` channels.

### Bug

- **F25 · Evidence head record on-chain nests the Codex entry under a `"codex"` key;
  CONTRACTS §5 and the frontend expect the flat mapping.**
  `chaincode/evidence/model.go:86-90`: `EvidenceHead{ Codex CodexEntry \`json:"codex"\`;
  Custodian; Status }` → stored JSON is `{"codex":{id,version,storage,identity,...},
  "custodian","status"}`. CONTRACTS §5:144-146: the head record "**is** the
  Codex-Entry-inspired mapping … **plus** `custodian` and `status`" (flat); model.go's
  own header comment (lines 7-13, 82-84) claims it follows §5 exactly. The gateway
  passes chaincode bytes through verbatim (app.js:123-126), and the demo reads the
  flat shape — `frontend/src/demo.tsx:100-103`: `record.identity?.org`,
  `record.storage?.location`, `record.storage?.integrity_proof` — all `undefined`
  under the nested shape, so the evidence card renders "—" for org/storage/
  integrity_proof in a live run (custodian/status still work). Go tests pass because
  they round-trip the Go struct, not the contracted JSON. *Fix (chunk 6, needs author
  sign-off — stored-shape change):* flatten (embed CodexEntry) in chaincode to match
  §5 + frontend; the alternative (change §5 + frontend to nested) also works but
  §5 is the older commitment.

- **F27 · Offered-load axis collapses to a single 50 tps point for Parallel and
  Parallel-Anchored.** `sweeps.yaml offered_load_tps: [25,50,100]` (= CONTRACTS
  §10:231); generated `steady-standard.yaml`/`steady-anchoring.yaml` carry all three
  rates, but the hand-maintained `steady-parallel.yaml` (rounds at :17,:27) and
  `steady-parallel-anchored.yaml` (:16,:27) contain **only `tps: 50`** rounds. Two of
  four variants lose the load sweep entirely — the thesis's offered-load axis can't
  be compared like-for-like. Root cause is chunk-2 **F20** (gen:rounds covers only 2
  of 6 round files). *Fix (chunk 6):* extend `generate-rounds.js` to emit the parallel
  round files from sweeps.yaml too (also closes F20/F38).

- **F33 · Frontend Verify button confirmed broken (pre-known HANDOFF §9.5): passes
  evidenceId where the whole verify chain is keyed by eventId.**
  `frontend/src/api.ts:160-161`: `verifyEvidence(id)` → `GET /evidence/${id}/verify`
  with no `?eventId=`; `frontend/src/demo.tsx:164` calls it with the evidence id.
  Gateway (app.js:133-140) forwards `req.query.eventId || req.params.id` → the
  verification service gets an evidenceId, receipt-store lookup 404s →
  `missing-receipt`, always. The verification *service* is correct and tested; this is
  the demo call-site (UX gap, per HANDOFF's classification — but it makes the demo's
  Merkle badge permanently dead, so it is a fix-worthy bug). *Fix sketch for chunk 6
  (chunk 4 item 6 owns the final design):* `verifyEvidence(id, eventId)` appending
  `?eventId=`, wired to an eventId from the loaded audit trail (per-row verify or
  latest event).

### Contract-drift

- **F26 · On-chain event record shape ≠ §5 CoC event.** CONTRACTS §5:129-141 gives ONE
  event shape — `{eventId, evidenceId, caseId, op, actor, detail, ts}` ("assigned by
  gateway") — and says it "is written on-chain in Standard/Parallel; the Merkle leaf
  in Anchoring/Parallel-Anchored". In reality the on-chain record is chaincode-built
  (`model.go:96-103`): `{evidenceId, op, actor, detail?, txId, ts}` — **no eventId, no
  caseId, extra txId**, ts from `GetTxTimestamp` (the gateway-built evt-uuid event is
  used only on the batcher path). Determinism-wise the chaincode is right (it cannot
  accept a gateway wall-clock ts); the §5 text over-claims shape identity.
  Consequences: standard-variant audit-trail rows have no `eventId` (frontend list key
  demo.tsx:118; no verify linkage — moot in standard, which has no receipts) and no
  `caseId`. *Fix (chunk 6):* correct §5 to document both event shapes (on-chain vs
  leaf/receipt) — doc-side; optionally add caseId to appendEvent (code change, author
  call).

- **F28 · CONTRACTS §7 env table drifts from reality in 4 places** (§7 header says
  "exact names"). (a) **Verification is missing `GLEIPNIR_TOKEN`** — code requires it
  to read the authed gateway root endpoint (`services/verification/src/index.js:28,53`)
  and compose sets it (compose-services.yaml:91); found by 4 tracers. (b) **Gateway is
  missing `RESULTS_DIR`** — read at `gateway/src/index.js:15` (runs API store), set at
  compose-services.yaml:32 with the `../../benchmark/results:/results` bind
  (line 37). (c) "Shared: `LOG_LEVEL`" — set by **no** compose service; read only by
  batcher/receipt-store/verification (defaults 'info'); gateway and anchor-client
  never read it. (d) "Shared: `VARIANT`" — anchor-client and receipt-store neither
  read nor receive it. *Fix (chunk 6):* one §7 edit (add tokens/RESULTS_DIR, scope the
  Shared line).

- **F29 · §10/§11 promise `report.json`; the implementation produces `report.html` and
  parses `caliper.log`.** CONTRACTS §10:246 lists `report.json` among run artifacts;
  §11:264 says "`collect.py <runId>` — parse Caliper **report.json** → manifest
  metrics". Reality (deliberate, per HANDOFF §9.8): `sweep.py:81-87` tees stdout to
  `caliper.log` and passes `--caliper-report-path report.html`;
  `collect.py:5,47,112,120` parses `caliper.log`. Doc-side fix: update §10/§11 wording
  to caliper.log/report.html (or record the decision in §12).

- **F30 · Run manifest never gets the §10-required experiment-identity fields.**
  §10:247-252 schema requires `{runId, startedAt, variant, regime,
  cell:{N,K,channels,offeredLoadTps,repetition}, gitCommit, configShas,
  caliper:{binding,version}, notes}`. `collect.py:121-127` writes only `runId,
  collectedAt, gitCommit, configShas, rounds, failureClasses, throughputPolicy` —
  no startedAt/variant/regime/cell/caliper/notes; nothing else creates them
  (sweep.py encodes variant+cell only inside the runId string, e.g.
  `run-parallel-anchored-K5-channels2-r0`). Runs aren't machine-readably
  self-describing as contracted. *Fix (chunk 6):* sweep.py seeds manifest.json with
  the cell dict before Caliper; collect.py merges (it already `setdefault`s).

- **F31 · §6 "all expose `GET /healthz` → `{"ok":true}`" includes the frontend row,
  but nginx has no /healthz.** `frontend/nginx.conf` has only the `/api/` proxy
  (:17-25) and the SPA fallback `try_files … /index.html` (:28-30), so
  `GET /healthz` returns index.html (HTML 200) — a false-positive health signal.
  *Fix:* add an nginx `location = /healthz` returning `{"ok":true}`, or scope §6's
  claim to the five Node services.

- **F32 · §8's base-profile enumeration omits the three always-on CAs.** §8:203 lists
  base = "orderers, peers org1/org2, ccaas, cli, gateway, frontend", but
  `compose-ca.yaml` runs ca-org1/ca-org2/ca-orderer with **no** profile (always up in
  every variant; only ca-anchor is profiled, :62). Doc-side one-liner.

### Note

- **F34 ·** Gateway /healthz returns `{ok:true, variant}` vs §6's exact `{"ok":true}`
  (app.js:68). Benign superset; cosmetic.
- **F35 ·** `up.sh:58-61` health-waits only orderer0's ops port (9443) + peers;
  orderer1/orderer2 (9444/9445, published for this) are not waited before the
  3-orderer `osnadmin channel join` loop. Slow-start orderers → join failure at
  bring-up. **Chunk-7 watch item.**
- **F36 ·** `CORE_CHAINCODE_ID_NAME` on both ccaas services (compose-net.yaml:272,285)
  is dead config — the server reads only `CHAINCODE_ID` (main.go:22). Harmless.
- **F37 ·** `sweep.py:139` comment says "first case as representative" but the
  expression picks `case-{channels:03d}` — the **last** case. Comment-only today;
  wording dies with the F6/F24 redesign anyway.
- **F38 ·** `generate-rounds.js` hardcodes `txNumber 1000` instead of importing
  `regimes.steady.min_events_per_channel` from sweeps.yaml (values match today;
  single-source rule). Fold into the F27 gen:rounds extension.
- **F39 ·** §11 entry-point drift: `up.sh` accepts an undocumented `--skip-crypto`
  flag (*tracer-attested*); `smoke-standard.sh` is absent from the §11 list. Doc-side.
- **F40 ·** Anchoring root path sends `meta:{scopeId,leafCount}` — no `caseId` key —
  so the chaincode's `meta.caseId || "shared"` default fires (contract.go:141-144,
  batcher index.js:108). Outcome is correct and the round-trip is consistent
  (receipts carry `rootRef.scopeId:"shared"`; verification queries the same), but the
  correctness rests on a silent default. **Feeds chunk 4 item 1** (trace actual JSON
  bodies both variants).
- **F41 ·** In batched variants, CoC writes never reach the chaincode, so
  `GET /evidence/:id` 404s and the audit trail is empty on-chain — the CoC demo's
  read/trail views are effectively Standard/Parallel-only. Consequence of the §9
  matrix (reads always evaluate), not a defect per se; **chunk 4 should classify**
  (working-as-intended vs demo/paper expectation gap).
- **F42 ·** Fabric-mode workloads compute `storage.integrity_proof` client-side
  (Caliper bypasses the gateway), while §5 says the ni-URI is "computed by the
  gateway, never by chaincode". The invariant §5 protects (never chaincode) holds;
  §5's wording should say "by the client (gateway on the REST path)".
  (*tracer-attested*.)
- **F43 ·** Runtime Docker volume names carry the compose project prefix
  (`gleipnir_peer0org1-ledger` …) vs §8's bare names. checkpoint.py is unaffected
  (it `docker exec`s by container name and probes paths). Doc nuance only.
  (*tracer-attested*.)

**Observations (no action):** `mychannel` appears only in `docs/research/*.md` as
verbatim upstream-doc quotes (docs/ is outside the ban scope); peer chaincode ports
7052/9052/11052 exist as unpublished `CORE_PEER_CHAINCODEADDRESS` listen addresses —
semi-vestigial under CCaaS but standard Fabric config.

## Clean checks (169 from tracers; lead spot-checked; condensed by domain)

- **§1 ports/hosts:** every published/container port and hostname:port literal in all
  three compose files matches the §1 table 1:1 (orderers 7050/8050/9050 + admin
  7053/8053/9053 + ops 9443-9445; peers 7051/9051/11051 + cc 7052/9052/11052 + ops
  9446-9448; CAs 7054/8054/9054/10054 with `FABRIC_CA_SERVER_PORT` matching); no port
  remapping anywhere; orchestration's literals (lib.sh:21,48-68, up.sh, provision-
  channel.sh) agree.
- **§2 channels:** repo-wide sweep finds only `coc-main`/`case-NNN`/`anchor-main` in
  executable artifacts; configtx profiles exactly {AppChannel: Org1+Org2,
  AnchorChannel: AnchorClientMSP-only}; creation is configtxgen→`osnadmin channel
  join` on **all 3** orderer admin endpoints with explicit `Status: 201` assertion
  (lib.sh:95)→peer join→commit; up.sh channel wiring per variant correct.
- **§3 chaincode:** all **8 signatures match §3 byte-for-byte**, and every caller —
  gateway (8 call sites), workloads (fabric + rest modes), anchor-client, smoke script
  (REST-only, no direct invokes) — passes exact names, arg counts, arg order.
  Composite keys exactly `evd`/`evt`/`root`; sortKey = `zeroPad19(ns)+"-"+txID[:12]`
  byte-equal to §3; scopeId default "shared"; duplicate root commit rejected; head
  written only by the serial ops; AccessLog never touches the head (structural MVCC
  guarantee intact); GetAuditTrail partial-key range matches the design.
- **§4/§5 shapes:** receipt shape field-for-field identical across batcher→store→
  verification; AnchorRoot record matches §5 exactly; gateway-built CoC event matches
  §5 exactly (the on-chain divergence is F26); CodexEntry required-field validation
  satisfied by both producers; verification folds `.merkleRoot` from both root
  sources correctly.
- **§6 REST:** gateway public route diff clean both directions (all 10 routes, no
  extras); internal routes match; batcher/receipt-store/anchor-client/verification
  endpoint sets match; frontend api.ts hits only existing routes with bearer auth;
  nginx/Vite proxies preserve the /api/v1 prefix.
- **§7 env:** three-way diff (contract ↔ compose ↔ code reads) byte-clean for all
  five services except the four F28 items; every code-read-but-unset var has a safe
  §-consistent default; BATCH_N/K sweep plumbing traced end-to-end (sweep.py →
  .env → compose → batcher read, with variant-correct N-vs-K selection);
  CCAAS_ID_APP/ANCHOR flow byte-for-byte (up.sh → .env → compose → main.go).
- **§8 compose:** profile inventory exactly matches (base/anchoring/parallel-anchored;
  up.sh map correct; down.sh covers all profiles); **all 7 named volumes at the exact
  §8 mount paths, zero anonymous volumes**; measured state never lands outside them
  (receipt-store→receipt-data; batcher/anchor-client have no fs writes; F9 caveat
  pre-recorded); images pinned 2.5.15/1.5.19/node:20.19-alpine/golang:1.25.5;
  goleveldb pinned on all peers; BootstrapMethod none + channel-participation on all
  orderers.
- **§9 routing:** all four variant rows verified in code including root sinks and
  verify sources; anchor-root scope round-trip consistent in both variants (F40
  nuance); batcher per-case vs shared queue selection correct.
- **§10/§11 benchmark/orchestration:** sweeps.yaml matches CLAUDE.md constants
  byte-for-byte (N/K/channels/loads/reps); generated round pair in sync; workload
  args all consumed with matching semantics; smoke/steady separation holds
  (smoke- runIds, reps=1, labels); checkpoint.py du targets byte-equal to §11 and
  container names match compose; collect.py configShas covers the exact §10 file
  list; successful-only throughput policy implemented and recorded.

## Ops note

Tracer fan-out needed one resume (first run: 4 of 5 tracers hit the Pro session
limit); verify fan-out hit limits on both attempts (batches of 8 were still too many
concurrent agents for the window). Inline lead verification was the fallback, per
chunk 1. **Future chunks: assume ~5-6 subagents per session window is the practical
ceiling; design single-phase workflows and verify inline.**

## Handoff to next chunks

- **Chunk 4:** F40 (scope default) is item 1's core; F33 fix design is item 6; F41
  needs classification; clean-check groundwork above means item 1 can focus on live
  JSON bodies only.
- **Chunk 6 fix list additions:** F23 (blocker, small fix), F24+F6 (blocker, sweep
  redesign), F25 (needs author decision — stored-shape change), F26 (§5 rewrite ±
  caseId in appendEvent), F27+F38 (gen:rounds extension), F28-F32+F39+F42+F43 (doc
  edits), F31 (nginx healthz), F33 (frontend verify wiring), F34-F37 minor.
- **Chunk 7:** F35 (wait for all three orderers' ops ports before osnadmin joins).
