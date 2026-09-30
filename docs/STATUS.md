# GLEIPNIR — Status & Handoff

> **One living file.** Update it in place at the end of every working session. Do not add dated
> `handoff-YYYY-MM-DD.md` files; the last two (2026-09-25, 2026-09-26) are in git history before
> this file existed. *What* changed and *why* lives in `docs/CONTRACTS.md` §12 (decision record)
> and `git log`; this file only says where things stand and what comes next.

**Last updated:** 2026-09-30, ~17:20 (end of session). The readiness audit
(`docs/reviews/campaign-readiness-2026-09-30.md`) found two pre-ramp blockers (R1, R2) and two
problems that would have forced E1 to be re-run (R3, R4); all four are fixed in `542c125` (§1); the
E1 batch-size rule (R5) is open with D (§5). **The E0 re-smoke passed on all four variants (0
failures).** The ramp was postponed because the host ran out of memory (Discord and Chrome leak GPU
memory — §2, Host memory). Everything is shut down. **Next action (2026-10-01): §3 "Start of the
next session", then the ramp.**

## 1. Where the repo stands

- **Push `main` before every stage** (`git status -sb` must show no `[ahead]`): every `run.json`
  stamps HEAD as provenance and the thesis cites GitHub SHAs. `run.json` has no dirty-tree flag, so
  nothing the runs use may be uncommitted.
- Landed, in order: M27 desktop benchmark app + web dashboard removal (`63d534b`), web redesign
  (`ba48923`), the over-engineering refactor (`6073abc`, CONTRACTS §12-20), docs re-organisation
  (`bf8215c`), and the **pre-ramp commit (2026-09-30)**:
  - the 2026-09-29 pre-flight set, which had never been committed (the uncommitted 2026-09-29 STATUS
    edit claimed it was):
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
  §12-22/23 cite its figures). **E0 was re-smoked on `542c125` (2026-09-30 14:33–15:01, precedent
  §12-20): all four variants complete, 2,332 transactions, 0 failures** (Parallel had 1 race failure
  before); audit case 1 no longer timed cold (Standard 161 → 15 ms; ≈ 1.3× the other cases remains on
  Standard, Anchoring and Parallel), Anchoring root reads per case `[5,5,5,5,5]` (was `[5,0,0,0,0]`);
  storage and latency in line with the old E0 (on-chain B/event within 0.2 %, Anchoring 114 vs 107
  from one extra 2-leaf forced batch). Every run recorded commit `542c125`, sweeps blob `a31da07`,
  `headGap` 7, host memory 9.7 GB. Table: the review record. No ramp, E1, E2 or E3 run exists yet.
- **Every baseline in `benchmark/sweeps.yaml` is a PLACEHOLDER:** send rate 50, batch 50,
  channels 20 (the provisional case count for the ramp and E1), channels_max 50.

## 2. Environment (checked 2026-09-30)

