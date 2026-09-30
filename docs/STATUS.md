# GLEIPNIR — Status & Handoff

> **One living file.** Update it in place at the end of every working session. Do not add dated
> `handoff-YYYY-MM-DD.md` files; the last two (2026-09-25, 2026-09-26) are in git history before
> this file existed. *What* changed and *why* lives in `docs/CONTRACTS.md` §12 (decision record)
> and `git log`; this file only says where things stand and what comes next.

**Last updated:** 2026-09-30, ~15:00. A readiness audit on 2026-09-30 found two pre-ramp blockers
and three pre-E1 problems; all are fixed in the pre-ramp commit (§1). **Next action: E0 re-smoke on
the new code (all four variants), then the ramp (§4).**

## 1. Where the repo stands

- **Push `main` before every stage** (`git status -sb` must show no `[ahead]`): every `run.json`
  stamps HEAD as provenance and the thesis cites GitHub SHAs. `run.json` has no dirty-tree flag, so
  nothing the runs use may be uncommitted.
- Landed, in order: M27 desktop benchmark app + web dashboard removal (`63d534b`), web redesign
  (`ba48923`), the over-engineering refactor (`6073abc`, CONTRACTS §12-20), docs re-organisation
  (`bf8215c`), and the **pre-ramp commit (2026-09-30)**:
  - the 2026-09-29 pre-flight set, which had never been committed (STATUS claimed it was):
    `events_per_case_per_round` 224, the Bench app's icon (Tk's quill), the placeholder web favicon,
    the `GLEIPNIR Web.cmd` launcher;
  - `ramp.events_per_case_per_round` 40 → 224 (CONTRACTS §12-21): an 800-tx ramp round lets
    Parallel's ≈ 2 s end-of-round block wait read as saturation at 50 tx/s (modelled 0.89 × send
    rate), and the §4.3 rule would have suggested 25 tx/s by construction;
  - trace generator rule (e) + weighted interleave (CONTRACTS §12-22): a TRANSFER/DISPOSE sits
    ≥ 110 items after its evidence's previous CREATE/TRANSFER within a round (≥ 7 in the 60-item E0
    smoke round), so the trace race (a head op endorsed before its predecessor commits) is modelled
    at ≤ 0.1 % below saturation instead of 0.48–1.79 %. Every trace hash changed;
  - audit reconstruction per case (CONTRACTS §12-23): the root cache is per case and an untimed
    warm-up pass precedes the timed cases (E0's case 1 was timed cold and, on Anchoring, paid every
    root read);
  - `test_experiment.py` no longer hard-codes 200; docs aligned (methodology §2/§3/§6/§7/§8,
    CONTRACTS §10/§12, AS-BUILT, ARCHITECTURE, benchmark/README, Bench app help).
- **Never rewrite history.** The thesis cites SHAs (CLAUDE.md, Repository discipline).
- **E0 (2026-09-26, old code) is archived** in `benchmark/results/e0-pre-headgap-20260930/` (CONTRACTS
  §12-22/23 cite its figures); `benchmark/results/e0/` is re-smoked on the new code (precedent §12-20).
  No ramp, E1, E2 or E3 run exists yet.
- **Every baseline in `benchmark/sweeps.yaml` is a PLACEHOLDER:** send rate 50, batch 50,
  channels 20 (the provisional case count for the ramp and E1), channels_max 50.

## 2. Environment (checked 2026-09-30)

