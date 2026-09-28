# GLEIPNIR — Status & Handoff

> **One living file.** Update it in place at the end of every working session. Do not add dated
> `handoff-YYYY-MM-DD.md` files; the last two (2026-09-25, 2026-09-26) are in git history before
> this file existed. *What* changed and *why* lives in `docs/CONTRACTS.md` §12 (decision record)
> and `git log`; this file only says where things stand and what comes next.

**Last updated:** 2026-09-28, end of session. Docs re-organisation committed (`bf8215c`) and a
full pre-flight check done. **The experiment campaign starts 2026-09-29** — follow §3 then §4.

## 1. Where the repo stands

- **Push `main` before the first run** (`git status -sb` must show no `[ahead]`): every `run.json`
  stamps HEAD as provenance and the thesis cites GitHub SHAs. `bf8215c` (docs reorg) reached
  `origin/main` on 2026-09-28; this handoff commit is the only one that may still be local.
- Landed, in order: M27 desktop benchmark app + web dashboard removal (`63d534b`), web redesign
  (`ba48923`), the over-engineering refactor (`6073abc`, CONTRACTS §12-20), docs re-organisation
  (`bf8215c`: `docs/audit/` → `docs/reviews/`, supervisor brief → `docs/supervisor-brief-2026-09-22.md`,
  image-build script → `orchestration/build-images.sh`, dated handoffs and superseded plans deleted).
- **Never rewrite history.** The thesis cites SHAs (CLAUDE.md, Repository discipline).
- **E0 is complete for all four variants** on the refactored images (`benchmark/results/e0/`,
  gitignored; the pre-refactor runs are archived beside it). No ramp, E1, E2 or E3 run exists yet.
- **Every baseline in `benchmark/sweeps.yaml` is a PLACEHOLDER:** send rate 50, batch 50,
  channels 20, channels_max 50. `events_per_case_per_round` is 200 (see §3, decision 1).
- Known smoke-trace race: about 1 failure in 240 on the direct-write variants — a `TransferCustody`
  endorsed against a stale head when two writes to one evidence land in the same block. Does not occur
  on the anchored variants. No decision recorded yet: fix it, or report it as a ≈0.4 % failure class.

## 2. Environment (checked 2026-09-28)

| Item | State |
|---|---|
| Docker Desktop | **Not running** today; both WSL distros stopped. Does **not** auto-start after a reboot |
| Live stack (as of 2026-09-26) | standard, 14 containers, `gleipnir-*:latest` from the refactored code; gateway `:3000`, web `:8081` |
| Images | Not re-checkable with Docker down. No rebuild is due: nothing that enters an image changed since the 2026-09-26 build |
| Proxy CA bundle | `C:\Users\LENOVO\gleipnir-ca-bundle.crt`, regenerated 2026-09-26 (110 certs). Regenerate after a proxy change from `Cert:\LocalMachine\Root, Cert:\CurrentUser\Root, Cert:\LocalMachine\CA, Cert:\CurrentUser\CA`, de-duplicated by thumbprint |
| Ledger data | The authors' **manual test data** (13 users, 8 cases, 24 exhibits, 29 trail events). One backup: `backups/20260926-202333`; `backups/state.json` origin = "test data" |
| Crypto material | `network/organizations/` complete for org1, org2, orderer **and** the anchor org |
| WSL Ubuntu-22.04 toolchain | node 20.19.6, Caliper 0.6.0 bound `fabric:fabric-gateway`, Python 3.10 + PyYAML, fabric-ca-client 1.5.19, jq, curl. **matplotlib missing** (charts only; present on the Windows host) |
| WSL resources | 32 logical CPUs visible, **7.6 GB RAM** (no `.wslconfig`, so 50 % of the 15.7 GB host) |
| Host | i9-13900HX, 24 physical / 32 logical cores, 260 GB free on C: |
| Power plan | On AC: never sleeps, never hibernates, lid does nothing. **On battery: hibernates after 3 h** |
| `network/compose/.env` | Matches HEAD (E0 runs and restores rewrite it) |
| Windows Python | 3.11.9 with tkinter, PyYAML, matplotlib — the Bench app runs |

## 3. Pre-flight for 2026-09-29 (in this order)

1. **Push.** `git push origin main`; `git status -sb` must show no `[ahead]`.
2. **Start Docker Desktop**, then from WSL:
   `wsl -d Ubuntu-22.04 -u root --exec bash -lc "docker info --format '{{.ServerVersion}}' && docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^(gleipnir-|hyperledger/fabric|alpine)'"`
   Expect the 10 `gleipnir-*` images (incl. `ccaas-evidence` and `ccaas-evidence-anchor`),
   `fabric-{peer,orderer,tools}:2.5.15`, `fabric-ca:1.5.19`, `alpine`. If one is missing:
   `GLEIPNIR_CA_BUNDLE=/c/Users/LENOVO/gleipnir-ca-bundle.crt bash orchestration/build-images.sh`,
   then check `node_modules` is populated inside each rebuilt Node image.
3. **Backup.** The Bench app backs up every `gleipnir_*` volume before its first ledger reset. If
   running from a terminal instead: `bash orchestration/down.sh && bash orchestration/backup-volumes.sh backups/$(date +%Y%m%d-%H%M%S)`.
4. **Plug in the charger** and leave the Bench app open for the whole run (it keeps the PC awake;
   a terminal run does not).
5. **Decision 1 — `workload.events_per_case_per_round`: 200 → 224.** Dry-runs today at 200: E1
   18 of 36 runs sub-floor, E2 18 of 18, E3b 36 of 72 (the least-loaded channel gets 935–969 write
   events < 1000). At 224 every plan is clean and `cases × 224 / 4` is an integer for every case
   count. The ramp is unaffected (it uses `ramp.events_per_case_per_round: 40`), so the change can
   land after the ramp but **before E1**. Commit `sweeps.yaml` after this and after every baseline
   write so the `sweepsSha` in `run.json` is citable.