| Item | State |
|---|---|
| Docker Desktop | 4.38.0, engine 27.5.1 (CLAUDE.md pins 29.5.2 — known since July; keep it fixed for the whole campaign, never accept an update mid-campaign). Does **not** auto-start after a reboot; `docker desktop start` / `stop` work from PowerShell |
| WSL | 2.4.12 (a Store app). **`%USERPROFILE%\.wslconfig` = `[wsl2]` `memory=10GB` since 2026-09-30** (MemTotal 9.7 GiB, 32 CPUs). Never change it before the campaign ends: `run.json` records `host.memGb` |
| Live stack | **Everything off** (2026-09-30 end of session): containers down (plain `down.sh`, volumes kept), Docker Desktop stopped, WSL shut down. The ledger volumes hold **E0 smoke-run data** (app origin `benchmark:e0@20260930-143311` in `backups/state.json`; the last network was parallel-anchored). `network/compose/.env` shows as modified (`VARIANT=parallel-anchored`, `CCAAS_ID_ANCHOR`, `BATCH_EPOCH`) — runs rewrite it; never commit it. The fixture's custody trails (ledgers, receipts) are only in the backup until the final Restore; its accounts, cases and files stay in the library volumes, which resets never touch |
| Host memory | **Discord and Chrome leak GPU memory.** 2026-09-30 15:05: 0.7 GB of 15.7 GB free, commit 35/36.5 GB, kernel paged pool 7.5 GB growing ≈ 60 MB/min with the benchmark stopped — pool tag `Vi54` (dxgkrnl video memory manager) 5.9 GB; GPU committed memory Discord 3.8 GB (+17 MB/30 s), Chrome 0.83 GB (+24 MB/30 s). Likely the same mechanism as the 0x10E/0x119 graphics blue screens. With WSL at 10 GB, Windows has only ≈ 5.7 GB — close them before every stage (§3) |
| Backups | **`backups/20260930-134117` "before ramp" (ledger held: test data) — the one to restore after the campaign.** `backups/20260926-202333` "before ponytail live test" is older: never restore it |
| Images | All 15 present: the 10 `gleipnir-*`, `fabric-{peer,orderer,tools}:2.5.15`, `fabric-ca:1.5.19`, `alpine`; npm layers non-empty. Never rebuild or pull once the ramp has started (`run.json` records no image IDs) |
| Proxy CA bundle | `C:\Users\LENOVO\gleipnir-ca-bundle.crt`, regenerated 2026-09-26 (110 certs; the Avast Web/Mail Shield root). Regenerate after a proxy change from `Cert:\LocalMachine\Root, Cert:\CurrentUser\Root, Cert:\LocalMachine\CA, Cert:\CurrentUser\CA`, de-duplicated by thumbprint |
| Fixture | The authors' manual test data (13 users, 8 cases, 24 exhibits); survived the 2026-09-29 crash (checked 2026-09-30 via the service token + `/audit`: 8 cases, `coc-main` height 218, `ev-njr-001` 1 CREATE / 0 ACCESS); since the E0 re-smoke its ledger part exists only in `backups/20260930-134117` |
| Crypto material | `network/organizations/` complete for org1, org2, orderer **and** the anchor org — gitignored and in no volume backup; a restored ledger only works with these certificates |
| WSL toolchain | node 20.19.6, Caliper 0.6.0 bound `fabric:fabric-gateway` (fabric-gateway 1.5.0), Python 3.10 + PyYAML, fabric-ca-client 1.5.19, jq, curl. matplotlib only on the Windows host |
| Host | i9-13900HX, 24 physical / 32 logical cores, ≈ 248 GB free on C:. **Fast Startup is on**, so Start → *Shut down* hibernates the kernel session (keeps leaked kernel memory, uses the hibernate path that crashed twice) — use *Restart*, or `shutdown /s /full /t 0` to power off |
| Power | Legion Balance Mode. On AC: never sleeps or hibernates, lid does nothing. **On battery: hibernates after 3 h, closing the lid sleeps.** The 2026-09-29 17:31 crash was a blue screen (0x3B) while the laptop was put to sleep with the WSL2 VM up; 09-21 and 09-24 crashed mid-hibernate; the July campaign loss (07-22) was a GPU-driver blue screen |
| Windows Update | **Not paused yet** — pause before the first overnight stage (E1), with an end date that covers the wait for D; turn off Microsoft Store app updates (WSL is a Store app) |
| Windows Python | 3.11.9 with tkinter, PyYAML, matplotlib — the Bench app runs |

## 3. Start of the next session (then the ramp)

Done on 2026-09-30: prerequisites checked; readiness audit (review record) with every finding
adversarially verified; the fixes in §1; offline gates green (node 17/17, `collect.py --selftest`,
`test_experiment.py`, `test_benchapp.py`, every dry-run: ramp 4 sub-floor `trace=224evx7`, E1 36 /
E2 18 / E3a 12 / E3b 72 steady, ops 12); pre-ramp backup `backups/20260930-134117`; WSL 10 GB; old
E0 archived; E0 re-smoke passed.

In this order:
1. **Free the host.** Best: **Restart** before the ramp (Fast Startup is on, so a plain *Shut down*
   hibernates the kernel and keeps the leaked pool; to leave the laptop off overnight use
   `shutdown /s /full /t 0`; never sleep). Before the ramp quit **Discord, Chrome and Roblox** (and
   Steam, Epic, EA, Opera GX, OneDrive — they start at login), or turn hardware acceleration off in
   Discord and Chrome. Check in PowerShell:
   `Get-Counter '\Memory\Available MBytes','\Memory\Pool Paged Bytes' -SampleInterval 30 -MaxSamples 3`
   — several GB available and a paged pool of a few hundred MB that does not grow across the samples.
2. **Pause Windows Update** (Settings → Windows Update → Pause, end date after the campaign incl. the
   wait for D) and turn off Microsoft Store app updates — before E1 at the latest.
3. **Start Docker Desktop** (`docker desktop start`, or the Start menu), then check
   `wsl -d Ubuntu-22.04 -u root --exec bash -lc "docker info --format '{{.ServerVersion}}' && docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -cE '^(gleipnir-|hyperledger/fabric|alpine)'"`
   → `27.5.1` and `15`. Do **not** start the stack and do not open `GLEIPNIR Web.cmd`. Then
   `git status -sb` in the repo root must read `## main...origin/main` with only
   ` M network/compose/.env` below it (commit + push anything else first).
