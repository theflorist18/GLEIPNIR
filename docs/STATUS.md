# GLEIPNIR — Status & Handoff

> **One living file.** Update it in place at the end of every working session. Do not add dated
> `handoff-YYYY-MM-DD.md` files; the last two (2026-09-25, 2026-09-26) are in git history before
> this file existed. *What* changed and *why* lives in `docs/CONTRACTS.md` §12 (decision record)
> and `git log`; this file only says where things stand and what comes next.

**Last updated:** 2026-10-02, ~09:50 (end of session). **The ramp, E1 and E2 are complete**
(overnight 2026-10-01 22:00 → 2026-10-02 09:34, unattended): no variant saturated up to 200 tx/s, so
`baseline.send_rate_tps` = **100 tx/s** (½ × the top level — the authors' rule for that case),
committed and pushed as `a730030`; E1 36/36 and E2 18/18 runs, all on `a730030`. As predicted, E1's
§4.1 rule selects no batch size and E2's §4.2 rule finds the whole channel grid healthy (§5).
A verification pass found that the **WSL VM's wall clock ran ≈ 4–5 % fast under load and was
stepped back ≈ 1.3 s every ≈ 27 s** during all three stages (not in the 2026-09-30 E0 re-smoke) —
negative minimum latencies throughout (§5). Everything is shut down. **Next action: §3 — investigate
the VM clock, record the no-saturation rule, send D the variable table + flowcharts with the
measured values, settle send rate / batch size / channels / send-rate grid with D, then E3.**

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
  `headGap` 7, host memory 9.7 GB. Table: the review record.
- **Overnight campaign 2026-10-01/02 (`benchmark/results/{ramp,e1,e2}/`, gitignored — local only):**
  - **ramp** (4 runs, 1 h 26 min, on `4c44618`): throughput ÷ send rate at 200 tx/s = Standard
    0.995, Anchoring 1.001, Parallel 0.966 (lowest 0.944 at 150), Parallel-Anchored 1.002 — **no
    variant saturated**, so the rule's literal answer is the top level (200). Standard's p95 rose
    188 → 629 ms from 150 to 200 tx/s — a sharp rise, but not a knee by `report.py`'s rule (p95 ≥ 2 ×
    the 10 tx/s p95, 913 ms on Standard), which flags no knee for any variant on the ramp data.
    Failures: Standard 1, Parallel 4 (all in the 200 tx/s round).
  - **`a730030`** "E0 ramp: baseline.send_rate_tps = 100 tx/s" — the only change is that line of
    `sweeps.yaml` (tag `set from ramp 2026-10-01: no saturation up to the top level, half of it`).
    The trimmed-grid suggestion (= the full grid) was **not** applied (§5).
  - **E1** (36 runs, 5 h 33 min) and **E2** (18 runs, ≈ 4 h 25 min elapsed incl. one discarded
    attempt; the 18 kept runs total 4 h 03 min of wall time). E2 was stopped at ≈ 08:44 for the
    author to leave — inside run 17 `e2/parallel/ch50-cases50/r1` (its last slice; `runlog.jsonl`
    `failed`, ≈ 23 min discarded) — and resumed at 08:51 with `--resume`, which re-ran that run from
    a fresh ledger. Every run is on `a730030`; one attempt each except that run; no retries after
    failures. Results in §5; tables + charts by `report.py` in `docs/results/e1/` and
    `docs/results/e2/` (untracked; not committed).
  - Driven headless by a scratchpad driver (not in the repo): the Bench app's exact argv, WSL script
    and bookkeeping via `benchcore`, plus the authors' go-ahead (accept the ramp's suggestion iff
    25–100 tx/s; no saturation → 100), backup skipped as §3 allowed. It is still at
    `%LOCALAPPDATA%\Temp\claude\C--theflorist18-Gleipnir\1ccfdfb0-900c-4a61-b5c2-f9e083a9a452\scratchpad\overnight.py`
    (with `stop.sh`, `overnight.log`); %TEMP% can be cleaned at any time — copy it out if E3 is to be
    driven the same way (its stage list is ramp/E1/E2).
- **Baselines in `benchmark/sweeps.yaml`:** send rate **100** (set from the ramp); batch 50,
  channels 20 and channels_max 50 are still PLACEHOLDERS (E1/E2 rules: §5).

## 2. Environment (checked 2026-09-30; updated 2026-10-02)

