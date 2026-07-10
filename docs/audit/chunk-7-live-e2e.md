# Chunk 7 — live E2E: `up.sh --variant standard` + smoke (GREEN)

Date: 2026-07-10 · Session: chunk 7 of the audit plan

**Method:** first live bring-up on real infrastructure, per the chunk-4 ops
directive executed **inline, zero agent fan-out**. Sequence:
`./orchestration/up.sh --variant standard` → `./orchestration/smoke-standard.sh`
→ `./orchestration/down.sh --wipe`, exactly as REPORT.md §Go/no-go step 1.
Findings numbering continues from chunk 5b's F71.

## Result

- **`up.sh --variant standard`: exit 0** (fresh tree → gateway :3000/frontend
  :8081 in ~80 s). Crypto enrolled for 3 orgs, 5 Fabric nodes healthy, ccaas
  packaged + installed once per org (package id
  `evidence_1.0:d8183f6a…158dc6`), `coc-main` created with **HTTP 201 from all
  three orderers**, both peers joined, approve ×2 + commit VALID on both peers.
- **`smoke-standard.sh`: PASS 6/6** — create → transfer → access ×2 → audit
  trail == 4 events → remove → transfer-after-remove correctly rejected.
- **`down.sh --wipe`: clean** — 0 containers, 0 project volumes,
  `network/organizations` + `network/channel-artifacts` removed, ccaas ids in
  `.env` reset to `unset` (tree back to committed state).

