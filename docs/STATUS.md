# GLEIPNIR — Status & Handoff

> **One living file.** Update it in place at the end of every working session. Do not add dated
> `handoff-YYYY-MM-DD.md` files; the last two (2026-09-25, 2026-09-26) are in git history before
> this file existed. *What* changed and *why* lives in `docs/CONTRACTS.md` §12 (decision record)
> and `git log`; this file only says where things stand and what comes next.

**Last updated:** 2026-10-05, ~08:15 (end of the campaign-2 session; handoff committed).

**Campaign 2 is DONE (2026-10-03 23:28 → 2026-10-05 06:05, unattended):** E1 → E2 → E3a → E3b → ops,
150/150 runs, each on its first attempt, at campaign 1's settings (no ramp — the authors' choice;
baselines held at 100 / 50 / 20 / 50, nothing applied from E1/E2; every run on `772b00d`, sweeps blob
`e7d3f72`; the 138 E1–E3b runs trace-identical to campaign 1's run of the same name, ops with no trace
but identical rounds). 138 failures, all Fabric code 11 (E1 3, E2 54, E3a 21, E3b 60, ops 0). **The two
campaigns are kept apart, never combined — one folder each:** campaign 1 in
`benchmark/results/campaign1-20261003/` (ramp → ops; its E0 re-smoke stays in `benchmark/results/e0/`,
log in `benchmark/results/benchapp-logs/`) + `docs/results/campaign1-20261003/`, campaign 2 in
`benchmark/results/campaign2-20261005/` + `docs/results/campaign2-20261005/`; their records are
`docs/reviews/campaign-1-settings-environment-2026-10-03.md` and
`docs/reviews/campaign-2-run-record-2026-10-05.md`. The canonical `benchmark/results/{ramp,e1,e2,e3a,e3b,ops}/`
and `docs/results/<exp>/` are gone (only `benchmark/results/e0/` remains), so the Bench app finds no
ramp–ops results of either campaign (per-round view, exports, *Generate tables + charts* and the
E0/E1/E2 baseline suggestions all come up empty). Its *History & results* list still shows every run of
both campaigns, because `benchmark/results/runlog.jsonl` keeps all 322 lines (E0 16, campaign 1's
ramp–ops 156, campaign 2's 150). **The WSL VM clock misbehaved in both campaigns, in opposite
directions:** campaign 1's ran fast and was stepped back (≈ 1–2.3 s), campaign 2's ran ≈ 5 % slow and was
stepped forward (≈ 1–2 s, about every 30 s in E1–E3b; a single step in ops' 55 progress intervals) — see
§5 and the campaign-2 record §5. Regenerate a campaign's tables only with both flags, because `--out`
does not follow `--results` (`report.py` also rewrites `<exp>-results.csv` inside the campaign folder it
reads): `py -3.11 orchestration/report.py --exp X --results benchmark/results/campaign<N>-<date> --out docs/results/campaign<N>-<date>/X`.
Committed with this handoff (by path): `README.md`, `docs/STATUS.md` and both records. Not in it: the
tables in `docs/results/` (untracked) and `network/compose/.env` (every run rewrites it; never commit
it). Push `main` before any further run (§1, §3 host step 3).

**Campaign 1 (2026-10-01 → 10-03) — E3 is complete, the whole campaign has run:** the ramp (2026-10-01, on `4c44618`) → E1 → E2 (2026-10-01/02, on `a730030`, the commit that
set the ramp's 100 tx/s baseline), then the E3 baselines committed and pushed as `9459fd7` (send
rate 100 tx/s, batch 50 — the authors' choice, channels 20 / channels_max 50 from E2) and **E3a
12/12 (2026-10-02), E3b 72/72 and ops 12/12 (2026-10-03)**, every E3 run on `9459fd7`. No variant
saturates within 10–200 tx/s (E3a); E3b's one failed attempt (a network reset at 50 channels) was
re-run automatically with `--resume`; ops had 0 failures. E3 ran **before** the D package was sent
(the authors' decision, 2026-10-02) and with no clocksource or `.wslconfig` change, but **the WSL
clock did not behave the same throughout**: E3a's clock steps (≈ 1.2 s) matched E1/E2's, E3b's
first 58 runs had steps of ≈ 2.3 s that bias their throughput and latency (Standard rounds with a
step read as low as 84 TPS), and there were no steps from 2026-10-03 ≈ 10:56 on — the last 14 E3b
runs and all of ops (§5). Everything is shut down; tables + charts for E1, E2, E3a and E3b and the
ops tables are in `docs/results/campaign1-20261003/` (untracked; the ramp has only
`benchmark/results/campaign1-20261003/ramp/ramp-results.csv`).

**Next action: §3 — record the decisions, fix the report columns, decide with D how the
clock-affected rounds are reported, send D the package, then the final Restore.**

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
- **Overnight campaign 2026-10-01/02 (`benchmark/results/campaign1-20261003/{ramp,e1,e2}/` since
  2026-10-03, gitignored — local only):**
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
    failures. Results in §5; tables + charts by `report.py` in `docs/results/campaign1-20261003/e1/`
    and `…/e2/` (untracked; not committed).
  - Driven headless by a driver outside the repo: the Bench app's exact argv, WSL script and
    bookkeeping via `benchcore`, plus the authors' go-ahead (accept the ramp's suggestion iff
    25–100 tx/s; no saturation → 100), backup skipped as §3 allowed. That version is kept as
    `C:\Users\LENOVO\gleipnir-driver\overnight-2026-10-01.py` (with its log).
- **`9459fd7`** "E1/E2 baselines: batch_size 50 (set by hand), channels 20 / channels_max 50 (set
  from E2)" — values unchanged, only the three provenance tags in `sweeps.yaml`; pushed 2026-10-02.
  The E3a grid `send_rates_tps` stayed [10 … 200]. **No baseline is a PLACEHOLDER any more.**
- **E3 campaign 2026-10-02/03 (`benchmark/results/campaign1-20261003/{e3a,e3b,ops}/` since 2026-10-03,
  gitignored — local only).** Every run records commit `9459fd7`, sweeps blob `e7d3f72`, host memory
  9.7 GB. Driven by `C:\Users\LENOVO\gleipnir-driver\overnight-e3-2026-10-02.py` (named `overnight.py`
  until 2026-10-03 — that name now holds campaign 2's driver; this file is the 2026-10-01 driver with stages e3a → e3b → ops,
  no commit logic, refuses PLACEHOLDER baselines; reviewed before launch), backup skipped as before:
  - **E3a** (12 runs, 4 h 06 min, 2026-10-02 13:28–17:34). Throughput ÷ send rate at 200 tx/s:
    Standard 0.98 / 0.99 / 1.00, Anchoring 1.00 ×3, Parallel 0.92 / 0.92 / 0.96, Parallel-Anchored
    1.00 ×3 — **no saturation and no p95 knee** for any variant (`report.py`). 21 failures, all in the
    200 tx/s rounds (Standard 8, Parallel 13). Parallel's latency falls as the rate rises (≈ 1.5 s avg
    at 10 tx/s → ≈ 0.55 s at 200 — the 2 s block timer at 20 channels). The author stopped the driver
    at 13:50 so that only E3a ran that day; the running stage finished by itself.
  - **E3b** (72 runs, 13 h 14 min, 2026-10-03 01:46–15:00). At 14:16 the network reset before
    `e3b/parallel-anchored/batch50-ch50-cases50/r1` failed (`peer lifecycle chaincode install`: the
    endorser client could not connect to peer0.org1:7051); the driver re-ran with `--resume` at 14:17
    (70 complete, 2 to run) — nothing measured was lost. 57 failures (Standard 8, Parallel 49), none on
    the anchored variants. **The 5–40-case cells ran with the larger ≈ 2.3 s clock steps and the
    50-case cell without (§5), so per-round throughput and latency are not directly comparable
    across E3b's cells.** 5 → 50 cases (mean of 3): Parallel throughput 86.1 → 98.2 TPS (the drain as
    in E2, plus the clock steps), latency avg 0.33 → 1.28 s, memory 0.56 → 1.87 GB; Standard 95.6 →
    100.0 TPS (the clock steps: the step-free rounds read 99.4–100.1 TPS — at 5, 10 and 50 cases; the
    20–40-case cells had none), 0.10–0.12 s;
    anchored ≈ 100 TPS, ≈ 0.01 s (enqueue). On-chain B/event: Standard
    ≈ 4,008, Parallel 4,011 → 4,137 (rises with channels), Anchoring ≈ 88, Parallel-Anchored
    91.7 → 90.3. Audit time per case: Anchoring 0.59 → 1.90 s (rises with cases), Parallel-Anchored
    ≈ 0.33 s (flat), Standard/Parallel ≈ 0.08 s. Anchoring delay (all-batches mean, §5): Anchoring
    2.0 → 1.5 s, Parallel-Anchored 5.4 → 16.1 s.
  - **ops** (12 runs, 3 h 04 min, 2026-10-03 15:01–18:05, sub-floor by design, no clock steps):
    **0 failures.** Write rounds: Standard ≈ 99.5 TPS / 0.12 s, Parallel ≈ 66 TPS / 0.92 s (a 400-tx
    round sends for 4 s and its last blocks wait for the 2 s timer — the drain, §5), anchored ≈ 101
    TPS / 0.01 s; reads (`read-evidence`, `read-trail`) and the anchored `verify-event` ≈ 0.01 s
    everywhere. Most of each Standard/Parallel ops run is untimed set-up (e.g. Caliper ran 225 s for
    the 4 s timed Standard `transfer` round), hence 22–26 min per run against 5–9 min on the
    anchored variants.
  - Every failure in E3 is Fabric code 11 (`MVCC_READ_CONFLICT`) per the `caliper.log` scan — the
    trace race, within its model. Tables + charts: `docs/results/campaign1-20261003/{e3a,e3b}/`; ops tables only
    (`ops-writes`, `ops-reads`; `report.py` draws no ops charts) — all untracked.