| Item | State |
|---|---|
| Docker Desktop | 4.38.0, engine 27.5.1 (CLAUDE.md pins 29.5.2 — known since July; keep it fixed for the whole campaign, never accept an update mid-campaign). Does **not** auto-start after a reboot; `docker desktop start` / `stop` work from PowerShell |
| WSL | 2.4.12 (a Store app). **`%USERPROFILE%\.wslconfig` = `[wsl2]` `memory=10GB` since 2026-09-30** (MemTotal 9.7 GiB, 32 CPUs). Never change it before the campaign ends: `run.json` records `host.memGb` |
| Live stack | **Everything off** (2026-10-02 ~09:40): containers down (plain `down.sh`, volumes kept), Docker Desktop stopped, WSL shut down. The ledger volumes hold **E2 benchmark data** (app origin `benchmark:e2@20261002-085142` in `backups/state.json`; the last network was Parallel at 50 channels). `network/compose/.env` shows as modified — runs rewrite it; never commit it. The fixture's custody trails (ledgers, receipts) are only in the backup until the final Restore; its accounts, cases and files stay in the library volumes, which resets never touch |
| Host memory | **Discord and Chrome leak GPU memory.** 2026-09-30 15:05: 0.7 GB of 15.7 GB free, commit 35/36.5 GB, kernel paged pool 7.5 GB growing ≈ 60 MB/min with the benchmark stopped — pool tag `Vi54` (dxgkrnl video memory manager) 5.9 GB; GPU committed memory Discord 3.8 GB (+17 MB/30 s), Chrome 0.83 GB (+24 MB/30 s). Likely the same mechanism as the 0x10E/0x119 graphics blue screens. With WSL at 10 GB, Windows has only ≈ 5.7 GB — close them before every stage (§3). **2026-10-01/02 (both closed):** paged pool steady at 0.82–0.90 GB all night; Windows "available" still fell to 0.5–2 GB during runs because the WSL VM's Linux page cache held `vmmem` at 5–6.5 GB (inside the VM 6.7 GB stayed available; paging stayed low, ≤ 31 pages/s at the checks). Closing Windows Widgets freed ≈ 2 GB once (it relaunches itself) |
| Backups | **`backups/20260930-134117` "before ramp" (ledger held: test data) — the one to restore after the campaign.** `backups/20260926-202333` "before ponytail live test" is older: never restore it |
| Images | All 15 present: the 10 `gleipnir-*`, `fabric-{peer,orderer,tools}:2.5.15`, `fabric-ca:1.5.19`, `alpine`; npm layers non-empty. Never rebuild or pull once the ramp has started (`run.json` records no image IDs) |
| Proxy CA bundle | `C:\Users\LENOVO\gleipnir-ca-bundle.crt`, regenerated 2026-09-26 (110 certs; the Avast Web/Mail Shield root). Regenerate after a proxy change from `Cert:\LocalMachine\Root, Cert:\CurrentUser\Root, Cert:\LocalMachine\CA, Cert:\CurrentUser\CA`, de-duplicated by thumbprint |
| Fixture | The authors' manual test data (13 users, 8 cases, 24 exhibits); survived the 2026-09-29 crash (checked 2026-09-30 via the service token + `/audit`: 8 cases, `coc-main` height 218, `ev-njr-001` 1 CREATE / 0 ACCESS); since the E0 re-smoke its ledger part exists only in `backups/20260930-134117` |
| Crypto material | `network/organizations/` complete for org1, org2, orderer **and** the anchor org — gitignored and in no volume backup; a restored ledger only works with these certificates |
| WSL toolchain | node 20.19.6, Caliper 0.6.0 bound `fabric:fabric-gateway` (fabric-gateway 1.5.0), Python 3.10 + PyYAML, fabric-ca-client 1.5.19, jq, curl. matplotlib only on the Windows host |
| Host | i9-13900HX, 24 physical / 32 logical cores, ≈ 248 GB free on C:. **Fast Startup is on**, so Start → *Shut down* hibernates the kernel session (keeps leaked kernel memory, uses the hibernate path that crashed twice) — use *Restart*, or `shutdown /s /full /t 0` to power off |
| Power | Legion Balance Mode. On AC: never sleeps or hibernates, lid does nothing (lid action re-checked 2026-10-02: AC 0 = do nothing, DC 1 = sleep). **On battery: hibernates after 3 h, closing the lid sleeps.** The 2026-09-29 17:31 crash was a blue screen (0x3B) while the laptop was put to sleep with the WSL2 VM up; 09-21 and 09-24 crashed mid-hibernate; the July campaign loss (07-22) was a GPU-driver blue screen |
| Windows Update | **Paused until 2026-10-22** (set 2026-10-01 in `HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings`, `Pause*` values — what Settings → Pause writes) and Microsoft Store automatic app updates **off** by policy (`HKLM\SOFTWARE\Policies\Microsoft\WindowsStore` `AutoDownload`=2; WSL is a Store app). Extend the pause if E3 runs past 10-22; after the campaign: Settings → *Resume updates* and delete that `AutoDownload` value |
| Windows Python | 3.11.9 with tkinter, PyYAML, matplotlib — the Bench app runs |