Two bring-up attempts failed before the green run; both exposed real bugs that
static review could not see (fixed in this chunk's commit):

### Bug — fixed

- **F72 · `registerEnroll.sh` nested `cacerts/cacerts` corrupts every NodeOU
  `config.yaml`** (`network/crypto/registerEnroll.sh`). `enroll_ca_admin` runs
  with `FABRIC_CA_CLIENT_HOME=${org_root}`, so fabric-ca-client itself creates
  `${org_root}/msp/cacerts/` (the CA admin's own enrollment). The subsequent
  `cp -r "${peer_dir}/msp/cacerts" "${org_root}/msp/cacerts"` therefore copies
  *into* the existing dir (GNU cp semantics), leaving TWO entries under
  `msp/cacerts/`. `cacert_name="$(ls …/msp/cacerts)"` then returns two lines
  and the embedded newline lands inside `Certificate: cacerts/<name>` in every
  NodeOU config.yaml. Live failure: all five nodes exit at boot — peers with
  `failed unmarshalling configuration file … yaml: line 6: could not find
  expected ':'`, orderers with a `loadLocalMSP` panic. Same defect in
  `create_peer_org` and `create_orderer_org`. **Fix:** flat copy
  (`mkdir -p …/msp/cacerts && cp "${src}/"* …`) at both sites — the
  fabric-samples idiom. Verified: config.yaml single-line cert name, one pem in
  `msp/cacerts/`, all nodes healthy.
- **F73 · `package_ccaas` writes to `channel-artifacts/` before it exists**
  (`orchestration/lib.sh`). The F46 fix correctly hoisted install before the
  per-channel loop, but the only `mkdir -p ${CTN_ARTIFACTS}` lived in
  `create_channel` — which now runs *after* packaging. On a clean (post-wipe)
  tree, `tar -czf /opt/gleipnir/network/channel-artifacts/….tar.gz` fails with
  `Cannot open: No such file or directory` and `set -e` kills bring-up. Never
  seen statically because the audit machine had a leftover dir. **Fix:**
  `mkdir -p ${CTN_ARTIFACTS}` inside `package_ccaas` (the function that writes
  there). Verified: fresh-tree bring-up green.

## Watch-list observations (REPORT.md §Chunk 7 watch list)

- **F35** (only orderer0 health-waited before the 3-orderer osnadmin loop):
  did **not** bite — all three joins returned 201 first try. The enroll +
  compose-up window (~40 s) gives orderer1/2 ample startup slack on this host.
  Leaving unfixed remains reasonable for single-host runs.
- **F52** (ccaas placeholder-id crash-loop noise): **no crash-loop observed.**
  The placeholder container (`CHAINCODE_ID=unset`, restart policy `no`) sat
  quietly until the resolved-id recreate; final container `RestartCount=0`.
- **F46 caveat** (duplicate-install exit on 2.5.15): moot as predicted —
  hoisted install ran exactly once per org (two `submitInstallProposal` lines,
  org1 + org2).
- **nginx healthz / gateway**: `GET /healthz` → 200 on both :8081 (frontend
  nginx) and :3000 (gateway). Gateway/frontend starting *before* channels exist
  (compose up -d starts every non-profiled service early) is harmless — the
  fabric-gateway connection is lazy; smoke passed with no gateway restart.
- **F18/F22**: no wget in any exercised path; Docker Desktop startup cost was
  paid repeatedly (see environment notes) — budget stands.
- **F53 / F23 / F44 / spread rounds / F67**: not exercisable in the standard
  variant — they carry to the variant smokes + first benchmark
  (`sweep.py --regime smoke` for anchoring/parallel/parallel-anchored).

## Environment established (Windows 11 host → Ubuntu WSL orchestration host)

`orchestration/README.md` targets Ubuntu 22.04/WSL2; the machine had only Git
Bash + docker-desktop. Established once, reusable for all remaining runs:

1. **Ubuntu-22.04 WSL distro** imported from the official cloud-image rootfs
   (`wsl --import`; store-based `wsl --install` stalled behind the MITM proxy).
   Bootstrap: proxy CA into `/usr/local/share/ca-certificates` +
   `update-ca-certificates`, `apt install jq`, and **fabric-ca-client 1.5.19
   extracted from the pinned `hyperledger/fabric-ca:1.5.19` image** (Ubuntu
   22.04 base, plain glibc — runs natively; no separate download needed).
2. **Docker Desktop WSL integration** for the distro. Two gotchas cost four
   Desktop restarts: (a) PowerShell 5.1 `Set-Content -Encoding utf8` writes a
   **BOM** into `settings-store.json`, which the backend's JSON parser rejects
   — write BOM-less; (b) force-killing the backend mid-cycle **reset the
   engine's image store** (all pulled/built images lost once; re-pulled and
   rebuilt). Keys used: `EnableIntegrationWithDefaultWslDistro: true` +
   `IntegratedWslDistros: ["Ubuntu-22.04"]`, distro set as WSL default.
   Published container ports are reachable on `localhost` inside the distro
   (verified) — this is what `CA_HOST=localhost` enrollment, `wait_healthz`,
   and the smoke curl all rely on.
3. **Image pre-build with build-time CA injection** (`chunk-7-build-images.sh`
   beside this doc). The MITM proxy breaks in-build TLS (`npm ci`,
   `go mod download` → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`), and the tracked
   Dockerfiles are citation-pinned. Wrapper Dockerfiles are **generated from
   the originals** (awk-inserted CA lines only: `NODE_EXTRA_CA_CERTS` for node
   images, `update-ca-certificates` for the golang stage), built with the CA
   supplied via `--build-context` (never enters the repo), and tagged with the
   compose-v2 default names (`gleipnir-<service>`), so `compose up` finds the
   images and **skips building**. `down.sh --wipe` does not remove images —
   re-run the script only if the engine's image store is reset. The runtime
   containers are byte-identical in behaviour; the F58 "byte-reproducible from
   the cited commit" property is waived on this dev host only.

## Go / no-go

**Chunk 7 GREEN → first benchmark run is GO** per REPORT.md order: smoke each
remaining variant (`sweep.py --variant <v> --regime smoke`), then steady-state
Standard first. Between variants: `down.sh --wipe` + fresh `up.sh`. Watch
carried forward: F23 token, F44 epoch, F53 calibration, spread rounds ↔
provisioned channels, F67 clean-tree case-001.
