"""Hover-help texts for benchapp.pyw (the "?" icons, tab headers, buttons and table columns).

Text only — no logic. Keep it in step with benchmark/sweeps.yaml, docs/methodology/experiments.md §4
and docs/CONTRACTS.md §10.
Terminology: send rate = configured input; throughput = measured output; TPS only as a unit;
"baseline", never "optimal".
"""

# ---------------------------------------------------------------- one line + detail per tab
TAB_HELP = {
    "Settings & Baselines": (
        "Controlled workload (set once, identical for every variant) + the baselines carried into E3.",
        "CONTROLLED WORKLOAD: held constant across every variant and run so that only the architecture differs.\n"
        "Set it once before E1 and keep it; changing it mid-campaign makes experiments incomparable.\n\n"
        "BASELINES: the FIXED LEVELS of independent variables. Each is swept in its own experiment (send rate\n"
        "in the E0 ramp / E3a, batch size in E1, cases/channels in E2 / E3b) and held at its baseline wherever\n"
        "it is not swept (batch size in all of E3; cases in E3a and the per-operation breakdown; send rate in\n"
        "E1, E2, E3b and the breakdown). Batch size and channel count stay design factors, static in E3\n"
        "once calibrated; the send-rate baseline follows the E0 ramp rule.\n"
        "Always 'baseline', never 'optimal'. The calibrations must be reported in the paper.\n\n"
        "Save writes benchmark/sweeps.yaml in place (comments kept). run.json cites that file's git SHA, so\n"
        "commit it before a campaign."),
    "E0 initial test": (
        "Goal: check everything works on all 4 variants, then find roughly where each variant saturates.",
        "SMOKE TEST (label 'smoke'): functional correctness only — never used for results.\n\n"
        "RAMP: steps the send rate up (one round per rate) to find where each variant's throughput stops\n"
        "keeping up (throughput < 0.9 x send rate = saturation). From it the app suggests the BASELINE\n"
        "SEND RATE (safely below saturation). E3a has its own ladder and climbs to saturation by itself.\n\n"
        "Tip: ramp coarsely first (e.g. 100 ... 1000 tx/s). Where throughput flattens, look at the CPU\n"
        "column: headroom left = an architecture limit (the finding); CPU maxed out = the laptop itself\n"
        "(a threat to validity).\n"
        "Also check 'measured send rate' = 'send rate': if not, the Caliper workers were the bottleneck."),
    "E1 batch size": (
        "Goal: choose the baseline batch size for the anchored variants (calibration, reported in the paper).",
        "Varies the batch size (events per Merkle batch) on Anchoring and Parallel-Anchored — ONE grid for\n"
        "both. Standard and Parallel run only at that one point (not per batch size, with the usual\n"
        "repetitions) and appear as horizontal reference lines.\n"
        "Held fixed: the baseline send rate and case count.\n\n"
        "Trade-off: bigger batches -> fewer on-chain transactions and less ledger growth, but longer\n"
        "anchoring delay and more verification work per audit.\n\n"
        "Rule (methodology §4.1): the SMALLEST batch size where throughput and on-chain\n"
        "bytes/event change <= 5 % to the next level while audit time stays <= 1.5x the smallest level's.\n"
        "If the two variants disagree, the larger level is taken."),
    "E2 channels": (
        "Goal: find how many cases/channels Parallel handles on this host before it stops scaling.",
        "Parallel only (Parallel-Anchored inherits the result). One channel per case, so cases = channels.\n"
        "Held fixed: the baseline send rate.\n\n"
        "Rule (methodology §4.2): a level is HEALTHY while throughput >= 0.95x the previous\n"
        "level, failure rate <= 1 % and total CPU <= 0.9 x cores x 100 %. The healthy range runs from the\n"
        "lowest level up to the first unhealthy one.\n"
        "  baseline cases = the MEDIAN of that range (never its maximum)\n"
        "  max cases      = its top (E3b does not go beyond it: past it you measure the host running out\n"
        "                   of CPU, not the architecture)."),
    "E3 main": (
        "Goal: the paper's main experiment — compare the 4 architectures' scalability, baselines fixed.",
        "E3a  scalability vs LOAD: send rate raised round by round from 100 tx/s and climbing until each\n"
        "     variant saturates (finalized throughput < 0.9 x send rate) or the load generator tops out.\n"
        "E3b  scalability vs CASES at a fixed TOTAL send rate (Parallel variants: one channel per case), up\n"
        "     to max cases — the cost of adding channels.\n"
        "E3c  scalability vs CASES at a fixed PER-CASE send rate: the load grows with the cases.\n"
        "Sensitivity cells: 2-of-2 endorsement and a 5 s idle batch timer against a baseline cell.\n"
        "Per-operation breakdown: each operation (create, transfer, access, dispose + the reads) tested on its\n"
        "     own at one operating point — which operation is most expensive? does anchoring help all of\n"
        "     them? Writes and reads in separate tables.\n\n"
        "Uses the fixed baselines from E0/E1/E2: set them before running E3."),
    "Custom test": (
        "One ad-hoc probe at your own levels — not an E1–E3 datapoint.",
        "Runs a single cell (experiment.py --exp cell) with any send rate(s), batch size, case count and\n"
        "workload overrides. Handy for 'sweep small first' checks. Overrides are recorded in run.json and\n"
        "get their own results folder; results appear in the CSV only, never in the paper's tables."),
    "History & results": (
        "Every run so far, its per-round results, and the exports for Excel.",
        "Left: every run in results/runlog.jsonl (a failed or cancelled attempt is its own row).\n"
        "Right: the selected run's rounds with the reported metrics. Storage (on-/off-chain bytes per\n"
        "event) is measured once per run, so it repeats on each round row.\n\n"
        "Exports: per-round CSV (one row per run x round, every setting + metric), summary tables (mean +- SD\n"
        "over repetitions, E1–E3 only) and charts (one per metric, one line per variant; none for the\n"
        "per-operation breakdown)."),
}