## 3. Start of the next session (then E3)

Done on 2026-10-01/02: ramp → baseline 100 tx/s (`a730030`, pushed) → E1 → E2, all complete;
tables + charts in `docs/results/e1/`, `docs/results/e2/`.

Before E3, in this order:
0. **Investigate the VM clock (§5, first bullet).** It must be understood — and the way E1/E2
   latencies are reported decided — before E3 adds a day of runs under the same condition. Do not
   change `.wslconfig` or the kernel clocksource without deciding with D: E3 would then not be
   comparable with E1/E2.
1. **Record the authors' no-saturation rule** (2026-10-01: if no variant saturates up to the top
   level, take ½ × the top level → 100 tx/s) as CONTRACTS §12-24 and in methodology §4.3 (+ a §8
   row for D). Today it is only in the `a730030` message and the `sweeps.yaml` tag; methodology §4.3
   and `report.py` still give 200, so the Bench app's E0 tab offers **Use 200 tx/s as baseline…** —
   never click it.
2. **Send D the variable table + the three flowcharts with the measured values**
   (`docs/methodology/experiments.md` §2, §6 — the supervisor's gate before E3), together with:
   the ramp outcome and the send-rate rule (a different send rate from D means re-running E1 and E2,
   ≈ 10 h), the E1 table and the batch-size rule question, the E2 table and the channel question,
   the VM-clock caveat, and the two contradictions of D's 10 Sep assumptions (AccessLog is a WRITE;
   the N and K grids are unified). The open items are in §5.
3. **Settle with D, then write the baselines:** `baseline.batch_size` in *Settings & Baselines* (E1
   offers no *Use as baseline* button) — if the agreed value is the current 50, Save writes nothing,
   so change the `[PLACEHOLDER until E1]` tag in `benchmark/sweeps.yaml` itself to
   `[set by hand <date> …]`; `baseline.channels` / `channels_max` with E2's *Use 20 / max 50 as
   baselines…* (it re-tags unchanged values); the E3a send-rate grid (`send_rates_tps`) in the ramp
   box of the *E0 initial test* tab (it is not on Settings & Baselines). Commit + push
   `benchmark/sweeps.yaml` by path.
4. **Fix before reporting** (§5): drain-free throughput, the anchoring-delay column (forced
   batches), Caliper's missed late completions (7 of 298 rounds, any position — take the count AND
   the window from the per-tx log), the failure-class columns (code 11 shows as `OTHER`) — none of
   them needs a re-run.
5. **Run E3a → E3b → ops** the same way as E1/E2 (host steps below; ≈ 20 h at 100 tx/s, §4).
   Start Claude Code with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` if it is to watch overnight
   (§7).

Host steps before every stage (they applied to the ramp, E1 and E2 as well):
1. **Free the host.** Best: **Restart** before each stage (Fast Startup is on, so a plain *Shut down*
   hibernates the kernel and keeps the leaked pool; to leave the laptop off overnight use
   `shutdown /s /full /t 0`; never sleep). Before each stage quit **Discord, Chrome, Roblox and
   Windows Widgets** (Widgets relaunches itself; also Steam, Epic, EA, Opera GX, OneDrive — they start
   at login), or turn hardware acceleration off in Discord and Chrome. Check in PowerShell:
   `Get-Counter '\Memory\Available MBytes','\Memory\Pool Paged Bytes' -SampleInterval 30 -MaxSamples 3`
   — several GB available and a paged pool of a few hundred MB that does not grow across the samples.
2. **Windows Update is paused until 2026-10-22 14:49 UTC and Store auto-updates are off (§2).**
   Before each stage check that the pause still covers it; extend it if E3 will run past 10-22.
3. **Start Docker Desktop** (`docker desktop start`, or the Start menu), then check
   `wsl -d Ubuntu-22.04 -u root --exec bash -lc "docker info --format '{{.ServerVersion}}' && docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -cE '^(gleipnir-|hyperledger/fabric|alpine)'"`
   → `27.5.1` and `15`. Do **not** start the stack and do not open `GLEIPNIR Web.cmd`. Then
   `git status -sb` in the repo root must read `## main...origin/main` with only
   ` M network/compose/.env` below it (plus `?? docs/results/` while the report tables stay
   uncommitted); commit + push anything else first.
