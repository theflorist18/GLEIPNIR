"""Hover-help texts for benchapp.pyw (the "?" icons, tab headers, buttons and table columns).

Text only — no logic. Keep it in step with benchmark/sweeps.yaml, docs/methodology/experiments.md §4
and the supervisor guidance (GLEIPNIR_Supervisor_Guidance_Consolidated_2026-09-22.md).
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
        "E1, E2, E3b and the breakdown). D: batch size and channel count stay design factors, static in E3 —\n"
        "'tinggal pakai value itu terus' (said of batch and channel; the send-rate baseline is our pilot rule).\n"
        "Always 'baseline', never 'optimal'. The calibrations must be reported in the paper.\n\n"
        "Save writes benchmark/sweeps.yaml in place (comments kept). run.json cites that file's git SHA, so\n"
        "commit it before a campaign."),
    "E0 initial test": (
        "Goal: check everything works on all 4 variants, then find roughly where each variant saturates.",
        "SMOKE TEST (label 'smoke'): functional correctness only — never used for results.\n\n"
        "RAMP: steps the send rate up (one round per rate) to find where each variant's throughput stops\n"
        "keeping up (throughput < 0.9 x send rate = saturation). From it the app suggests the BASELINE\n"
        "SEND RATE (safely below saturation) and a trimmed send-rate grid for E3a.\n\n"
        "Tip: ramp coarsely first (e.g. 100 ... 1000 tx/s), then set E3a's grid finely around the point where\n"
        "throughput flattens. At that point look at the CPU column: headroom left = an architecture limit\n"
        "(the finding); CPU maxed out = the laptop itself (a threat to validity).\n"
        "Also check 'measured send rate' = 'send rate': if not, the Caliper workers were the bottleneck."),
    "E1 batch size": (
        "Goal: choose the baseline batch size for the anchored variants (calibration, reported in the paper).",
        "Varies the batch size (events per Merkle batch) on Anchoring and Parallel-Anchored — ONE grid for\n"
        "both. Standard and Parallel run only at that one point (not per batch size, with the usual\n"
        "repetitions) and appear as horizontal reference lines.\n"
        "Held fixed: the baseline send rate and case count.\n\n"
        "Trade-off: bigger batches -> fewer on-chain transactions and less ledger growth, but longer\n"
        "anchoring delay and more verification work per audit.\n\n"
        "Rule (methodology §4.1, confirm with D): the SMALLEST batch size where throughput and on-chain\n"
        "bytes/event change <= 5 % to the next level while audit time stays <= 1.5x the smallest level's.\n"
        "If the two variants disagree, the larger level is taken."),
    "E2 channels": (
        "Goal: find how many cases/channels Parallel handles on this host before it stops scaling.",
        "Parallel only (Parallel-Anchored inherits the result). One channel per case, so cases = channels.\n"
        "Held fixed: the baseline send rate.\n\n"
        "Rule (methodology §4.2, confirm with D): a level is HEALTHY while throughput >= 0.95x the previous\n"
        "level, failure rate <= 1 % and total CPU <= 0.9 x cores x 100 %. The healthy range runs from the\n"
        "lowest level up to the first unhealthy one.\n"
        "  baseline cases = the MEDIAN of that range (never its maximum — supervisor)\n"
        "  max cases      = its top (E3b does not go beyond it: past it you measure the host running out\n"
        "                   of CPU, not the architecture)."),
    "E3 main": (
        "Goal: the paper's main experiment — compare the 4 architectures' scalability, baselines fixed.",
        "E3a  scalability vs LOAD: send rate raised round by round; where does each variant saturate, how do\n"
        "     latency and failures behave?\n"
        "E3b  scalability vs CASES: number of cases raised (Parallel variants: one channel per case), up to\n"
        "     max cases — shows e.g. where Parallel starts losing to Standard.\n"
        "Per-operation breakdown: each operation (create, transfer, access, dispose + the reads) tested on its\n"
        "     own at one operating point — which operation is most expensive? does anchoring help all of\n"
        "     them? Writes and reads in separate tables (supervisor: 'masing-masing diuji').\n\n"
        "Uses the fixed baselines from E0/E1/E2. Supervisor gate: send D the variable table + three\n"
        "flowcharts before running E3."),
    "Custom test": (
        "One ad-hoc probe at your own levels — not an E1–E3 datapoint.",
        "Runs a single cell (experiment.py --exp cell) with any send rate(s), batch size, case count and\n"
        "workload overrides. Handy for 'sweep small first' checks. Overrides are recorded in run.json and\n"
        "get their own results folder; results appear in the CSV only, never in the paper's tables."),
    "History & results": (
        "Every run so far, its per-round results, and the exports for Excel.",
        "Left: every run in results/runlog.jsonl (a failed or cancelled attempt is its own row).\n"
        "Right: the selected run's rounds in the supervisor's columns. Storage (on-/off-chain bytes per\n"
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
        "Keep it fixed for the whole campaign (D: 'kamu pastiin seed-nya tuh tetap')."),
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
        "run-to-run noise. 3 is the usual minimum; D's example used 5 (open: confirm with D). Cost: time\n"
        "(r=5 is ~2/3 more machine time than r=3). E0 and the ramp always run once."),
    "workload.evidence_per_case": (
        "Evidence items per case in the trace (baseline 20 cases x 20 = 400 items). Each item: one create,\n"
        "then transfers / access logs, and a dispose for the 'fraction disposed' share.\n"
        "More items spread the writes over more ledger keys -> fewer same-item collisions; each item costs one\n"
        "create. cases x this must be >= workers (every worker needs at least one item), and the rounds\n"
        "must hold every item's create + dispose."),
    "workload.events_per_case_per_round": (
        "Write transactions each case gets in ONE round (create/transfer/access/dispose, in the mix).\n"
        "Round size = cases x this (20 x 200 = 4,000 tx, split over the workers); it sets HOW MANY, the send\n"
        "rate sets HOW FAST: round length ~ round size / send rate (4,000 at 50 tx/s = 80 s).\n"
        "Per run each case gets rounds x this (5 x 200 = 1,000) — the steady floor. The seeded trace scatters\n"
        "channels around it, so 200 leaves some Parallel channels at 935–999 (sub-floor); 224 clears the\n"
        "floor with margin (pending decision). cases x this must divide by the workers.\n"
        "High send rates make rounds short (224 x 20 at 200 tx/s ~ 22 s): check the ramp before raising it."),
    "workload.rounds": (
        "Rounds per run when a run uses ONE send rate (E1, E2, E3b, single-rate Custom test). E3a ignores it:\n"
        "there each send rate is its own round.\n"
        "Each round replays the next slice of the same trace, and the ledger keeps growing across rounds (it is\n"
        "only reset between RUNS). After every round the ledger size is measured (t0 ... tN); bytes per event\n"
        "is the slope of a line fitted through those points (needs >= 3). More rounds -> longer runs."),
    "workload.mix.transfer_weight": (
        "Relative share of TransferCustody (the evidence changes custodian) among the follow-up events after\n"
        "each item's create. 0.15 : 0.85 -> ~15 % transfers, 85 % access logs (E0 trace: 31 of 208).\n"
        "On Standard/Parallel a transfer READS and UPDATES the evidence record on-chain, so two operations in\n"
        "flight on one item can collide (the 1-in-240 failures). The anchored variants only enqueue events to\n"
        "the batcher, so they cannot collide. Our assumption: the guidance fixes the proportions\n"
        "('proporsinya tetap') but gives no numbers — state and justify it in Bab 3."),
    "workload.mix.access_weight": (
        "Relative share of AccessLog (someone viewed/handled the evidence — a WRITE custody event) among the\n"
        "follow-up events. Only the ratio to the transfer weight matters (0.3 : 1.7 = 0.15 : 0.85).\n"
        "An access log only APPENDS a new entry, so it never collides."),
    "workload.mix.dispose_fraction": (
        "Share of evidence items whose lifecycle ENDS with DisposeEvidence (status -> DISPOSED; nothing is\n"
        "deleted). 0.5 ~ half, rounded per worker (E0: 12 of 20). Keeps all four operations in the mix.\n"
        "Standard/Parallel: the chaincode then rejects later transfers, and like a transfer it can collide.\n"
        "Anchoring/Parallel-Anchored: events are only enqueued, so nothing is checked or rejected on-chain.\n"
        "Our assumption — state it in Bab 3."),
    "workload.payload_bytes": (
        "Size of the synthetic stand-in for each evidence FILE (the supervisor's 'file size per evidence', in\n"
        "bytes). The file itself is NEVER on-chain — only its SHA-256 hash (ni-URI) is — so this does not\n"
        "change ledger growth or the comparison between variants."),
    "workload.audit_cases": (
        "Cases whose full chain of custody is reconstructed after the rounds (the first N of the trace) ->\n"
        "'audit time per case (s)' — a mandatory metric ('how long to reconstruct one case's CoC').\n"
        "Standard/Parallel read each trail from the ledger; the anchored variants fetch receipts, recompute\n"
        "each Merkle path and check it against the on-chain root. More cases = steadier mean, longer run.\n"
        "Capped at the run's case count."),
    "anchoring.flush_timeout_ms": (
        "Anchored variants only. The batcher closes a batch when it holds 'batch size' events; a timeout would\n"
        "ALSO close it after this many ms. 0 = size-only: every batch really has the batch size you set.\n"
        "A timeout would make the effective batch size depend on the send rate and blur E1 / E3a.\n"
        "The cost (events wait longer at low send rates) is measured as 'anchoring delay (s)'.\n"
        "The run-end partial batch is always flushed before measuring."),
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
        "is the LOWEST of the four (all variants run at one rate). Rule: confirm with D."),
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
        "E0 ramp: events per case in each send-rate step. Small keeps the pilot short, but at high send rates\n"
        "the rounds get very short (20 cases x 40 = 800 tx = 4 s at 200 tx/s); ~200 gives a more reliable\n"
        "saturation estimate. Past saturation a round lasts ~ transactions / actual throughput."),
    "send_rates_tps": (
        "Send-rate grid (configured input, tx/s): the ramp's steps and E3a's levels (one round each,\n"
        "ascending). Must BRACKET saturation (>= 2 levels below, 1 above). Ramp coarsely first (e.g.\n"
        "100 ... 1000), then add finer E3a levels by hand around where throughput flattens. 'Use trimmed\n"
        "grid' only drops the levels beyond the first one above the highest saturation point."),
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
    "e3a": "All 4 variants, one round per send rate: where does each saturate?",
    "e3b": "All 4 variants, number of cases raised (up to max cases): scalability vs cases.",
    "ops": "Each operation as its own round at the E3 point; writes and reads in separate tables.",
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
    "on-chain (B/event)": ("LEDGER growth per write event: block store of every channel (incl. the anchor\n"
                           "channel), fitted over the per-round checkpoints. Measured once per run."),
    "off-chain (B/event)": ("Receipt-store growth per event (anchored variants: event copy + Merkle path).\n"
                            "Shown so anchoring's ledger saving is never presented as free. Once per run."),
}
