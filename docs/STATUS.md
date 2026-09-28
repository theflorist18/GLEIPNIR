# GLEIPNIR — Status & Handoff

> **One living file.** Update it in place at the end of every working session. Do not add dated
> `handoff-YYYY-MM-DD.md` files; the last two (2026-09-25, 2026-09-26) are in git history before
> this file existed. *What* changed and *why* lives in `docs/CONTRACTS.md` §12 (decision record)
> and `git log`; this file only says where things stand and what comes next.

**Last updated:** 2026-09-28 (docs re-organisation; no code or live-stack change).

## 1. Where the repo stands

- `main` = `origin/main` (GitHub). Landed, in order: M27 desktop benchmark app + web dashboard
  removal (`63d534b`), web redesign (`ba48923`), the over-engineering refactor (`6073abc`,
  CONTRACTS §12-20), and the 2026-09-28 docs re-organisation (`docs/audit/` → `docs/reviews/`,
  supervisor brief moved to `docs/supervisor-brief-2026-09-22.md`, image-build script moved to
  `orchestration/build-images.sh`, dated handoffs and superseded plans deleted).
- **Never rewrite history.** The thesis cites SHAs (CLAUDE.md, Repository discipline).
- **E0 is complete for all four variants** on the refactored images (`benchmark/results/e0/`,
  gitignored; the pre-refactor runs are archived beside it). Known smoke-trace race: about 1 failure
  in 240 on the direct-write variants — a `TransferCustody` endorsed against a stale head when two
  writes to one evidence land in the same block. It does not occur on the anchored variants.
- **Baselines in `benchmark/sweeps.yaml` are still PLACEHOLDERS:** send rate 50, batch 50,
  channels 20, channels_max 50. `events_per_case_per_round` is 200.

## 2. Live environment (as last recorded, 2026-09-26)

Docker Desktop was **not running** on 2026-09-28, so this is the last recorded state, not a fresh check.

- Stack up on **standard** (14 containers), images `gleipnir-*:latest` built from the refactored
  code. Gateway `:3000`, web `http://localhost:8081`. Gateway sessions do not survive a restart —
  sign in again.
- Ledger holds the authors' **manual test data** (13 users, 8 cases, 24 exhibits, 29 trail events),
  restored from `backups/20260926-202333` — the only backup kept. `backups/state.json` origin =
  "test data".
- `network/compose/.env` matches HEAD. E0 runs and restores rewrite it.
- Host proxy CA bundle `C:\Users\LENOVO\gleipnir-ca-bundle.crt` was regenerated 2026-09-26
  (110 certificates, Windows Root + intermediate stores, UTF-8 no BOM). Regenerate again after the
  proxy changes: PowerShell over `Cert:\LocalMachine\Root, Cert:\CurrentUser\Root,
  Cert:\LocalMachine\CA, Cert:\CurrentUser\CA`, de-duplicated by thumbprint.

## 3. How to run things

| What | How |
|---|---|
| Web app | `http://localhost:8081` (the stack must be up) |
| Bench app | double-click `orchestration/benchapp.pyw`, or `pyw -3.11 orchestration\benchapp.pyw` |
| Gateway tests | `cd gateway && npm test` (77/77) |
| Service tests | `node --test` inside each `services/<name>` |
| Frontend tests / build | `cd frontend && npx tsc --noEmit && npx vitest run && npx vite build` |
| Bench tests | `python orchestration/test_benchapp.py && python orchestration/test_experiment.py` (Windows or WSL) |
| Chaincode tests | Go 1.25.5 is **not installed** on the host or in WSL. Download the pinned zip to a temp folder, then run `go test ./...` in `chaincode/evidence` with `GOTOOLCHAIN=local` |
| Rebuild images | `GLEIPNIR_CA_BUNDLE=<fresh bundle> bash orchestration/build-images.sh`. **Then check every dependency resolves inside each Node image**, because npm can exit 0 with nothing installed when TLS through the proxy fails. Use `--no-cache` for any image with a bad layer |
| Recreate containers on existing volumes | the stack-up script from `orchestration/benchcore.py` (`stack_up_script()`), or `compose up -d --no-build` |
| Any WSL call from Windows | `wsl -d Ubuntu-22.04 -u root --exec bash -lc "…"` (use **`--exec`**, not `--`) |
| Campaign order | `experiment.py --exp e0` → `ramp` → `e1` → `e2` → `e3a` / `e3b` → `ops`, then `report.py --exp <E>` (see `orchestration/README.md`) |

## 4. Next steps, in order

- [ ] **Decide `events_per_case_per_round`: 200 or 224.** At 200, the multi-channel runs in E1-PA,
      E2 and E3b fall sub-floor; the app's Preview shows it.
- [ ] **E0 ramp** (coarse send-rate ramp to find saturation), then "Use as baseline" and a finer
      E3a grid.
- [ ] **E1 → E2 through the app,** then send the variable table and the three flowcharts to D
      **before E3**.
- [ ] **E3a / E3b / per-operation breakdown** at the calibrated baselines; export the CSVs and charts.

## 5. Open decisions

- **With D (supervisor):** the baseline rule thresholds (`docs/methodology/experiments.md` §4.1–4.3);
  the minimum-over-variants send-rate baseline; the ½-saturation margin (`RAMP_MARGIN` 0.5);
  whether E2's healthy rule needs a memory criterion.
- **With the lecturer:** whether to keep the **off-chain B/event** metric.
- **Variant chip in the SPA:** still skipped. It needs an nginx route to the gateway's `/healthz`,
  which is a CONTRACTS change. The Merkle verify controls work without it (they follow each write's
  `batched` flag).
- **Small UI quirk:** after a manual "Log access", the on-chain custody list does not refresh until
  the page reloads. The session-events panel does update.
- **Design assets still owed by the designers:** the brand mark (direction A is the placeholder),
  exports and favicon, the lead and admin screens, the other Bench tabs, the court report, and the
  sample thesis figures. Brief: `docs/design/GLEIPNIR-design-brief.md`; boards:
  `docs/design/claude-design/`.

## 6. Not exercised live (residual risk)

- `registerEnroll.sh` (full, and the anchor-only path) and `up.sh` without `--skip-crypto`. Both
  only run on fresh crypto, which needs a wipe. The refactor's `fcc`/`enroll_node` changes there
  were checked by syntax and by reading only.
- The Bench app's own Run → backup → restore dialogs. The 2026-09-26 session ran the same
  `benchcore` scripts directly.

## 7. Rules that bit us (keep them)

- **Never** run `down.sh --wipe`, `docker compose down -v` or `docker volume rm` without explicit
  permission for that one time. Plain `down.sh` keeps the volumes. The supported way around ledger
  resets is: back up → reset → restore. Check the data with a fingerprint through the routes that
  don't add ACCESS events.
- **Four gateway routes add an ACCESS event when read:** `GET /evidence/:id`, `/download`, `/export`
  and `/cases/:id/coc-report`. Never open a fixture exhibit or its report while testing. Use
  throwaway smoke exhibits inside a backup/restore window.
- **Never type passwords into the browser.** Get a token with `POST /api/v1/auth/login` from a shell,
  then `sessionStorage.setItem('gleipnir.session', token)` and reload.
- **Check the dependencies inside a rebuilt image.** npm can exit 0 with nothing installed when TLS
  through the proxy fails.
- **Rebuild images together with compose edits,** and **don't patch files with inline Bash heredocs**
  that contain backslashes.
- **Run sweeps from a fresh WSL shell** (Ubuntu-22.04); images must pre-exist
  (`orchestration/build-images.sh`).