# ---------------------------------------------------------------- every sweeps.yaml input box
FIELD_HELP = {
    "seed": (
        "Seed of the random generator that PRE-GENERATES the transaction trace: which operation comes next\n"
        "(in the mix proportions), which evidence/case it targets, and the order.\n"
        "Same seed + settings -> the SAME operation sequence (which operation, which evidence, in which\n"
        "order) on all four variants, so differences come from the architecture, not the workload. Only the\n"
        "channel routing differs (1 channel for Standard/Anchoring, one per case for the Parallel variants),\n"
        "so run.json shows two trace hashes per cell: one for each pair. Repetitions reuse it.\n"
        "Keep it fixed for the whole campaign."),
    "workers": (
        "Caliper worker processes = the load-generating CLIENTS (4 per round, for every variant — not one per\n"
        "variant). They share the send rate and transaction count (5 tx/s = ~1.25 each); each replays its\n"
        "own slice of the trace. Not redundancy: several workers keep the client from being the bottleneck.\n"
        "Too few -> 'measured send rate' falls below 'send rate'; too many -> they take CPU from Fabric on\n"
        "this one laptop (their own CPU is NOT in the CPU column). Verify with the E0 ramp; fix before E1.\n"
        "cases x events per case must divide evenly by it."),
    "repetitions": (
        "How many times each cell (variant x levels) is run: r0, r1, ... — each on a FRESH ledger with the SAME\n"
        "trace. Tables show mean +- SD: the SD tells whether a difference between variants is bigger than\n"
        "run-to-run noise. 3 is the usual minimum; 5 gives a steadier SD. Cost: time\n"
        "(r=5 is ~2/3 more machine time than r=3). E0 and the ramp always run once."),
    "workload.evidence_per_case": (
        "Evidence items per case in the trace (baseline 20 cases x 20 = 400 items). Each item: one create,\n"
        "then transfers / access logs, and a dispose for the 'fraction disposed' share.\n"
        "More items spread the writes over more ledger keys -> fewer same-item collisions; each item costs one\n"
        "create. cases x this must be >= workers (every worker needs at least one item), and the rounds\n"
        "must hold every item's create + dispose."),
    "workload.events_per_case_per_round": (
        "Write transactions each case gets in ONE round (create/transfer/access/dispose, in the mix).\n"
        "Round size = cases x this (20 x 224 = 4,480 tx, split over the workers); it sets HOW MANY, the send\n"
        "rate sets HOW FAST: round length ~ round size / send rate (4,480 at 50 tx/s ~ 90 s).\n"
        "Per run each case gets rounds x this (5 x 224 = 1,120), above the steady floor of 1,000. The seeded\n"
        "trace scatters channels around it: the least-loaded Parallel channel gets 1,046–1,102 over the case\n"
        "grid (200 left some at 935–999, sub-floor). cases x this must divide by the\n"
        "workers for every case count (with 4 workers: a multiple of 4).\n"
        "High send rates make rounds short (4,480 tx at 200 tx/s ~ 22 s)."),
    "workload.rounds": (
        "Rounds per run when a run uses ONE send rate (E1, E2, E3b, single-rate Custom test). E3a ignores it:\n"
        "there each send rate is its own round.\n"
        "Each round replays the next slice of the same trace, and the ledger keeps growing across rounds (it is\n"
        "only reset between RUNS). After every round the ledger size is measured (t0 ... tN); bytes per event\n"
        "is the slope of a line fitted through those points (needs >= 3). More rounds -> longer runs."),
    "workload.mix.transfer_weight": (
        "Relative share of TransferCustody (the evidence changes custodian) among the follow-up events after\n"
        "each item's create. 0.15 : 0.85 -> ~15 % transfers, 85 % access logs (E0 trace: 28 of 208).\n"
        "On Standard/Parallel a transfer READS and UPDATES the evidence record on-chain, so two operations in\n"
        "flight on one item can collide (the first E0's 1-in-240 failures); the trace now keeps such pairs\n"
        ">= 110 items apart within a round (campaign traces; the E0 smoke trace, 60 items per worker, keeps\n"
        ">= 7 = S/8, 5.6 s at 5 tx/s). The anchored variants only enqueue events to the batcher, so they\n"
        "cannot collide. The weights are a modelling assumption (fixed proportions, values chosen\n"
        "for this benchmark): report them with the results."),
    "workload.mix.access_weight": (
        "Relative share of AccessLog (someone viewed/handled the evidence — a WRITE custody event) among the\n"
        "follow-up events. Only the ratio to the transfer weight matters (0.3 : 1.7 = 0.15 : 0.85).\n"
        "An access log only APPENDS a new entry, so it never collides."),
    "workload.mix.dispose_fraction": (
        "Share of evidence items whose lifecycle ENDS with DisposeEvidence (status -> DISPOSED; nothing is\n"
        "deleted). 0.5 ~ half, rounded per worker (E0: 12 of 20). Keeps all four operations in the mix.\n"
        "Standard/Parallel: the chaincode then rejects later transfers, and like a transfer it can collide.\n"
        "Anchoring/Parallel-Anchored: events are only enqueued, so nothing is checked or rejected on-chain.\n"
        "A modelling assumption: report it with the results."),
    "workload.payload_bytes": (
        "Size of the synthetic stand-in for each evidence FILE ('file size per evidence', in\n"
        "bytes). The file itself is NEVER on-chain — only its SHA-256 hash (ni-URI) is — so this does not\n"
        "change ledger growth or the comparison between variants."),
    "workload.audit_cases": (
        "Cases whose full chain of custody is reconstructed after the rounds (the first N of the trace) ->\n"
        "'audit time per case (s)' and 'audit time per event (ms)' ('how long to reconstruct one case's CoC').\n"
        "Standard/Parallel read each trail from the ledger; the anchored variants fetch receipts, recompute\n"
        "each Merkle path and check it against the on-chain root. More cases = steadier mean, longer run.\n"
        "Capped at the run's case count, so 50 audits every case of every run."),
    "anchoring.flush_timeout_ms": (
        "Anchored variants only. The batcher closes a batch when it holds 'batch size' events; this age timer\n"
        "would ALSO close it this many ms after its FIRST event. 0 = off: every batch really has the batch size\n"
        "you set. A timer would make the effective batch size depend on the send rate and blur E1 / E3a.\n"
        "The cost (events wait longer at low send rates) is measured as 'anchoring delay (s)'.\n"
        "The run-end partial batch is always flushed before measuring."),
    "anchoring.idle_timeout_ms": (
        "Anchored variants only. The idle timer closes a batch this many ms after its LAST event, however\n"
        "small the batch is (no cap). 0 = off (size-only batching, the default for every experiment). It\n"
        "bounds how long an accepted event can wait unprotected when events stop arriving; the sensitivity\n"
        "cell 'idle-5s' measures it. Each batch record says why it closed (size, idle, timeout, flush)."),
    "endorsement.policy": (
        "Who must endorse every chaincode transaction on the app channels. any = a peer of Org1 OR Org2\n"
        "(1-of-any, the default: it isolates the architecture's own cost); all = a peer of BOTH orgs\n"
        "(2-of-2, what a multi-party custody transfer would need). Set when the chaincode is committed, so a\n"
        "change takes effect at the next ledger reset. The sensitivity cell 'endorse-all' measures it."),
    "monitor.interval_s": (
        "Every this-many seconds during a round, Caliper's Docker monitor records each container's CPU % and\n"
        "memory MB. The table shows each container's average (max also kept), summed over the containers.\n"
        "Caliper's own workers are not included. Smaller = finer detail but a busier monitor; short rounds\n"
        "(a few seconds) get only one or two samples. Keep it constant for every run."),
    "regimes.steady.min_events_per_channel": (
        "A run is labelled 'steady' only if EVERY channel received at least this many write events during the\n"
        "run; otherwise 'sub-floor'. Only steady runs may be used for performance/scalability claims (short\n"
        "runs are dominated by start-up effects). Checked at plan time and again on the real trace.\n"
        "Labels: smoke (E0), steady, sub-floor (also ramp and per-operation runs, by design).\n"
        "A methodology rule — do not change it between experiments."),
    "baseline.send_rate_tps": (
        "Baseline SEND RATE (configured input, tx/s) used by E1, E2, E3b and the per-operation breakdown.\n"
        "From the E0 ramp: per variant, the highest healthy rate <= 1/2 of its saturation point; the baseline\n"
        "is the LOWEST of the four (all variants run at one rate)."),
    "baseline.batch_size": (
        "Baseline batch size (events per Merkle batch; Anchoring + Parallel-Anchored only), from E1 — then\n"
        "held fixed in E3 (the same value for both anchored variants)."),
    "baseline.channels": (
        "The set number of CASES — also the number of CHANNELS on Parallel / Parallel-Anchored (one channel\n"
        "per case). Before E2 it is a PROVISIONAL value: the E0 ramp and E1 run at it (report that E1 was\n"
        "calibrated there). After E2 it becomes the MEDIAN of E2's healthy range (never its maximum) for\n"
        "E3a, the per-operation breakdown and the Custom test default."),
    "baseline.channels_max": (
        "Top of E2's healthy range. E3b's case grid is trimmed to <= this, so E3b never measures the host\n"
        "running out of CPU."),
    "regimes.smoke.cases": "E0 smoke test: number of cases (Parallel variants get one channel per case).",
    "regimes.smoke.evidence_per_case": "E0 smoke test: evidence items per case (small on purpose).",
    "regimes.smoke.logs_per_case_min": (
        "E0 smoke test: cases x this = the size of the check rounds (100 tx): the Standard-only MVCC gate (all\n"
        "workers log to ONE evidence item) and the anchored-only verify round."),
    "regimes.smoke.logs_per_case_max": (
        "E0 smoke test: cases x this = the access logs in the smoke-logs round (about this many per case on\n"
        "average), and the smoke trace's events per case, rounded down so cases x events divides by the\n"
        "workers (24). Not a per-case cap."),
    "regimes.smoke.send_rate_tps": "E0 smoke test: a low send rate (tx/s) — it checks function, not speed.",
    "ramp.events_per_case_per_round": (
        "E0 ramp: events per case in each send-rate step. 224 = the E1/E3b round (20 cases x 224 = 4,480\n"
        "tx: ~22 s at 200 tx/s, ~7.5 min at 10 tx/s), so the ramp sees what they will. Short rounds mislead:\n"
        "Caliper's throughput window includes the wait for the last blocks (up to 2 s on every Parallel\n"
        "channel), so 40 (800 tx) would read ~0.89 x send rate at 50 tx/s (modelled) — 'saturated' when it\n"
        "is not. Past saturation a round lasts ~ transactions / actual throughput."),
    "send_rates_tps": (
        "Send-rate grid (configured input, tx/s): the ramp's steps (one round each, ascending). Must\n"
        "BRACKET saturation (>= 2 levels below, 1 above). 'Use trimmed grid' only drops the levels beyond\n"
        "the first one above the highest saturation point. E3a has its own ladder (e3a.send_rates_tps)."),
    "e3a.send_rates_tps": (
        "E3a's base ladder (configured input, tx/s): one round per rate, ascending, on one ledger. A variant\n"
        "that still keeps up at the top climbs on by itself (next ladder = the top rate x 1.25, x 1.25^2, ...)\n"
        "until it saturates or the load generator tops out; a saturated one gets one run halfway back."),
    "e3a.events_per_case_per_round": (
        "E3a base-ladder round size: events per case per send rate. 1,500 x 20 cases = 30,000 tx = 300 s of\n"
        "sending at 100 tx/s and 30 s at 1,000 tx/s, so the end-of-round wait for the last blocks (up to\n"
        "2 s) stays small. The climb's rounds are sized for at least 30 s at their top rate."),
    "batch_sizes": "E1's batch-size levels (events per batch) — ONE grid for Anchoring and Parallel-Anchored.",
    "channel_counts": (
        "E2's levels: channels (= cases, one channel per case). Bounded by the host: about one CPU core per\n"
        "fully loaded channel (Fabric guidance); WSL also has only ~7.6 GB of memory."),
    "case_counts": (
        "E3b's levels: number of cases (all 4 variants; Parallel variants get one channel per case).\n"
        "Trimmed to <= max cases from E2."),
}