| Item | State |
|---|---|
| Docker Desktop | 4.38.0, engine 27.5.1 (CLAUDE.md pins 29.5.2 — known since July; keep it fixed for the whole campaign, never accept an update mid-campaign). Does **not** auto-start after a reboot; `docker desktop start` / `stop` work from PowerShell |
| WSL | 2.4.12 (a Store app). **`%USERPROFILE%\.wslconfig` = `[wsl2]` `memory=10GB` since 2026-09-30** (MemTotal 9.7 GiB, 32 CPUs). Never change it before the campaign ends: `run.json` records `host.memGb` |
| Live stack | **Stopped** since the 2026-09-30 13:41 backup (plain `down.sh`, volumes kept). The ledger volumes held the fixture until the first reset of the E0 re-smoke |
| Backups | **`backups/20260930-134117` "before ramp" (ledger held: test data) — the one to restore after the campaign.** `backups/20260926-202333` "before ponytail live test" is older: never restore it |
| Images | All 15 present: the 10 `gleipnir-*`, `fabric-{peer,orderer,tools}:2.5.15`, `fabric-ca:1.5.19`, `alpine`; npm layers non-empty. Never rebuild or pull once the ramp has started (`run.json` records no image IDs) |
| Proxy CA bundle | `C:\Users\LENOVO\gleipnir-ca-bundle.crt`, regenerated 2026-09-26 (110 certs; the Avast Web/Mail Shield root). Regenerate after a proxy change from `Cert:\LocalMachine\Root, Cert:\CurrentUser\Root, Cert:\LocalMachine\CA, Cert:\CurrentUser\CA`, de-duplicated by thumbprint |
| Fixture | The authors' manual test data (13 users, 8 cases, 24 exhibits); survived the 2026-09-29 crash (checked 2026-09-30 via the service token + `/audit`: 8 cases, `coc-main` height 218, `ev-njr-001` 1 CREATE / 0 ACCESS) |
| Crypto material | `network/organizations/` complete for org1, org2, orderer **and** the anchor org — gitignored and in no volume backup; a restored ledger only works with these certificates |
| WSL toolchain | node 20.19.6, Caliper 0.6.0 bound `fabric:fabric-gateway` (fabric-gateway 1.5.0), Python 3.10 + PyYAML, fabric-ca-client 1.5.19, jq, curl. matplotlib only on the Windows host |
| Host | i9-13900HX, 24 physical / 32 logical cores, ≈ 259 GB free on C: |
| Power | Legion Balance Mode. On AC: never sleeps or hibernates, lid does nothing. **On battery: hibernates after 3 h, closing the lid sleeps.** The 2026-09-29 17:31 crash was a blue screen (0x3B) while the laptop was put to sleep with the WSL2 VM up; 09-21 and 09-24 crashed mid-hibernate; the July campaign loss (07-22) was a GPU-driver blue screen |
| Windows Update | **Not paused yet** — pause before the first overnight stage (E1), with an end date that covers the wait for D; turn off Microsoft Store app updates (WSL is a Store app) |
| Windows Python | 3.11.9 with tkinter, PyYAML, matplotlib — the Bench app runs |

## 3. Pre-flight (2026-09-30)

Done: prerequisites checked; readiness audit (plans, provenance, metrics contract, both code paths,
Bench app, host) with every finding adversarially verified; the fixes in §1; offline gates green
(node 17/17, `collect.py --selftest`, `test_experiment.py`, `test_benchapp.py`, every dry-run: ramp 4
sub-floor `trace=224evx7`, E1 36 / E2 18 / E3a 12 / E3b 72 steady, ops 12); pre-ramp backup; WSL
10 GB; old E0 archived.

Still to do by the authors:
1. **Pause Windows Update** (before E1) and turn off Store app updates.
2. **Quit Discord, Roblox, Steam, Epic, EA, Opera GX and OneDrive before each stage** (they start at
   login); keep the laptop otherwise idle while a stage runs — the resource monitor only sees the
   benchmark containers.
3. **Off-machine copy** of `backups/20260930-134117/` **and** `network/organizations/`, then of
   `benchmark/results/<exp>/`, `benchmark/results/runlog.jsonl` and `benchmark/traces/` after each
   stage (the author deferred the target until after the ramp — decide it then).

## 4. Run order and what each stage writes