4. **Charger in, lid open,** the laptop otherwise idle while a stage runs (the resource monitor only
   sees the benchmark containers).
5. **Run the stage** from the Bench app (`pyw -3.11 orchestration\benchapp.pyw` from the repo root):
   *E3 main* → select the mode (the tab opens on *E3a*) → *Preview plan* (check the run count: e3a
   12, e3b 72 with `channels_max` 50, ops 12) → the E3 tab's yellow "still PLACEHOLDER" banner must be
   gone → *Run…* (its "Baselines used" lines must carry no `[PLACEHOLDER …]` tag) → tick **skip the
   backup** (the
   ledger holds benchmark data, app origin `benchmark:e2@…`; the fixture's trails are in
   `backups/20260930-134117`, and every run since then went through `benchcore`'s own bookkeeping)
   → *Start*. The overnight driver of 2026-10-01 chained stages the same way headlessly; it lived in
   a session scratchpad and is not in the repo (§1).
6. **Still open from the ramp step:** the off-machine copy target (deferred by the author) for
   `backups/20260930-134117/`, `network/organizations/`, `benchmark/results/` and
   `benchmark/traces/` — the night's E1/E2 results exist only on this laptop.

## 4. Run order and what each stage writes

| Stage | Runs | Realistic time* | Writes / gate |
|---|---|---|---|
| E0 re-smoke | 4 | done 2026-09-30 (28 min) | passed: 0 failures on all four variants on `542c125` (smoke, never benchmark data) |
| ramp (E0) | 4 | **done** 2026-10-01 (1 h 26 min) | no saturation ≤ 200 tx/s → `baseline.send_rate_tps` = 100 (`a730030`, pushed); trimmed grid not applied |
| E1 | 36 | **done** 2026-10-02 (5 h 33 min) | `baseline.batch_size` needs the replacement rule agreed with D (§5) → commit + push |
| E2 | 18 | **done** 2026-10-02 (≈ 4 h 25 min incl. one discarded attempt) | suggests `baseline.channels` 20 (median) / `channels_max` 50 → confirm with D → commit + push |
| **send to D** | — | — | variable table + three flowcharts with measured values, **before E3** (`docs/methodology/experiments.md` §2, §6) |
| E3a | 12 | ≈ 4–5 h | scalability vs send rate (the grid must keep ≥ 5 levels or Parallel runs sub-floor; it does not bracket saturation yet — §5) |
| E3b | ≤ 72 | ≈ 13–14 h | scalability vs cases, trimmed to `channels_max` |
| ops | 12 | ≈ 2 h | per-operation breakdown; writes and reads in separate tables |

\* E3 times are projected at the 100 tx/s baseline from the measured E1/E2 run times (E1 ≈ 9 min
per run at 20 cases; E2 ≈ 15–23 min per run from 30 to 50 channels, resets ≈ 10 s per channel
included; E3b's Parallel cells are E2's own, the single-channel variants ≈ 4–5 min + 11 s per
case): ≈ 20 h for E3 in all. `--resume` (the app's Resume) skips complete runs after an interruption; Docker Desktop
must be started by hand first.

`e3a-saturation.json`, the mean ± SD tables and the charts are written by `report.py` (the app's
*History & results* → pick one experiment → *Generate tables + charts*, or
`py -3.11 orchestration/report.py --exp <E>` from the repo root) into `docs/results/<exp>/`, which is
not gitignored — do not commit it together with `sweeps.yaml`.

## 5. Open decisions

- **The WSL VM's wall clock drifted under load (found 2026-10-02 — investigate before E3).**
  Caliper's 5 s progress lines arrive ≈ 3.7 s apart in ≈ 1 of 6 intervals (ramp 131/726, E1
  271/1,620, E2 193/1,195; none in the 2026-09-30 E0 re-smoke, 0/33): the VM clock ran ≈ 4–5 % fast
  and was stepped back ≈ 1.3 s about every 27 s, agreeing with Windows on average. Effects in the
  data: per-tx latency < 0 in 178 of 298 rounds (ramp 22/28, E1 82/180, E2 74/90; down to
  −1,230 ms; 0/15 in E0), so every table's minimum latency is negative; the anchoring-delay
  minimum is negative in most anchored runs. Means should be close (the drift and the steps roughly
  cancel — reasoned, not measured); p95 and per-round throughput carry a few % of bias/noise. At
  idle in a fresh VM (2026-10-02, 60 s, clocksource `tsc`, `hyperv_clocksource_tsc_page`
  available) the clock kept time to 16 ms with no steps, so it appears under load — the July notes
  also saw negative minimum latencies. Before E3: reproduce under load, find the cause, and decide
  with D how E1/E2 latencies are reported; a clocksource or `.wslconfig` change would make E3
  incomparable with E1/E2 unless they are re-run.
- **E1's batch-size rule selects nothing — measured (with D, before taking E1's baseline).** §4.1
  wants a ≤ 5 % change in on-chain bytes/event to the next level; measured steps are 47–60 %
  (Anchoring 424.0 / 170.6 / 88.0 / 46.2 / 24.5 B/event at N = 10 / 25 / 50 / 100 / 200;
  Parallel-Anchored 434.8 / 175.7 / 90.5 / 47.1 / 23.5; Standard 4,009.6, Parallel 4,024.7), so the
  app offers no *Use as baseline* button. What the candidate rules pick from the same runs (mean of
  3, both variants agree): **absolute saving** to the next level < 5 % of Standard's 4,009.6 B
  (≈ 200 B) → **25** (10→25 saves 253/259 B, 25→50 saves 83/85 B; throughput flat at 100.1 TPS,
  audit ratio 0.78/0.66 ≤ 1.5); **total on- + off-chain bytes** → minimum at **25**, tied with 50
  (Anchoring 1,522 / 1,380 / 1,383 / 1,429 / 1,493 B; Parallel-Anchored 1,559 / 1,409 / 1,410 /
  1,454 / 1,514 B); **anchoring delay** as the counter-metric → depends on D's bound (Anchoring
  0.6 / 1.3 / 1.6 / 2.0 / 2.9 s; Parallel-Anchored 2.1 / 4.6 / 8.6 / 15.9 / 27.9 s — all-batches
  means, see the delay bullet below). Audit time per case falls with N (Anchoring 2.41 → 0.58 s;
  Parallel-Anchored 0.60 → 0.27 s; Standard 0.084 s).