- **Campaign 2 (2026-10-03 23:28 → 2026-10-05 06:05, `benchmark/results/campaign2-20261005/`, gitignored —
  local only):** the re-run of E1 → E2 → E3a → E3b → ops at campaign 1's settings (no ramp, the authors'
  choice), 150/150 runs on `772b00d` (the code of `9459fd7` plus a STATUS commit), one attempt each,
  driven unattended by `overnight.py` with campaign 1's argv and run order. 138 failures, all code 11
  (E1 3, E2 54, E3a 21, E3b 60, ops 0). Tables + charts in `docs/results/campaign2-20261005/`
  (untracked). Its provenance, environment, clock condition per stage and results are in
  `docs/reviews/campaign-2-run-record-2026-10-05.md`, kept separate from campaign 1 (no combined tables).

## 2. Environment (checked 2026-09-30; updated 2026-10-05)

| Item | State |
|---|---|
| Docker Desktop | 4.38.0, engine 27.5.1 (CLAUDE.md pins 29.5.2 — known since July; keep it fixed for the whole campaign, never accept an update mid-campaign). Does **not** auto-start after a reboot; `docker desktop start` / `stop` work from PowerShell |
| WSL | 2.4.12 (a Store app). **`%USERPROFILE%\.wslconfig` = `[wsl2]` `memory=10GB` since 2026-09-30** (MemTotal 9.7 GiB, 32 CPUs). Never change it before the campaign ends: `run.json` records `host.memGb` |
| Live stack | **Everything off** (2026-10-05 ~06:20, after campaign 2): containers down (plain `down.sh`, 0 containers, the 11 `gleipnir_*` volumes kept), Docker Desktop stopped, WSL shut down. The ledger volumes hold **ops benchmark data** (app origin `benchmark:ops@20261005-024858` in `backups/state.json`; the last network was Parallel-Anchored at 20 channels). `network/compose/.env` shows as modified — runs rewrite it; never commit it. The fixture's custody trails (ledgers, receipts) are only in the backup until the final Restore; its accounts, cases and files stay in the library volumes, which resets never touch |
| Host memory | **Discord and Chrome leak GPU memory.** 2026-09-30 15:05: 0.7 GB of 15.7 GB free, commit 35/36.5 GB, kernel paged pool 7.5 GB growing ≈ 60 MB/min with the benchmark stopped — pool tag `Vi54` (dxgkrnl video memory manager) 5.9 GB; GPU committed memory Discord 3.8 GB (+17 MB/30 s), Chrome 0.83 GB (+24 MB/30 s). Likely the same mechanism as the 0x10E/0x119 graphics blue screens. With WSL at 10 GB, Windows has only ≈ 5.7 GB — close them before every stage (§3). **2026-10-01/02 (both closed):** paged pool steady at 0.82–0.90 GB all night; Windows "available" still fell to 0.5–2 GB during runs because the WSL VM's Linux page cache held `vmmem` at 5–6.5 GB (inside the VM 6.7 GB stayed available; paging stayed low, ≤ 31 pages/s at the checks). Closing Windows Widgets freed ≈ 2 GB once (it relaunches itself). **2026-10-02/03 (E3, both closed):** paged pool flat at 0.87–0.99 GB; Windows "available" fell to **0.42 GB** (2026-10-03 05:19, Parallel at 20 cases) and below 1.5 GB at 10 of the 26 half-hourly E3b checks, the WSL VM holding up to 6.4 GB (page cache; 6.4–6.8 GB available inside the VM at the two checks that looked); commit charge ≤ 23.7 of 31.7 GB; one burst of 11,000–16,000 pages/s (03:49), ≤ 400 pages/s at the other checks. No run failed for it. **2026-10-03/05 (campaign 2; Discord and Chrome not running; Roblox, Edge, WhatsApp, Spotify, Widgets, OneDrive sync and Settings closed at the start — WhatsApp, Widgets and OneDrive relaunched themselves and were closed at the 30-min checks; Phone Link was first closed at 2026-10-04 08:19, to relieve memory, and at each check after that):** paged pool flat at 0.86–1.05 GB; "available" mostly 0.5–3 GB, lowest **0.20 GB** (2026-10-04 08:17, E2 at 50 channels, 2–3 k pages/s) until closing Phone Link brought it to ≈ 0.7 GB; momentary paging bursts during the 50-channel network resets. No run failed for it |
| Backups | **`backups/20260930-134117` "before ramp" (ledger held: test data) — the one to restore after the campaign.** `backups/20260926-202333` "before ponytail live test" is older: never restore it |
| Images | All 15 present: the 10 `gleipnir-*`, `fabric-{peer,orderer,tools}:2.5.15`, `fabric-ca:1.5.19`, `alpine`; npm layers non-empty. Never rebuild or pull once the ramp has started (`run.json` records no image IDs) |
| Proxy CA bundle | `C:\Users\LENOVO\gleipnir-ca-bundle.crt`, regenerated 2026-09-26 (110 certs; the Avast Web/Mail Shield root). Regenerate after a proxy change from `Cert:\LocalMachine\Root, Cert:\CurrentUser\Root, Cert:\LocalMachine\CA, Cert:\CurrentUser\CA`, de-duplicated by thumbprint |
| Fixture | The authors' manual test data (13 users, 8 cases, 24 exhibits); survived the 2026-09-29 crash (checked 2026-09-30 via the service token + `/audit`: 8 cases, `coc-main` height 218, `ev-njr-001` 1 CREATE / 0 ACCESS); since the E0 re-smoke its ledger part exists only in `backups/20260930-134117` |
| Crypto material | `network/organizations/` complete for org1, org2, orderer **and** the anchor org — gitignored and in no volume backup; a restored ledger only works with these certificates |
| WSL toolchain | node 20.19.6, Caliper 0.6.0 bound `fabric:fabric-gateway` (fabric-gateway 1.5.0), Python 3.10 + PyYAML, fabric-ca-client 1.5.19, jq, curl. matplotlib only on the Windows host |
| Host | i9-13900HX, 24 physical / 32 logical cores, ≈ 248 GB free on C:. **Fast Startup is on**, so Start → *Shut down* hibernates the kernel session (keeps leaked kernel memory, uses the hibernate path that crashed twice) — use *Restart*, or `shutdown /s /full /t 0` to power off |
| Power | Legion Balance Mode. On AC: never sleeps or hibernates, lid does nothing (lid action re-checked 2026-10-02: AC 0 = do nothing, DC 1 = sleep). **On battery: hibernates after 3 h, closing the lid sleeps.** The 2026-09-29 17:31 crash was a blue screen (0x3B) while the laptop was put to sleep with the WSL2 VM up; 09-21 and 09-24 crashed mid-hibernate; the July campaign loss (07-22) was a GPU-driver blue screen |
| Windows Update | **Paused until 2026-10-22** (set 2026-10-01 in `HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings`, `Pause*` values — what Settings → Pause writes) and Microsoft Store automatic app updates **off** by policy (`HKLM\SOFTWARE\Policies\Microsoft\WindowsStore` `AutoDownload`=2; WSL is a Store app). E3 finished on 10-03 and campaign 2 on 10-05, inside the pause. After the final Restore (or whenever the authors close the campaign): Settings → *Resume updates* and delete that `AutoDownload` value |
| Windows Python | 3.11.9 with tkinter, PyYAML, matplotlib — the Bench app runs |

