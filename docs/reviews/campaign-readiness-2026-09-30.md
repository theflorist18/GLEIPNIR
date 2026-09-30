# Campaign readiness review — 2026-09-30

**Question:** is the benchmark campaign (ramp → E1 → E2 → E3a → E3b → ops) ready to start?
**Verdict at the start of the day:** no — the harness had two pre-ramp blockers (R1, R2) and two
problems that would have forced E1 to be re-run (R3, R4), and the host needed more WSL memory (R12).
R1–R4 were fixed in `542c125` (CONTRACTS §12-21..23) and validated by an E0 re-smoke; R5 stays open
with D. The ramp is ready but was **postponed** because the host ran out of memory (R17).

**Method.** A five-dimension audit (plans + provenance, metrics contract + methodology gates, the
single-channel code paths, the multi-channel paths + host resources, the Bench app + operational
robustness), every non-trivial finding re-checked by an independent skeptic; then a three-lens check of
the operator runbook (app path, commands, data safety); then a code review of the fixes (generator,
audit, ramp) and a skeptic pass over the edited docs. Evidence was taken from the code, the installed
Caliper 0.6.0 sources, the 2026-09-26 and 2026-09-30 E0 manifests, live host counters (R12, R15, R17)
and an E0-calibrated block-cutting model; figures marked *modelled* or *projected* come from that
model, not from runs.

## Findings