- **E2's healthy range is the whole grid — measured (with D, before E2's baseline).** All six levels
  pass §4.2 (failure ≤ 0.07 %, summed container CPU 32–73 % against a 2,880 % budget, no memory
  term), so the rule suggests `baseline.channels` 20 (median) and `channels_max` 50 by construction
  ("still healthy at the top of channel_counts"). Parallel at 100 tx/s, 5 → 50 channels: throughput
  84.8 / 92.4 / 96.0 / 97.3 / 97.9 / 98.3 TPS (rising — the end-of-round drain, next bullet), latency
  avg 0.33 → 1.24 s and p95 0.68 → 2.09 s (block-cut by the 2 s timer once channels > send rate ÷ 5,
  methodology §7), memory 0.56 → 1.86 GB.
- **Drain-free throughput — now measured as a real effect on E2 §4.2(a).** Caliper's throughput
  window includes the ≤ 2 s end-of-round block wait. E2's rounds are cases × 224 tx (1,120 tx ≈ 11 s
  at 5 channels), so Parallel reads 84.8 TPS at 5 channels vs 98.3 at 50 and the "non-declining"
  test passes trivially; the E1 Parallel reference reads 96.1 vs Standard 99.9 TPS at 20 cases.
  `collect.py` computes no drain-free rate yet (the tx logs keep tCreate/tFinal) — decide before
  reporting E2 §4.2(a), E3a's top levels on Parallel and E3b cross-variant throughput.