4. **Charger in, lid open,** the laptop otherwise idle while a stage runs (the resource monitor only
   sees the benchmark containers).
5. **Run the ramp** from the Bench app (`pyw -3.11 orchestration\benchapp.pyw` from the repo root):
   *E0 initial test* → select **ramp** (the tab opens on *smoke test*) → *Preview plan* must read
   `plan ramp: 4 run(s), 4 to execute` with `trace=224evx7` → *Run…* → tick **skip the backup** (the
   ledger holds E0 smoke-run data, app origin `benchmark:e0@…`; the fixture's trails are in
   `backups/20260930-134117` — the E0 re-smoke ran headless through `benchcore` with the app's own
   bookkeeping) → *Start*. ≈ 1.6–1.9 h.
6. **After the ramp:** review the E0 tab's suggestion → *Use N tx/s as baseline…* (and *Use trimmed
   grid…* only if it keeps ≥ 5 levels) → commit + push `benchmark/sweeps.yaml` by path → decide the
   off-machine copy target (deferred by the author until after the ramp) for `backups/20260930-134117/`,
   `network/organizations/`, `benchmark/results/` and `benchmark/traces/` → E1 once the E1 rule
   question (§5) is settled with D or explicitly deferred.

## 4. Run order and what each stage writes

| Stage | Runs | Realistic time* | Writes / gate |
|---|---|---|---|
| E0 re-smoke | 4 | done 2026-09-30 (28 min) | passed: 0 failures on all four variants on `542c125` (smoke, never benchmark data) |
| ramp (E0) | 4 | ≈ 1.6–1.9 h | suggests `baseline.send_rate_tps` + trimmed `send_rates_tps` → **Use as baseline** → commit + push |
| E1 | 36 | ≈ 9.5 h | E1 runs; `baseline.batch_size` needs the replacement rule agreed with D (§5) → commit + push |
| E2 | 18 | ≈ 6 h | suggests `baseline.channels` (median of the healthy range) and `channels_max` → confirm → commit + push |
| **send to D** | — | — | variable table + three flowcharts with measured values, **before E3** (`docs/methodology/experiments.md` §2, §6) |
| E3a | 12 | ≈ 5 h | scalability vs send rate (the trimmed grid must keep ≥ 5 levels or Parallel runs sub-floor) |
| E3b | ≤ 72 | ≈ 22 h | scalability vs cases, trimmed to `channels_max` |
| ops | 12 | ≈ 2.6 h | per-operation breakdown; writes and reads in separate tables |

\* At a 50 tx/s baseline, including resets (≈ 10 s per channel) and Caliper start-up (≈ 45 s per
round): ≈ 47 machine-hours in all (projected). The dry-run ETAs are well under half of this (ramp:
0.5 h — with no same-experiment history they borrow the E0 smoke median). `--resume` (the app's Resume) skips complete runs after an
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
  it biases Parallel (modelled ≈ 4–8 % at 5–10 cases, ≈ 9 % at 200 tx/s), Standard ≤ 0.6 %
  (modelled) and not the anchored variants (methodology §7). `collect.py` computes no drain-free rate yet (the tx logs keep tCreate/tFinal) — decide
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

- The new generator (rule e) and the audit warm-up ran live only at smoke scale (E0 re-smoke, 5 tx/s);
  the ramp at 224 events per case is their first run at campaign scale and send rates up to 200 tx/s.
- E2 at 40 and 50 channels.
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
  holds benchmark data). Tick it only if nobody touched the web app and nothing ran outside the app
  or `benchcore`'s own functions since the *before ramp* backup (the 2026-09-30 E0 re-smoke used
  `benchcore`, so the ramp may skip it).
- **Commit only `benchmark/sweeps.yaml` between stages, by path** (`git add benchmark/sweeps.yaml`),
  then push. `network/compose/.env` is tracked and every run rewrites it — never `git add -A` /
  `git commit -a`, never commit or `git checkout` it; the final Restore puts it back. No commit, pull,
  checkout or edit under `benchmark/`, `orchestration/`, `network/` while a stage runs.
- **Terminal `experiment.py` runs skip the app's bookkeeping** (`backups/state.json`, `backup.json`,
  `compose.env`), so a later backup can be labelled "test data" and become the Restore default. Use
  the app, or benchcore's own functions, for campaign stages.
- **Never let the laptop sleep or hibernate while Docker Desktop runs** (see §2, Power).
- **Close Discord, Chrome and Roblox before every stage** (§2, Host memory): they leak GPU memory into
  the kernel's paged pool until Windows runs out of memory. Diagnose a leak by pool tag
  (`NtQuerySystemInformation` class 22, what poolmon shows) and map `Vi*` tags to processes with the
  `\GPU Process Memory(*)\Total Committed` counters.
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