6. **Decision 2 — E2 grid vs cores.** `channel_counts` tops at 40 and 50, above the 32 logical /
   24 physical cores, and WSL has 7.6 GB. Either trim to `[5, 10, 20, 30]` now, or keep the grid and
   watch the first 40- and 50-channel runs (health waits, memory) and let the healthy-range rule cut
   them. If memory is the limit, add `%USERPROFILE%\.wslconfig` with `[wsl2] memory=12GB` and
   `wsl --shutdown` before continuing.
7. **Off-machine copy.** `benchmark/results/`, `benchmark/traces/` and `backups/` are gitignored
   and exist only on this laptop. Pick a copy target and copy `benchmark/results/<exp>/` plus
   `runlog.jsonl` after each experiment.

## 4. Run order and what each stage writes

| Stage | Runs | Dry-run ETA* | Writes / gate |
|---|---|---|---|
| ramp (E0) | 4 | 0.5 h | suggests `baseline.send_rate_tps` + trimmed `send_rates_tps` → **Use as baseline** → commit |
| E1 | 36 | 4.6 h | suggests `baseline.batch_size` (one value for both anchored variants) → confirm → commit |
| E2 | 18 | 2.3 h | suggests `baseline.channels` (median of the healthy range) and `channels_max` → confirm → commit |
| **send to D** | — | — | variable table + three flowcharts with measured values, **before E3** (`docs/methodology/experiments.md` §2, §6) |
| E3a | 12 | 1.5 h | scalability vs send rate; `e3a-saturation.json` |
| E3b | ≤ 72 | 9.1 h | scalability vs cases, trimmed to `channels_max` |
| ops | 12 | 1.5 h | per-operation breakdown; writes and reads in separate tables |

\* ETAs borrow the E0 smoke median (~7.5 min/run). Steady runs and 40–50-channel resets are
longer; budget 30–45 machine-hours. `experiment.py --resume` (or the app's Resume) skips complete
runs after an interruption, but Docker Desktop must be started by hand first.

Charts: `report.py` needs matplotlib — run it on the Windows host (`py -3.11 orchestration/report.py --exp <E>`)
or `pip install matplotlib` in WSL. Tables and CSVs never need it.

## 5. Open decisions

- **With D (supervisor), ideally before E1 runs at the derived send rate:** the calibration rule
  thresholds (`docs/methodology/experiments.md` §4.1–4.3: saturation < 0.9 × send rate, ½ margin,
  minimum-over-variants; ≤ 5 % plateau / ≤ 1.5 × audit for batch; ≥ 0.95 throughput, ≤ 1 % failures,
  CPU ≤ 0.9 × cores — logical or physical? — for channels; a memory criterion?), r = 3 mean ± SD, and
  the twelve §8 defaults. Two contradict D's 10 Sep assumptions and must be said explicitly:
  **AccessLog is a WRITE**, and **the N and K grids are unified**.
- **With the lecturer:** whether the **off-chain B/event** metric stays in the tables.
- **Trace race** (§1): fix or report.
- **Variant chip in the SPA:** still skipped; needs an nginx route to the gateway's `/healthz`
  (a CONTRACTS change). The Merkle verify controls work without it.
- **Small UI quirk:** after a manual "Log access", the on-chain custody list does not refresh until
  the page reloads.
- **Design assets still owed by the designers:** brand mark (direction A is the placeholder),
  exports and favicon, lead and admin screens, the other Bench tabs, the court report, sample thesis
  figures. Brief: `docs/design/GLEIPNIR-design-brief.md`; boards: `docs/design/claude-design/`.

## 6. Not exercised live (residual risk)

- `registerEnroll.sh` (full, and the anchor-only path) and `up.sh` without `--skip-crypto`. Both
  only run on fresh crypto, which needs a wipe. The refactor's changes there were checked by
  syntax and reading only.
- The Bench app's own Run → backup → restore dialogs. The 2026-09-26 session ran the same
  `benchcore` scripts directly.
- E2 at 40 and 50 channels has never run on this host.

## 7. Rules that bit us (keep them)

- **Never** run `down.sh --wipe`, `docker compose down -v` or `docker volume rm` without explicit
  permission for that one time. Plain `down.sh` keeps the volumes. The supported way around ledger
  resets is: back up → reset → restore. Restore only with the stack stopped; never run `up.sh`
  after a restore; do not add or edit library data between backup and restore.
- **Four gateway routes add an ACCESS event when read:** `GET /evidence/:id`, `/download`, `/export`
  and `/cases/:id/coc-report`. Never open a fixture exhibit or its report while testing. Fingerprint
  data through the routes that do not log.
- **Never type passwords into the browser.** Get a token with `POST /api/v1/auth/login` from a shell,
  then `sessionStorage.setItem('gleipnir.session', token)` and reload.
- **Check the dependencies inside a rebuilt image.** npm can exit 0 with nothing installed when TLS
  through the proxy fails.
- **Rebuild images together with compose edits,** and **don't patch files with inline Bash heredocs**
  that contain backslashes.
- **Run terminal campaigns from a fresh WSL shell** with `wsl -d Ubuntu-22.04 -u root --exec bash -lc "…"`
  (`--exec`, not `--`); one `experiment.py` at a time; export `GLEIPNIR_ALLOW_LEDGER_WIPE=1` only for
  real runs (the app does this itself, never for Preview).
- **Commit `sweeps.yaml` between stages, never mid-experiment,** so every run of one experiment
  records the same `sweepsSha` and `gitCommit`.