# ---------------------------------------------------------------- Custom test factors, modes, buttons
CUSTOM_HELP = {
    "send": "Configured send rate(s), tx/s. Several values -> one round per rate, ascending (like E3a).",
    "batch": "Events per Merkle batch — used by Anchoring / Parallel-Anchored only.",
    "cases": "Cases in the trace for every variant = the channel count on Parallel variants (one per case).",
    "reuse": ("Run on the ledger as it stands: no reset and no backup — the benchmark's transactions are ADDED\n"
              "to it. The stack must already run this variant with exactly these case channels, and the ledger\n"
              "must hold no earlier benchmark trace (every trace reuses the evidence ids ev-cNNN-eNNN, so they\n"
              "would collide as duplicate creates). ONE run only."),
}
MODE_HELP = {
    "e0": "Functional check of all four variants at a low send rate. Results are labelled 'smoke'.",
    "ramp": "One round per send rate, ascending, to find roughly where each variant saturates.",
    "e3a": ("All 4 variants, one round per send rate from 100 tx/s; a variant that keeps up climbs on\n"
            "(x 1.25 per step) until it saturates or the load generator tops out. The run count grows."),
    "e3b": "All 4 variants, number of cases raised (up to max cases) at the baseline TOTAL send rate.",
    "e3c": "All 4 variants, number of cases raised at a fixed PER-CASE send rate (the total grows with them).",
    "ops": "Each operation as its own round at the E3 point; writes and reads in separate tables.",
    "sens": ("At the baseline point: the baseline cell, 2-of-2 endorsement (all 4 variants) and a 5 s idle\n"
             "batch timer (anchored variants), repetition by repetition so they share one night."),
}
BUTTON_HELP = {
    "Preview plan": "Shows what WOULD run (runs, regimes, sub-floor warnings, ETA). Changes nothing.",
    "Run…": ("Starts the experiment after a confirm dialog: backs up ALL your data first, then every run\n"
             "resets the ledger (manual-test trails erased until you Restore)."),
    "Resume…": "Like Run, but skips runs that already completed (e.g. after Cancel or a crash).",
    "Cancel": ("During a run: stops the app's own run (Caliper included); it is logged as failed and Resume\n"
               "picks it up. During Preview / backup: nothing further is started."),
    "Back up now": "Copies every data volume to backups/<time> (the stack stops for ~1 minute).",
    "Restore my test data…": ("Puts a backup back (your manual-test ledger, accounts, cases, files) and restarts\n"
                              "the stack. Benchmark results on disk are kept."),
    "Save changes": "Writes the input boxes into benchmark/sweeps.yaml (comments kept). Refused during a run.",
    "Revert (reload file)": "Discards unsaved edits and re-reads benchmark/sweeps.yaml.",
    "Export per-round CSV…": "One row per run x round with every setting and metric — opens in Excel.",
    "Export summary tables…": "Mean +- SD per variant and level over the repetitions (E1–E3 only).",
    "Generate tables + charts": ("Tables + one chart per metric, one line per variant (E1, E2, E3a, E3b; the\n"
                                 "per-operation breakdown gets its two tables, no charts)."),
    "decimal comma": "Use ';' separators and decimal commas — for Excel with Indonesian regional settings.",
}