| ID | Sev. | Finding | Status |
|---|---|---|---|
| R1 | blocker | The 2026-09-29 pre-flight commit was never made: `sweeps.yaml` (224), icons, launcher uncommitted, while the uncommitted 2026-09-29 STATUS edit said committed — every `run.json` would have cited `042b577` (200) with a sweeps blob in no commit | fixed, `542c125` |
| R2 | blocker | Ramp rounds of 20 × 40 = 800 tx: Caliper's throughput = (succ+fail)/(lastFinish − firstCreate) includes the end-of-round block wait (Parallel: every channel's last partial block waits BatchTimeout 2 s) → modelled 0.89 × send rate at 50 tx/s → the §4.3 rule suggests 25 tx/s by construction (≈ 19 extra machine-hours, projected, and a false "saturates at 50" for D) | fixed: ramp 224 events (§12-21) |
| R3 | high | Trace race: Caliper does not await submissions, so a head op on one evidence can be endorsed before its predecessor commits. Not a constant 0.4 %: modelled 0.48 % (Parallel, 20 cases, 50 tx/s) and 1.79 % in E3a's 200 tx/s round, worst at 5–10 channels — right at E2's ≤ 1 % rule. E0's one failure was a TRANSFER endorsed before its CREATE committed ("not found"), not MVCC | fixed in the generator: weighted interleave + rule (e) head-op spacing (§12-22); modelled residual ≤ 0.1 % below saturation. A runtime wait in `trace.js` was rejected (Caliper counts a tx only when it reaches the connector: the rate controller bursts and the slice overruns at the round end) |
| R4 | high | Audit reconstruction time depended on case order: one root cache per run and no warm-up (E0: case 1 45–161 ms vs 9–17 ms; Anchoring rootReads [5,0,0,0,0]) — not correctable after the fact | fixed: cache per case + untimed warm-up pass (§12-23) |
| R5 | high | E1 rule §4.1 can never select a batch size: anchored on-chain bytes/event fall as 1/N, steps 60/50/50/50 % never ≤ 5 % | **open** — replacement rule with D before E1's baseline (STATUS §5) |
| R6 | medium | `test_experiment.py` hard-coded 3 × 200 (suite red at 224) | fixed |
| R7 | medium | `experiments.md` (the table that goes to D) and other docs still said 200 events / ramp 40; several statements over-claimed (modelled figures written as measured) | fixed (methodology, CONTRACTS, AS-BUILT, ARCHITECTURE, benchmark/README, Bench help) |
| R8 | medium | E2 rule §4.2 cannot cut the channel grid on this host: CPU budget 0.9 × 32 × 100 = 2,880 % is out of reach at a fixed sub-saturation send rate; no memory term | **open** — with D before E2's baseline |
| R9 | medium | The end-of-round drain biases Parallel only (modelled: ≈ 4–8 % at 5–10 cases, ≈ 9 % at 200 tx/s; Standard ≤ 0.6 %); no drain-free rate is computed | **open** — documented (methodology §7); tx logs keep tCreate/tFinal |
| R10 | medium | Anchoring-delay column includes forced batches (methodology §2.3 excludes them) and batches open across the idle gap between rounds | **open** — recomputable from `anchoring.json`; fix `report.py` before reporting |
| R11 | medium | `run.json` records HEAD but no dirty-tree flag; `git()` errors yield an empty SHA silently; Resume does not check that finished runs used the current config | **open** — process rules instead (STATUS §7: commit before every stage, nothing edited mid-stage) |
| R12 | medium | WSL had 7.6 GB; projected peak ≈ 5.2 GB at 50 channels with silent swap as the failure mode | done: `.wslconfig` memory = 10 GB before the campaign |
| R13 | medium | Parallel latency rises with channels because blocks are cut by the 2 s timer once channels > send rate ÷ 5 — not host contention (re-explains the July "coordination overhead") | documented (methodology §7) |
| R14 | medium | Operator traps: the Bench app reopens E0 on *smoke test* / E3 on *E3a* (Run… on the wrong mode deletes a finished stage); every Run/Resume backs up unless skipped; terminal runs skip the app's backup bookkeeping; the web app runs on the real library during every run | documented (STATUS §7) |
| R15 | medium | Host stability: 2026-09-29 blue screen 0x3B during a sleep with the WSL2 VM up; 09-21/09-24 crashed mid-hibernate; 0x10E (09-19) and 0x119 (07-22, the July campaign loss) in the graphics stack; Windows Update not paused | rules: never sleep/hibernate while Docker runs, charger in; pause updates before E1 (STATUS §2/§3) |
| R16 | low | Dry-run ETAs borrow other experiments' medians (ramp shows 0.5 h; realistic 1.6–1.9 h); all DISPOSEs fall in the last round with the weighted interleave; the log scan misses `EndorseError`; anchored latency is quantised to 10 ms; no warm-up round (the brief lists warm-up) | noted; realistic times in STATUS §4 |
| R17 | blocker (new) | After E0: 0.7 GB of 15.7 GB free, commit 35/36.5 GB, kernel paged pool 7.5 GB growing ≈ 60 MB/min with the benchmark stopped. Pool tag `Vi54` (dxgkrnl video memory manager) held 5.9 GB; per-process GPU committed memory: Discord 3.8 GB (+17 MB/30 s), Chrome 0.83 GB (+24 MB/30 s) | **ramp postponed** — close Discord, Chrome and Roblox (or reboot) before every stage and check the paged pool is not growing (STATUS §3) |

## Validation — E0 re-smoke on `542c125` (smoke regime, never benchmark data)

| Variant | Tx ok / failed | On-chain B/event | Audit ms/case (old E0) | Root reads per case (old) |
|---|---|---|---|---|
| Standard | 608 / 0 | 4,101 | 11.8 (43.8, case 1 cold) | — |
| Anchoring | 608 / 0 | 114 | 33.6 (20.7) — each case now pays its own root reads | [5,5,5,5,5] ([5,0,0,0,0]) |
| Parallel | 508 / 0 (old: 1 failure) | 4,707 | 12.7 (33.1) | — |
| Parallel-Anchored | 608 / 0 | 133 | 16.8 (20.9) | [1,1,1,1,1] (same) |

Every run recorded commit `542c125`, sweeps blob `a31da07`, trace `params.headGap` = 7 (the smoke
round) and host memory 9.7 GB. Storage and latency are in line with the 2026-09-26 E0 (archived in
`benchmark/results/e0-pre-headgap-20260930/`): on-chain B/event within 0.2 % except Anchoring (114 vs
107, one extra 2-leaf forced batch: 14 batches / 3 forced vs 13 / 2), so the fixes left the
measurement path unchanged. Audit case 1 is no longer timed cold, though it remains ≈ 1.3× the other
cases on Standard, Anchoring and Parallel (it was 3–13×).