## 3. Start of the next session (campaign 2 done)

Done: ramp (on `4c44618`) → baseline 100 tx/s (`a730030`) → E1 → E2 (2026-10-01/02) → E3
baselines (`9459fd7`) → E3a (2026-10-02) → E3b → ops (2026-10-03), all complete and pushed where a
commit was involved — then campaign 2, the separate re-run of E1 → ops (2026-10-03/05, on `772b00d`;
`benchmark/results/campaign2-20261005/`, `docs/results/campaign2-20261005/`). Campaign 1's tables +
charts for E1, E2, E3a and E3b and the ops tables are in `docs/results/campaign1-20261003/`, campaign 2's
in `docs/results/campaign2-20261005/` (both untracked — commit them only if the authors want them in the
repo, never together with `sweeps.yaml`; campaign 1's ramp has only
`benchmark/results/campaign1-20261003/ramp/ramp-results.csv`, gitignored).

Next, in this order:
1. **After campaign 2** (done 2026-10-05, see *Done* above; record
   `docs/reviews/campaign-2-run-record-2026-10-05.md`). The two campaigns stay separate. Optional, only
   if the authors want it: a cell-by-cell comparison of the two folders (every E1–E3b cell is
   trace-identical, every ops cell round-identical). `C:\Users\LENOVO\gleipnir-driver\replication.py`
   cannot make it: it compares stages within one tree (E1/E2 vs E3b, ramp vs E3a) and reads the live
   `benchmark/results/`, which no longer holds those stages — the comparison needs a new script or a
   two-root, same-stage mode. Before any further run: `benchmark/results/{ramp,e1,e2,e3a,e3b,ops}/` are
   gone, so those stages need no renaming; but `benchmark/results/e0/` still holds campaign 1's E0
   re-smoke under the same run ids (a `--resume` plan counts them complete and skips a new E0; *Run…*
   deletes them) — rename it before any E0 run. New runlog lines go to the shared
   `benchmark/results/runlog.jsonl` (322 lines now), so a new campaign's own runlog must again be cut
   from its tail. Its driver needs `STAGES`/`EXPECTED_RUNS` set as in campaign 2's.