# ---------------------------------------------------------------- results-table columns
COLUMN_HELP = {
    "run": "Experiment / variant / levels / repetition of the run.",
    "round": "Round label (slice<k> = trace slice, rate<R> = one send rate, smoke-* = E0 steps).",
    "send rate (tx/s)": "CONFIGURED send rate — the input you set (Caliper fixed-rate).",
    "throughput (TPS)": ("MEASURED successful transactions per second (failed ones excluded).\n"
                         "Standard/Parallel: committed on the ledger. Anchoring/Parallel-Anchored: events accepted\n"
                         "(enqueued) by the batcher; their on-chain commit lag is 'anchoring delay (s)'.\n"
                         "Below saturation it matches the send rate; past saturation it falls behind."),
    "latency min (s)": "Fastest transaction, submit -> commit (anchored variants: enqueue time).",
    "latency max (s)": "Slowest transaction — one outlier can dominate, so read it with avg and p95.",
    "latency avg (s)": ("Mean submit -> commit time (anchored variants: submit -> enqueued at the batcher).\n"
                        "The paper's latency column: avg (min–max)."),
    "latency p95 (s)": "95 % of transactions were at least this fast (from per-transaction logs).",
    "CPU (%)": ("Average CPU of each container, summed over the containers (100 % = one full core).\n"
                "Sampled every 'monitor interval' s. Near the host's total -> the laptop is the limit."),
    "memory (MB)": "Average memory of each container, summed over the containers.",
    "success (n)": "Transactions that succeeded: committed (Standard/Parallel) or accepted and enqueued (anchored).",
    "failure (n)": "Transactions that failed (e.g. the create/transfer race, timeouts).",
    "failure rate (%)": "failure / (success + failure) x 100.",
    "on-chain (B/event)": ("LEDGER growth per write event: block store of every channel, fitted over\n"
                           "the per-round checkpoints. Measured once per run."),
    "off-chain (B/event)": ("Receipt-store growth per event (anchored variants: event copy + Merkle path).\n"
                            "Shown so anchoring's ledger saving is never presented as free. Once per run."),
}