| Stage | Runs | Realistic time* | Writes / gate |
|---|---|---|---|
| E0 re-smoke | 4 | ≈ 0.5 h | functional check of the new generator + audit on all four variants (smoke, never benchmark data) |
| ramp (E0) | 4 | ≈ 1.6–1.9 h | suggests `baseline.send_rate_tps` + trimmed `send_rates_tps` → **Use as baseline** → commit + push |
| E1 | 36 | ≈ 9.5 h | E1 runs; `baseline.batch_size` needs the replacement rule agreed with D (§5) → commit + push |
| E2 | 18 | ≈ 6 h | suggests `baseline.channels` (median of the healthy range) and `channels_max` → confirm → commit + push |
| **send to D** | — | — | variable table + three flowcharts with measured values, **before E3** (`docs/methodology/experiments.md` §2, §6) |
| E3a | 12 | ≈ 5 h | scalability vs send rate (the trimmed grid must keep ≥ 5 levels or Parallel runs sub-floor) |
| E3b | ≤ 72 | ≈ 22 h | scalability vs cases, trimmed to `channels_max` |
| ops | 12 | ≈ 2.6 h | per-operation breakdown; writes and reads in separate tables |

\* At a 50 tx/s baseline, including resets (≈ 10 s per channel) and Caliper start-up (≈ 45 s per
round): ≈ 46 machine-hours in all. The dry-run ETAs are about half of this (with no same-experiment
history they borrow the E0 smoke median). `--resume` (the app's Resume) skips complete runs after an
interruption; Docker Desktop must be started by hand first.

`e3a-saturation.json`, the mean ± SD tables and the charts are written by `report.py` (the app's
*History & results* → pick one experiment → *Generate tables + charts*, or
`py -3.11 orchestration/report.py --exp <E>` from the repo root) into `docs/results/<exp>/`, which is
not gitignored — do not commit it together with `sweeps.yaml`.

## 5. Open decisions

- **E1's batch-size rule cannot select a value (with D, before taking E1's baseline).** §4.1 wants
  a ≤ 5 % change in on-chain bytes/event to the next level, but anchored on-chain bytes/event fall as
  1/N (steps 60/50/50/50 %), so no level qualifies and the app offers no *Use as baseline* button.
  Options: an absolute saving (< 5 % of Standard's bytes/event), total on- + off-chain bytes, or
  anchoring delay as the counter-metric. The E1 runs record everything any of these needs.
- **E2's healthy-range rule (§4.2) will not cut the grid on this host (with D, before E2's
  baseline).** The CPU budget (0.9 × 32 × 100 = 2,880 %) is out of reach at a fixed sub-saturation
  send rate and there is no memory term, so the healthy range will likely be the whole grid and
  `baseline.channels` its median by construction.
- **Drain-free throughput.** Caliper's throughput window includes the ≤ 2 s end-of-round block wait;
  it biases Parallel (≈ 4–8 % at 5–10 cases, ≈ 9 % at 200 tx/s) but not Standard or the anchored
  variants. `collect.py` computes no drain-free rate yet (the tx logs keep tCreate/tFinal) — decide
  before reporting E2 §4.2(a), E3a's 200 tx/s flag on Parallel and E3b cross-variant throughput.
- **Anchoring delay in the tables** uses the all-batches mean (`report.py`), which includes forced
  batches (methodology §2.3 says they are excluded) and batches left open across the idle gap
  between rounds. Recomputable from each run's `anchoring.json`; fix `report.py` before reporting.
