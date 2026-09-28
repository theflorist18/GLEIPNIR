# Step 2 — variant smokes: anchoring / parallel / parallel-anchored (GREEN)

Date: 2026-07-10 · Session: REPORT.md §Go/no-go step 2, executed inline
(same session as chunk 7). Findings numbering continues from chunk 7's F73.

## Result — all three variants functionally green

Each variant: fresh `up.sh --variant <v>` → `sweep.py --variant <v> --regime
smoke` → `down.sh --wipe`. Caliper 0.6.0, Node 20.19.6, Ubuntu-22.04 WSL host.

| cell | rounds (succ/fail) | evidence |
|---|---|---|
| `smoke-anchoring-N10-r0` | create 10/0 · logs 250/0 · verify 100/0 | batcher committed ~29 epoch-namespaced batches (`shared-N10-<epoch>-b0000NN`), roots on-chain; verify = live RQ2 path (receipt → Merkle branch → on-chain root) |
| `smoke-parallel-channels1-r0` | create 10/0 · logs 250/0 (no verify round by design) | fabric-gateway connector on `case-001`; real submit-to-commit latency (create avg 0.91 s) |
| `smoke-parallel-anchored-K5-channels1-r0` | create 10/0 · logs 250/0 · verify 100/0 | per-case batchIds `case-001-K5-<epoch>-b0000NN`; anchor-client committed roots to `anchor-main` |

All manifests collected (3/2/3 rounds), checkpoints t0/t1 written per cell.
Carried watch items resolved: **F23** batcher bearer-token commits worked;
**F44** `BATCH_EPOCH` flowed through compose into batchIds; **F67-adjacent**
`provision-channel.sh case-001` correctly skipped an existing channel
("already exists — skipping creation"); anchor org enrollment + `anchor-main`
+ `ccaas-evidence-anchor` all first-time-live green (F72/F73 fixes held).

## Findings

### Bug — fixed

- **F74 · peers' operations `/healthz` is not a valid readiness probe — the
  docker health check can never pass in this topology** (`orchestration/
  lib.sh` `wait_healthz`). Fabric peers register a docker-daemon health
  checker; ccaas peers have no docker socket **by design** (the peer never
  builds chaincode), so after startup every peer's healthz is a permanent
  `503 {"failed_checks":[{"component":"docker",...}]}`. Peers answer 200 only
  in a brief window before the checker registers. Chunk 7 and the first two
  smokes won that race; the heavier parallel-anchored bring-up (16
  containers) lost it — `peer0-org2` flipped to 503 before its turn in the
  sequential wait loop and up.sh timed out after 120 s. **Fix:** wait_healthz
  now accepts `status == "OK"` **or** a 503 whose only failed check is
  `docker` (jq is already a host prereq). Verified against a live 503 peer, a
  healthy orderer, and a full green parallel-anchored bring-up (all four
  nodes incl. `peer0-anchor` :9448). Orderer healthz is unaffected (no docker
  check). Also explains chunk 7's "F35 didn't bite" as partially luck-shaped:
  the health waits themselves were racy, independent of orderer1/2 timing.

### Executed setup (recorded, per benchmark/README)

- **Caliper binding ran for the first time**: `npm run bind` ==
  `npx caliper bind --caliper-bind-sut fabric:fabric-gateway`, installing
  `@hyperledger/fabric-gateway@1.5.0` + `@grpc/grpc-js@1.10.3` exactly as
  benchmark/README records. Without it the fabric-connector variants fail
  with `Unable to detect required Fabric binding packages` (error code 6) —
  the exact stale-knowledge trap CLAUDE.md predicted; the REST-connector
  variant (anchoring) needs no binding, which is why it passed first.
  `benchmark/package.json` + lockfile now pin the bound SDK, so a fresh
  `npm ci` restores it without re-running bind.

### Notes (environment / data-quality — not product bugs)

- **F75 · 9p stale-cwd: python launches fail from a shell whose cwd predates
  up.sh's churn.** Deterministic on this host: after up.sh (enroll writes +
  bind-mount traffic on the /mnt/c 9p mount), a `python3 <relative-path>`
  from the still-open shell dies at interpreter startup (`getcwd`/relative
  sys.path → FileNotFoundError). Remedy in the runner, not the repo: re-`cd`
  to the absolute repo path (fresh fid) and invoke sweep.py by absolute path.
  Bash itself is unaffected (its own cwd handling), which is why up.sh works
  and only the following python3 died.
- **F76 · sweep.py runs checkpoint/collect with `check=False` — their
  failures don't fail the sweep.** Observed once: a collect invocation
  produced no output and left the manifest un-merged; the sweep still printed
  "sweep complete." Data is never lost (caliper.log persists; collect.py is
  idempotent and re-runnable), but steady-state runs should eyeball
  `collected N rounds` per cell — or the author may want `check=True` /
  explicit verdict logging. `python3 -u` in the runner also keeps child
  output visible through pipes.
- **Negative min-latency in Caliper smoke tables** (`smoke-logs` min −0.86 s
  REST, −0.55 s fabric). Worker-clock artifact in Caliper 0.6.0 at high
  local commit speed; affects min only (avg/max sane). collect.py stores the
  raw value. Interpret min-latency with care in steady-state reporting.

## Go / no-go

**Step 3 (steady-state sweeps) is GO**, Standard first, per REPORT.md — with
one operational caveat: run each variant's sweep from a **fresh shell** (or
the runner's re-cd pattern) because of F75, and glance at each cell's
`collected N rounds` line (F76).