2. **Record the decisions** in CONTRACTS §12 (decision record) and the methodology: the authors'
   no-saturation rule (2026-10-01: no variant saturates up to the top level → ½ × the top level →
   100 tx/s; methodology §4.3), the batch size (2026-10-02: §4.1 selects no level → the authors chose
   50, total on- + off-chain bytes within 0.2 % of the N = 25 minimum; methodology §4.1), E3 run
   before the D package (2026-10-02), campaign 2 (2026-10-03: a re-run of E1 → ops at campaign 1's
   settings, no ramp, kept apart and never combined — today only in this file and its record), plus
   §8 rows for D. Today the no-saturation rule lives only in the `a730030` message and the send-rate
   tag, the batch choice only in the `9459fd7` message and the `batch_size` tag, and the E3-before-D
   decision only in this file. Methodology §4.3 and `report.py` still give 200, so the Bench app's
   E0 tab offers **Use 200 tx/s as baseline…** whenever a non-saturating ramp is under
   `benchmark/results/ramp/` (none is now — campaign 1's moved to `campaign1-20261003/`) — never click it.
3. **Fix before reporting** (§5): drain-free throughput (E2, E3a's top levels on Parallel, E3b
   cross-variant, ops Parallel writes), the anchoring-delay column (forced batches, idle gaps),
   Caliper's dropped first transactions (31 of 820 rounds, ramp–E3 — neither Caliper's figures nor
   the per-tx log's `ok` ÷ `windowS`, which includes the gap after them, can be used as is), the
   failure-class columns (code 11 shows as `OTHER`), and how the clock-step rounds are reported —
   above all campaign 1's E3b 5–40-case cells and campaign 2's E1–E3b (forward steps throughout; §5,
   first bullet). None of them needs a re-run; regenerate both campaigns' tables afterwards
   (`--results` and `--out`, §4).
4. **Send D the variable table + the three flowcharts with the measured values**
   (`docs/methodology/experiments.md` §2, §6 — it was the supervisor's gate before E3; E3 ran first,
   by the authors' decision), with the open questions of §5: the send-rate rule (a different send
   rate means re-running E1, E2, E3b and ops, ≈ 26 h; E3a sweeps the send rate itself), batch 50,
   channels 20 / 50, E3a reported as "no saturation within 10–200 tx/s" (or an extended grid =
   re-run E3a, ≈ 4 h), the VM clock in both campaigns (campaign 1's stepped back ≈ 1–1.5 s, ≈ 2.3 s in
   E3b's 5–40-case cells; campaign 2's stepped forward ≈ 1–2 s throughout E1–E3b, every E3b cell
   included — so a re-run on this VM is no assured remedy while the cause is unknown: which campaign
   is reported, and with what caveat), and the two contradictions of D's 10 Sep assumptions (AccessLog is a
   WRITE; the N and K grids are unified).