- **With D, ideally before E1:** the calibration thresholds (§4.1–4.3), r = 3 mean ± SD, the §8
  defaults (incl. the new #13: E0 derives no channel count), and the two contradictions of D's
  10 Sep assumptions: **AccessLog is a WRITE**, **the N and K grids are unified**.
- **With the lecturer:** whether the **off-chain B/event** metric stays in the tables.
- **Variant chip in the SPA:** still skipped; needs an nginx route to the gateway's `/healthz`
  (a CONTRACTS change). The Merkle verify controls work without it.
- **Small UI quirk:** after a manual "Log access", the on-chain custody list does not refresh until
  the page reloads.
- **Design assets still owed by the designers:** brand mark (direction A is the placeholder),
  exports and the final favicon, lead and admin screens, the other Bench tabs, the court report,
  sample thesis figures. Brief: `docs/design/GLEIPNIR-design-brief.md`; boards: `docs/design/claude-design/`.

## 6. Not exercised live (residual risk)

- The new generator (rule e) and the audit warm-up — the E0 re-smoke is their first live run.
- The ramp at 224 events per case; E2 at 40 and 50 channels.
- The Bench app's own Run → backup → restore dialogs. The 2026-09-30 backup and runs were driven
  with the same `benchcore` scripts and bookkeeping (`backup.json`, `state.json`) outside the GUI.
- `registerEnroll.sh` and `up.sh` without `--skip-crypto` (they need fresh crypto, i.e. a wipe).
- `open-web.ps1`'s Docker-start and stack-start branches.

## 7. Rules that bit us (keep them)

- **Never** run `down.sh --wipe`, `docker compose down -v` or `docker volume rm` without explicit
  permission for that one time. Plain `down.sh` keeps the volumes. The supported way around ledger
  resets is: back up → reset → restore. Restore only with the stack stopped; never run `up.sh`
  after a restore; do not add or edit library data between backup and restore.
- **From the first Run… until the final Restore, do not use the web app** (`GLEIPNIR Web.cmd`,
  `localhost:8081`). Every run's `up.sh` starts it on top of the real library volumes, its gateway
  carries the anchored variants' writes and every audit and is CPU/memory-monitored, and its
  auto-logging pages write ACCESS events into the ledger being measured. `GLEIPNIR Web.cmd` also
  starts the stack when `:8081` is down — during a backup, reset or restore that corrupts the step.
- **Four gateway routes add an ACCESS event when read:** `GET /evidence/:id`, `/download`, `/export`
  and `/cases/:id/coc-report`. Never open a fixture exhibit or its report while testing. Fingerprint
  data through the routes that do not log.
- **The Bench app reopens E0 on *smoke test* and E3 on *E3a*.** Select the mode every time; Run… on
  the wrong mode deletes and re-runs a finished stage, and Resume… on it says "Nothing to run".
  After a crash: start Docker Desktop, same tab, re-select the mode, **Resume…** (never Run…).
- **Every Run…/Resume… backs up first unless *skip the backup* is ticked** (offered once the ledger
  holds benchmark data). Tick it only if nobody touched the web app or ran anything outside the app
  since the *before ramp* backup.
- **Commit only `benchmark/sweeps.yaml` between stages, by path** (`git add benchmark/sweeps.yaml`),
  then push. `network/compose/.env` is tracked and every run rewrites it — never `git add -A` /
  `git commit -a`, never commit or `git checkout` it; the final Restore puts it back. No commit, pull,
  checkout or edit under `benchmark/`, `orchestration/`, `network/` while a stage runs.
- **Terminal `experiment.py` runs skip the app's bookkeeping** (`backups/state.json`, `backup.json`,
  `compose.env`), so a later backup can be labelled "test data" and become the Restore default. Use
  the app, or benchcore's own functions, for campaign stages.
- **Never let the laptop sleep or hibernate while Docker Desktop runs** (see §2, Power).
- **Never re-run part of a finished stage in place:** the tables and suggestions read every run under
  `benchmark/results/<exp>/`. Rename the folder first (`e1` → `e1-superseded-<date>`).
- **Never type passwords into the browser.** Get a token with `POST /api/v1/auth/login` from a shell,
  then `sessionStorage.setItem('gleipnir.session', token)` and reload.
- **Check the dependencies inside a rebuilt image, and distrust a CACHED `npm ci` layer.** npm can
  exit 0 with nothing installed when TLS through the proxy fails, and BuildKit keeps that empty layer.
  Rebuild that one image with `docker build --no-cache`, then check its contents.
- **Rebuild images together with compose edits,** and **don't patch files with inline Bash heredocs**
  that contain backslashes. From PowerShell, put multi-command WSL scripts in a file
  (`wsl -d Ubuntu-22.04 -u root --exec bash <file>`): PowerShell 5.1 mangles nested quotes.
- **Run terminal work from a fresh WSL shell** with `wsl -d Ubuntu-22.04 -u root --exec bash -lc "…"`
  (`--exec`, not `--`); one `experiment.py` at a time; export `GLEIPNIR_ALLOW_LEDGER_WIPE=1` only for
  real runs (the app does this itself, never for Preview).
- **A browser that cached the SPA before the 2026-09-26 `no-cache` rule keeps showing the pre-M27
  UI.** Clear that browser's cached files once (Ctrl+Shift+Delete → "Cached images and files").