- **E3a's send-rate grid does not bracket saturation (with D).** §4.3 wants ≥ 2 levels below and
  ≥ 1 above the saturation point, but nothing saturated up to 200 tx/s (the app's note: "extend
  send_rates_tps upward"); the trimmed-grid suggestion equals the full grid and was not applied.
  Options: extend the grid upward for E3a (e.g. 300, 400 tx/s — still 12 runs, one more round per
  added level; untested above 200 tx/s, so not known to bracket saturation either; and `HEAD_GAP`
  = 110 in `benchmark/trace/generate.js` is sized for a 200 tx/s top — raising it changes every E3
  trace and its head-op spacing vs E1/E2, a CONTRACTS §12-22 change, while keeping it leaves the
  trace race unmodelled above 200), or keep [10 … 200] and report "no saturation within the tested
  range", stating Standard's p95 rise at 200 (188 → 629 ms) as an observation — `report.py`'s knee
  rule flags no knee for any variant on the ramp data.
- **Caliper's round summary sometimes misses a few late completions.** In 7 of 298 rounds (ramp
  2/28, E1 4/180, E2 1/90; any variant), `succ` + `fail` is up to 8 tx below the per-tx log's count
  (e.g. E1 `anchoring/batch10…/r0` slice4: `succ` 4,472, per-tx log `ok` 4,480). The per-tx log is
  complete. The count is ≤ 0.18 % low, but Caliper's window also stops before those transactions
  (0.4–0.9 s shorter), so throughput reads 0.4–1.4 % HIGH in those rounds (e.g. 99.9 vs 98.9 TPS
  from the per-tx log's `ok` ÷ `windowS`; other rounds agree within ±0.05 %). Decide whether
  `collect.py` should take the count AND the window from the per-tx log (the count alone would
  inflate it further).
- **Failure-class columns.** Every failure in the campaign is Fabric validation code 11
  (= `MVCC_READ_CONFLICT`) per the `caliper.log` scan (`fabricStatusCodes`), but the per-tx-log
  class columns file them as `OTHER` (the connector sets no per-tx error; CONTRACTS §10 keeps the
  scan alongside, never merged). Map or footnote this before the failure-class tables are reported.
- **Anchoring delay in the tables** uses the all-batches mean (`report.py`), which includes forced
  batches (methodology §2.3 says they are excluded) and batches left open across the idle gap
  between rounds. Recomputable from each run's `anchoring.json`; fix `report.py` before reporting.
- **With D, before E3 (E1 and E2 already ran on these unconfirmed defaults, at 100 tx/s):** the
  calibration thresholds (§4.1–4.3) — including the authors' no-saturation rule behind
  `baseline.send_rate_tps` = 100 (§3 step 1: record it first; a different send rate from D means
  re-running E1 and E2, ≈ 10 h) — r = 3 mean ± SD, the §8 defaults (incl. #13: E0 derives no channel
  count), and the two contradictions of D's 10 Sep assumptions: **AccessLog is a WRITE**, **the N
  and K grids are unified**.
- **With the lecturer:** whether the **off-chain B/event** metric stays in the tables.
- **Variant chip in the SPA:** still skipped; needs an nginx route to the gateway's `/healthz`
  (a CONTRACTS change). The Merkle verify controls work without it.
- **Small UI quirk:** after a manual "Log access", the on-chain custody list does not refresh until
  the page reloads.
- **Design assets still owed by the designers:** brand mark (direction A is the placeholder),
  exports and the final favicon, lead and admin screens, the other Bench tabs, the court report,
  sample thesis figures. Brief: `docs/design/GLEIPNIR-design-brief.md`; boards: `docs/design/claude-design/`.

## 6. Not exercised live (residual risk)

- Exercised live since 2026-10-01: the new generator (rule e) and the audit warm-up at campaign scale
  (ramp up to 200 tx/s, E1, E2); E2 at 40 and 50 channels (failure ≤ 0.005 % per run — cell means
  0.002 % at 40 and 0 % at 50 channels; summed container memory ≤ 1.9 GB).
  The trace race stayed within its model: 0.009 % on the E1 Parallel references, 0.065–0.068 % at
  5–10 channels and ≤ 0.007 % at 20–50 channels in E2 (Fabric code 11 = `MVCC_READ_CONFLICT` per the
  `caliper.log` scan; the per-tx-log class columns show them as `OTHER` — §5).
- The Bench app's own Run → backup → restore dialogs. The 2026-09-30 backup and every run since were
  driven with the same `benchcore` scripts and bookkeeping (`backup.json`, `state.json`) outside the GUI.
- E3a/E3b/ops plans at the final baselines (only their dry-runs at the placeholders exist).
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
- **Unattended stages from Claude Code:** launch a driver as a plain background process
  (`Start-Process pyw.exe …`) — Claude Code's auto mode refuses scheduled tasks (persistence). Let
  `experiment.py` write its log itself inside WSL (`> log 2>&1`), never through a pipe to the driver:
  a broken pipe kills the run, a file lets the run survive the driver. Claude Code also kills its own
  background watchers when Windows memory runs low (4× on 2026-10-02; the WSL page cache does it) —
  start it with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` for an overnight watch.