5. **Final Restore** when the authors close the campaign: Bench app → *Restore my test data* →
   `backups/20260930-134117` "before ramp" (stack stopped; never `up.sh` afterwards). Then Windows
   Update → *Resume updates* and delete the Store `AutoDownload` policy value (§2). A later re-run
   backs up first (the app does it unless *skip the backup* is ticked).
6. **Off-machine copy (still open, deferred by the author):** `backups/20260930-134117/`,
   `network/organizations/`, `benchmark/results/` (now `campaign1-20261003/` — ramp → ops — and
   `campaign2-20261005/` — E1 → ops — plus campaign 1's E0 re-smoke in `e0/` and `runlog.jsonl`),
   `benchmark/traces/`, both campaigns' untracked tables in `docs/results/` and
   `C:\Users\LENOVO\gleipnir-driver\` (the drivers, their `overnight*.log` and status files,
   `clockscan.py` / `c2facts.py` — cited by this file and both records) exist only on this laptop.
7. **Optional hardening (after the campaign):** a peer readiness wait before the chaincode install in
   the reset path (§5, reset race).

Host steps before any further stage or re-run (they applied to the ramp, E1, E2, E3 and campaign 2):
1. **Free the host.** Best: **Restart** before each stage (Fast Startup is on, so a plain *Shut down*
   hibernates the kernel and keeps the leaked pool; to leave the laptop off overnight use
   `shutdown /s /full /t 0`; never sleep). Before each stage quit **Discord, Chrome, Roblox and
   Windows Widgets** (Widgets relaunches itself; also Steam, Epic, EA, Opera GX, OneDrive — they start
   at login; Edge, WhatsApp, Spotify and Phone Link too — during campaign 2 WhatsApp, Widgets and
   OneDrive relaunched themselves and were closed at the checks, and Phone Link from 2026-10-04 08:19
   on, after Windows "available" fell to 0.20 GB), or turn hardware acceleration off in Discord and
   Chrome. Check in PowerShell:
   `Get-Counter '\Memory\Available MBytes','\Memory\Pool Paged Bytes' -SampleInterval 30 -MaxSamples 3`
   — several GB available and a paged pool of a few hundred MB that does not grow across the samples.
2. **Windows Update is paused until 2026-10-22 14:49 UTC and Store auto-updates are off (§2).**
   Before each stage check that the pause still covers it; extend it if a re-run goes past 10-22.
3. **Start Docker Desktop** (`docker desktop start`, or the Start menu), then check
   `wsl -d Ubuntu-22.04 -u root --exec bash -lc "docker info --format '{{.ServerVersion}}' && docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -cE '^(gleipnir-|hyperledger/fabric|alpine)'"`
   → `27.5.1` and `15`. Do **not** start the stack and do not open `GLEIPNIR Web.cmd`. Then
   `git status -sb` in the repo root must read `## main...origin/main` with only
   ` M network/compose/.env` below it (plus `?? docs/results/` while the report tables stay
   uncommitted); commit + push anything else first.
4. **Charger in, lid open,** the laptop otherwise idle while a stage runs (the resource monitor only
   sees the benchmark containers).
5. **Run the stage** from the Bench app (`pyw -3.11 orchestration\benchapp.pyw` from the repo root):
   select the tab and the mode (E0 reopens on *smoke test*, E3 on *E3a*) → *Preview plan* (check the
   run count) → *Run…* (its "Baselines used" lines must carry no `[PLACEHOLDER …]` tag) → tick **skip
   the backup** only while the ledger holds benchmark data and the fixture's trails are in
   `backups/20260930-134117` (i.e. before the final Restore) → *Start*. Headless alternative (only
   before the final Restore: it always skips the backup, and its preflight — and `--selftest` —
   refuse unless the ledger origin in `backups/state.json` starts with `benchmark`): the driver in
   `C:\Users\LENOVO\gleipnir-driver\` (§7), same argv, script and bookkeeping. It skips stages whose
   runs are all complete. `overnight.py` is campaign 2's version (stages E1 → E2 → E3a → E3b → ops, its
   git gate also admits uncommitted `docs/` and `README.md`); for another set of stages edit `STAGES` /
   `EXPECTED_RUNS` **and** the `STAGES` asserts at the end of `selftest()`, then `--selftest`,
   `--check`, launch.
6. **Rename a finished stage's folder before re-running any part of it** (§7: `e3a` →
   `e3a-superseded-<date>`), or move a whole campaign aside as done for campaigns 1 and 2
   (`benchmark/results/campaign<N>-<date>/<exp>`); the tables read every run under
   `benchmark/results/<exp>/`.

## 4. Run order and what each stage writes

| Stage | Runs | Realistic time* | Writes / gate |
|---|---|---|---|
| E0 re-smoke | 4 | done 2026-09-30 (28 min) | passed: 0 failures on all four variants on `542c125` (smoke, never benchmark data) |
| ramp (E0) | 4 | **done** 2026-10-01 (1 h 26 min) | no saturation ≤ 200 tx/s → `baseline.send_rate_tps` = 100 (`a730030`, pushed); trimmed grid not applied |
| E1 | 36 | **done** 2026-10-02 (5 h 33 min) | §4.1 selects no level → `baseline.batch_size` = 50, the authors' choice (`9459fd7`, pushed); thresholds still with D (§5) |
| E2 | 18 | **done** 2026-10-02 (≈ 4 h 25 min incl. one discarded attempt) | `baseline.channels` 20 (median) / `channels_max` 50 set from E2 (`9459fd7`, pushed); confirm with D |
| **send to D** | — | — | variable table + three flowcharts with measured values — **not sent yet**; E3 ran first by the authors' decision (§3 step 4) |
| E3a | 12 | **done** 2026-10-02 (4 h 06 min) | no saturation and no p95 knee within 10–200 tx/s for any variant (`e3a-saturation.json`); the grid does not bracket saturation (§5) |
| E3b | 72 | **done** 2026-10-03 (13 h 14 min, incl. one failed reset re-run by `--resume`) | scalability vs cases 5–50 (trimmed to `channels_max` 50) |
| ops | 12 | **done** 2026-10-03 (3 h 04 min) | per-operation breakdown, 0 failures; writes and reads in separate tables |

\* Measured wall time per run (`run.json` `wallSeconds`): E3a 18.3–19.1 min on the single-channel
variants, 22.1–22.7 min on the 20-channel ones (7 rounds each); E3b 4.3–7.8 min at 5 cases, rising
to 12.7–13.0 min (Standard, Anchoring) and 21.5–22.1 min (Parallel, Parallel-Anchored, resets
included) at 50 cases; ops 22.0–22.5 min (Standard), 25.4–25.6 (Parallel), 4.5–5.7 (Anchoring),
8.4–8.6 (Parallel-Anchored). `--resume` (the app's Resume) skips complete runs after an
interruption; Docker Desktop must be started by hand first.

The table above is campaign 1. **Campaign 2** (2026-10-03/05, on `772b00d`, no ramp): E1 36 runs in
5 h 33 min, E2 18 in 4 h 06 min, E3a 12 in 4 h 19 min, E3b 72 in 13 h 22 min, ops 12 in 3 h 16 min —
30 h 37 min for the chain, one attempt per run (its record §1).

`e3a-saturation.json`, the mean ± SD tables and the charts are written by `report.py` (the app's
*History & results* → pick one experiment → *Generate tables + charts*, or
`py -3.11 orchestration/report.py --exp <E>` from the repo root) into `docs/results/<exp>/`, which is
not gitignored — do not commit it together with `sweeps.yaml`. For an archived campaign pass both
`--results benchmark/results/campaign<N>-<date>` and `--out docs/results/campaign<N>-<date>/<E>`.

## 5. Open decisions

- **The WSL VM's wall clock drifted under load (found 2026-10-02 — cause still unknown; decide with
  D how the affected rounds are reported).** **Campaign 2 (2026-10-03/05) had the opposite condition:**
  no backward steps of ≥ 0.6 s (the 15 of 792 rounds with a negative per-tx minimum, down to −139 ms,
  show only small backward corrections), but forward steps (or stalls) of ≈ 1–2 s in about 1 of 5–7
  progress intervals in E1–E3b (E1 median 0.97 s → E3b 2.04 s, max 2.38 s; ops, with its 4 s rounds,
  shows 1 step in 55 intervals, but its per-tx logs show steps in 7 of 78 rounds), and at the end the
  VM's uptime read 105,370 s against ≈ 111,330 s of real time — the VM clock ran ≈ 5 % slow and was
  stepped forward, where campaign 1's ran fast and was stepped back. Effects in campaign 2: latency of
  transactions spanning a step inflated, Caliper catch-up bursts, low reads of short Standard rounds but
  high reads of two short Parallel write rounds (ops), almost no negative minima and no dropped first
  transactions (0/792 rounds). Details: the campaign-2 record §5;
  `C:\Users\LENOVO\gleipnir-driver\clockscan.py` now counts both directions. Campaign 1, below:
  E3 ran with no clocksource or `.wslconfig` change, but
  **not under one clock condition** (`caliper.log` scan of the 5 s progress lines + per-tx minima):
  - **E3a** matched E1/E2: steps of ≈ 1.2 s about every 28 s (385 of 2,159 progress intervals counting
    steps ≥ 0.5 s; 355 at `clockscan.py`'s ≥ 0.6 s threshold, which the other counts here use), per-tx
    latency < 0 in 58/84 rounds, down to −1,074 ms.
  - **E3b runs 1–58** (2026-10-03 01:46–10:56) had steps of **≈ 2.3 s** about every 28–30 s (464
    steps among E3b's 4,309 progress intervals, all before 10:56; the short intervals ≈ 2.7 s instead
    of 5 s — the VM ≈ 8 % fast, about twice E1/E2), per-tx
    latency < 0 in 168/360 rounds, down to −2,498 ms. The last step was at 10:55:42, inside run 58
    (`parallel-anchored/batch50-ch40-cases40/r0`, started 10:39).
  - **No steps from ≈ 10:56 on** — the last 14 E3b runs (Parallel-Anchored 40-case r1/r2 and the whole
    50-case cell) and all of ops (0/78) — with no change on our side.
  - Effect, measured: in E3b, Standard rounds with a step read below 99 TPS in 46 of 60 rounds (down
    to 84.4 at 5 cases, 95.5 at 20), step-free rounds in 0 of 30 (99.4–100.1); in E1 the same 20-case
    Standard trace read 99.9–100.0 in all 15 rounds although every one had a ≈ 1.3 s step. So E3b's
    5–40-case cells are **not directly comparable** with its 50-case cell or with E1/E2/E3a for
    per-round throughput, p95 and minimum latency (means of latency: reasoned to be closer).
  What follows is the E1/E2 analysis.
  Caliper's 5 s progress lines arrive ≈ 3.7 s apart in ≈ 1 of 6 intervals (ramp 131/726, E1
  271/1,620, E2 193/1,195; none in the 2026-09-30 E0 re-smoke, 0/33): the VM clock ran ≈ 4–5 % fast
  and was stepped back ≈ 1.3 s about every 27 s, agreeing with Windows on average. Effects in the
  data: per-tx latency < 0 in 178 of 298 rounds (ramp 22/28, E1 82/180, E2 74/90; down to
  −1,230 ms; 0/15 in E0), so every table's minimum latency is negative; the anchoring-delay
  minimum is negative in most anchored runs. Means should be close (the drift and the steps roughly
  cancel — reasoned, not measured); p95 and per-round throughput carry a few % of bias/noise. At
  idle in a fresh VM (2026-10-02, 60 s, clocksource `tsc`, `hyperv_clocksource_tsc_page`
  available) the clock kept time to 16 ms with no steps, so it appears under load — the July notes
  also saw negative minimum latencies. Still to do: find the cause (campaign 1's VMs are gone —
  `wsl --shutdown` — so their logs cannot be read; campaign 2's capture
  `benchmark/results/campaign2-20261005/vm-clock-dmesg.txt` holds no time-sync lines; leading guess a
  TSC-rate mis-calibration at VM boot, campaign-2 record §5) and decide with D how minimum latencies,
  p95 and per-round throughput are reported in both campaigns; a clocksource or `.wslconfig` change for
  a re-run would make it incomparable with both campaigns.
- **E1's batch-size rule selects nothing — the authors chose 50 (2026-10-02, `9459fd7`, tagged
  `set by hand`); the replacement rule and thresholds are still to agree with D.** §4.1
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
- **E2's healthy range is the whole grid — `baseline.channels` 20 / `channels_max` 50 set from E2
  (`9459fd7`); confirm the rule with D.** All six levels
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
  E3 shows it again: E3b Parallel 86.1 → 98.2 TPS from 5 to 50 cases (its 5–40-case cells also
  carry the clock-step bias, first bullet); ops Parallel write rounds read ≈ 66 TPS (400 tx in ≈ 4 s
  + 2 s; campaign 1's ops had no clock steps — campaign 2's had steps in 7 of 78 rounds, and two
  Parallel r2 write rounds read high, 97.8 / 82.8 TPS, its record §5). E3b's low Standard rounds are **not** the drain: they occur only in
  rounds with a clock step (first bullet; E1's identical 20-case Standard trace never read low).
  `collect.py` computes no
  drain-free rate yet (the tx logs keep tCreate/tFinal) — decide before reporting E2 §4.2(a), E3a's
  top levels on Parallel, E3b cross-variant throughput and the ops write table.
- **E3a's send-rate grid does not bracket saturation (with D) — E3a ran on [10 … 200] (the authors
  kept the grid, 2026-10-02):** no saturation for any variant in either campaign, and no p95 knee in
  campaign 1 — campaign 2's `report.py` flags one for Parallel-Anchored at 200 tx/s (p95 0.035 vs
  0.012 s at 10 tx/s: milliseconds of enqueue latency, within the clock-step scale; its record §6); the
  lowest ratio is Parallel's 0.92 at 200 tx/s (campaign 1: 2 of 3 runs; campaign 2: all 3). The proposal for D is to report "no saturation within
  10–200 tx/s"; an extended grid means re-running E3a (≈ 4 h). §4.3 wants ≥ 2 levels below and
  ≥ 1 above the saturation point, but nothing saturated up to 200 tx/s (the app's note: "extend
  send_rates_tps upward"); the trimmed-grid suggestion equals the full grid and was not applied.
  Options were: extend the grid upward for E3a (e.g. 300, 400 tx/s — still 12 runs, one more round per
  added level; untested above 200 tx/s, so not known to bracket saturation either; and `HEAD_GAP`
  = 110 in `benchmark/trace/generate.js` is sized for a 200 tx/s top — raising it changes every E3
  trace and its head-op spacing vs E1/E2, a CONTRACTS §12-22 change, while keeping it leaves the
  trace race unmodelled above 200), or keep [10 … 200] and report "no saturation within the tested
  range", stating Standard's p95 rise at 200 (188 → 629 ms) as an observation — `report.py`'s knee
  rule flags no knee for any variant on the ramp data.
- **Caliper's round summary sometimes drops a round's first few transactions** (corrected
  2026-10-03 — earlier read as "late completions"). In 31 of 820 rounds (ramp 2/28, E1 4/180, E2
  1/90, E3a 3/84, E3b 21/360, ops 0/78; any variant) `succ` + `fail` is 1–8 tx below the per-tx log's
  count (e.g. E1 `anchoring/batch10…/r0` slice4: `succ` 4,472, per-tx log `ok` 4,480). The per-tx log
  is complete. The missing ones are the round's first transactions (usually one per worker), whose
  create time lies before their worker's round start — apparently a backward clock step at the round
  start — and a gap of up to ≈ 2.3 s follows them; Caliper's window starts after that gap (it
  matches the per-tx-log window without those first creates within ≤ 0.05 s). None occurs after the
  clock steps stopped (0 of 148 rounds in runs started after 2026-10-03 10:56). Size: count ≤ 0.18 %
  low and window 0.4–0.9 s shorter in ramp–E2 (throughput +0.4 to +1.4 % against the per-tx log's
  `ok` ÷ `windowS`); in E3 count up to 0.36 % low, window 0.01–2.27 s shorter, throughput −0.1 to
  +17.5 % against `ok` ÷ `windowS` (E3a ≤ +2.2 %; e.g. E3b `parallel-anchored/batch50-ch5-cases5/r1`
  slice3: 100.0 vs 85.1 TPS). Other rounds agree within Caliper's 0.1-TPS rounding. Taking the window
  from the per-tx log as is would fold the client-side gap into throughput — decide how `collect.py`
  excludes the pre-round transactions and the gap after them.
- **Failure-class columns.** Every failure in both campaigns is Fabric validation code 11
  (= `MVCC_READ_CONFLICT`) per the `caliper.log` scan (`fabricStatusCodes`) — campaign 1's E3 included
  (E3a 21: Standard 8, Parallel 13; E3b 57: Standard 8, Parallel 49; ops 0), and all 138 of campaign 2
  (E3a 21: Standard 9, Parallel 12; E3b 60: Standard 8, Parallel 52; ops 0) — but the per-tx-log
  class columns file them as `OTHER` (the connector sets no per-tx error; CONTRACTS §10 keeps the
  scan alongside, never merged). Map or footnote this before the failure-class tables are reported.
- **Anchoring delay in the tables** uses the all-batches mean (`report.py`), which includes forced
  batches (methodology §2.3 says they are excluded) and batches left open across the idle gap
  between rounds. Recomputable from each run's `anchoring.json`; fix `report.py` before reporting.
  It matters most for E3b's Parallel-Anchored column (5.4 → 16.1 s from 5 to 50 cases: per-case
  batches of 50 fill more slowly as the same send rate is spread over more cases).
- **Reset race at 50 channels (one occurrence, 2026-10-03 14:16).** `reset-network.sh
  --variant parallel-anchored --channels 50` failed in `peer lifecycle chaincode install` (endorser
  client could not connect to peer0.org1:7051) right after a 50-channel run; the driver's `--resume`
  re-ran the run cleanly. 1 failed reset in 306 run attempts since 2026-10-01 (156 in campaign 1; none
  of campaign 2's 150 failed, its nine 50-channel resets included). Optional fix after
  the campaign: wait for the peer's gRPC port before the install (a code change; no re-run needed).
- **With D (E1, E2 and E3 all ran on these unconfirmed defaults — E1, E2, E3b and ops at the
  100 tx/s baseline send rate, E3a over 10–200 tx/s):** the calibration
  thresholds (§4.1–4.3) — including the authors' no-saturation rule behind
  `baseline.send_rate_tps` = 100 and the batch-size choice (§3 step 2: record them first; a different
  send rate from D means re-running E1, E2, E3b and ops, ≈ 26 h) — r = 3 mean ± SD, the §8 defaults
  (incl. #13: E0 derives no channel count), and the two contradictions of D's 10 Sep assumptions:
  **AccessLog is a WRITE**, **the N and K grids are unified**.
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
- Exercised live since 2026-10-02: E3a/E3b/ops at the final baselines (96 runs), E3b's 50-case cell
  on all four variants (Windows "available" 0.8 GB at the lowest check during the Parallel
  50-channel runs, no failures), the driver's automatic `--resume` after a failed attempt (E3b, 2026-10-03 14:17), and
  stopping the driver while its stage keeps running (E3a, 2026-10-02 13:50).
- Exercised live 2026-10-03/05 (campaign 2): one driver running all five stages E1 → ops unattended for
  30 h 37 min with no relaunch, and 150 network resets without a failure — including every 50-channel
  reset (the kind that failed once in campaign 1).
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
- **Keep campaigns apart (2026-10-03/05):** one folder per campaign (`benchmark/results/campaign<N>-<date>/`
  + `docs/results/campaign<N>-<date>/`), never combined tables. `report.py --out` does **not** follow
  `--results` — pass both for an archived campaign, or its tables land in the default `docs/results/<exp>/`;
  it also rewrites `<exp>-results.csv` inside the campaign folder it reads. The shared
  `benchmark/results/runlog.jsonl` holds every campaign's lines — cut a campaign's own runlog from it by
  `startedAt`, never count progress from it.
- **Scan the VM clock in both directions:** `C:\Users\LENOVO\gleipnir-driver\clockscan.py` counts short
  (backward step) and long (forward step / stall) progress intervals. Campaign 2's clock was stepped
  forward, which a backward-only scan reported as "no steps" for its first 18 h. Give it (and
  `c2facts.py`) the inputs explicitly — the stage logs (`benchmark\results\campaign<N>-<date>\benchapp-logs\<stamp>-<exp>.log`)
  and the results root; both refuse to run without them (there is no campaign data at the old defaults).
- **ops runs have no trace** (`trace: null` in `run.json`): a trace-hash comparison must report them
  separately, not count `None == None` as identical (`c2facts.py` fixed 2026-10-05).
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
  (`Start-Process pyw.exe …`) — Claude Code's auto mode refuses Windows scheduled tasks
  (persistence). Let `experiment.py` write its log itself inside WSL (`> log 2>&1`), never through a
  pipe to the driver: a broken pipe kills the run, a file lets the run survive the driver (killing
  the driver leaves its stage running — used 2026-10-02 to stop after E3a). The driver lives in
  `C:\Users\LENOVO\gleipnir-driver\` (not in the repo): `overnight.py` (campaign 2: E1 → E2 → E3a →
  E3b → ops, `--selftest`, `--check`, status in `overnight-status.json`, log `overnight.log`),
  `overnight-e3-2026-10-02.py` (campaign 1's E3, with its `.log` and status `.json`),
  `overnight-2026-10-01.py` (ramp/E1/E2), two tests. Claude Code kills its own background shells when Windows memory runs low
  (4× on 2026-10-02; the WSL page cache does it) — either start it with
  `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`, or watch with in-session scheduled checks (Claude
  Code's cron prompts are not shells and survive low memory; used every 30 min for E3).
