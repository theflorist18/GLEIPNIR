#!/usr/bin/env python3
"""GLEIPNIR experiment driver (docs/CONTRACTS.md §10, §11; supervisor brief 2026-09-22 §9).

  experiment.py --exp e0|ramp|e1|e2|e3a|e3b|ops|cell [--variant V]* [--reps N]
                [--resume] [--dry-run] [--reuse-network] [--no-monitor] [--no-audit]
                [--verbose] [--sweeps FILE]
                cell only: [--send-rate R [R ...]] [--batch-size B] [--cases N]
                           [--seed S] [--workers W] [--rounds K] [--events-per-case E]
                           [--evidence-per-case V] [--transfer-weight T] [--access-weight A]
                           [--dispose-fraction D] [--payload-bytes P] [--audit-cases N]
                           [--flush-timeout-ms F] [--monitor-interval I]

Plans (cells x repetitions; every run = ONE network lifetime):
  ONE channel per case on the parallel variants, everywhere (author decision 2026-09-24):
  a plan sets only the case count; parallel/parallel-anchored get that many case channels,
  standard/anchoring put the same cases on their one shared channel (same trace).
  e0    every variant, smoke shape at regimes.smoke.send_rate_tps, 1 rep — per-op
        smoke rounds + one replayed smoke trace slice (+ verify, anchored) + audit.
        Labelled `smoke`, never steady.
  ramp  every variant, 1 rep, one round per send rate at ramp.events_per_case_per_round;
        prints throughput vs send rate + a suggested baseline.send_rate_tps.
  e1    anchoring (1 ch) + parallel-anchored (baseline.channels) x batch_sizes x reps at
        baseline.send_rate_tps, workload.rounds slices; PLUS reference runs standard (1 ch)
        and parallel (baseline.channels) x reps at the same point (levels.reference).
  e2    parallel x channel_counts x reps at baseline.send_rate_tps (cases = channels).
  e3a   4 variants x reps; batch = baseline.batch_size; parallel* channels =
        baseline.channels; ONE round per send rate, ascending (slices 0..n-1).
  e3b   4 variants x case_counts (<= baseline.channels_max) x reps at baseline.send_rate_tps;
        parallel* channels = cases; standard/anchoring channels = 1.
  ops   4 variants x reps at the E3 point; rounds create/transfer/access/dispose
        (writes), read-evidence/read-trail (reads), verify-event (anchored only).
  cell  ONE ad-hoc cell x variants x reps, factor levels from the CLI: --send-rate
        (configured send rate, tx/s; several -> one round per rate, ascending, as e3a;
        one -> workload.rounds slices, as e1/e2/e3b), --batch-size (anchored only),
        --cases (the trace's cases for every variant = the channel count on the parallel
        ones; default baseline.channels). An omitted factor takes its sweeps.yaml
        baseline. The controlled
        workload (seed, workers, rounds, events/case, evidence/case, mix, payload, audit
        cases, flush timeout, monitor interval) is also CLI-settable for a cell only:
        applied to an in-memory copy of sweeps.yaml, recorded in run.json `overrides`,
        and tagged into the run dir (`-x<hash>`) so it never shares a dir with the
        defaults. A factor no selected variant uses is rejected, never ignored. Results
        land in results/cell/ (levels dir + `rate<R>`); a cell is a probe, not an
        E1-E3 datapoint, so report.py builds no aggregated table from it (CSV only).

Progress: every run prints `[run i/n]` with elapsed time and an ETA (median wall time
of the runs done so far, else of results/runlog.jsonl), every round `[round j/m]` and
a one-line result (success/failure/throughput/latency). Caliper's own output is cut
to its transaction-progress lines + warnings/errors (--verbose: everything); the full
log is always in rounds/<label>/caliper.log. After every completed run the per-round
CSV benchmark/results/<exp>/<exp>-results.csv is rewritten (report.export_rounds).

Per run: (1) stale artifacts cleared + run.json seeded (identity + controls +
provenance) -> (2) anchored: BATCH_SIZE/BATCH_FLUSH_MS/fresh BATCH_EPOCH in .env ->
(3) trace generated/looked up BEFORE the reset (pure + cheap, so a bad control fails
first); a `steady` plan label is re-checked against the trace's ACTUAL per-channel
write events (least-loaded channel; below the floor -> `sub-floor`) -> (4) network:
reset-network.sh by DEFAULT (needs GLEIPNIR_ALLOW_LEDGER_WIPE=1; it removes only the
ledger/receipt/verify-metrics volumes, never the library data). --reuse-network
keeps the running ledger for ONE ad-hoc run and then the stack must match (.env
VARIANT, exactly the case channels the cell uses) -> (5) anchored: batcher recreated
-> checkpoint t0 -> (6) per round: render bench.yaml,
`npx caliper launch manager` (tee caliper.log), anchored: settle the batcher (last
round: POST /flush + GET /status -> anchoring.json), checkpoint t<k+1> ->
(7) audit reconstruct -> (8) collect.py -> manifest.json (status complete) ->
(9) one line in results/runlog.jsonl.

A fresh ledger per run is not hygiene, it is validity: the trace replays
deterministic evidence ids, so a second run on the same ledger duplicates
CreateEvidence and starts its storage series dirty.

Results: benchmark/results/<exp>/<variant>/<levels>/r<rep>/ with levels like
`batch50-ch20-cases20` (fixed key order batch, ch, cases, ref). Failures are loud
(check=True everywhere, rounds asserted); --resume skips runs whose manifest says
`status: complete`. Never wipes a ledger without the env flag; never touches the
library volumes (see reset-network.sh).
"""
import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect as C  # noqa: E402
import report as REP  # noqa: E402
import rounds as R  # noqa: E402

REPO_ROOT = R.REPO_ROOT
BENCH_DIR = R.BENCH_DIR
ORCH = os.path.dirname(os.path.abspath(__file__))
COMPOSE_DIR = os.path.join(REPO_ROOT, "network", "compose")
ENV_PATH = os.path.join(COMPOSE_DIR, ".env")
RESULTS_DIR = os.path.join(BENCH_DIR, "results")
TRACES_DIR = os.path.join(BENCH_DIR, "traces")
RUNLOG = os.path.join(RESULTS_DIR, "runlog.jsonl")
EXPS = ["e0", "ramp", "e1", "e2", "e3a", "e3b", "ops", "cell"]
CELL_FLAGS = (("send_rate", "--send-rate"), ("batch_size", "--batch-size"), ("cases", "--cases"))
# The controlled workload — settable from the CLI for --exp cell ONLY (a campaign's controls
# stay those of sweeps.yaml): (flag, sweeps.yaml path, type, min, max, help).
CONTROL_FLAGS = (
    ("--seed", "seed", int, 0, None, "trace PRNG seed"),
    ("--workers", "workers", int, 1, None, "Caliper worker processes"),
    ("--rounds", "workload.rounds", int, 1, None, "trace slices per run at ONE send rate"),
    ("--events-per-case", "workload.events_per_case_per_round", int, 1, None,
     "write events per case per round (a round submits cases x this transactions)"),
    ("--evidence-per-case", "workload.evidence_per_case", int, 1, None, "evidence items per case"),
    ("--transfer-weight", "workload.mix.transfer_weight", float, 0, None,
     "relative weight of TransferCustody among follow-up events"),
    ("--access-weight", "workload.mix.access_weight", float, 0, None,
     "relative weight of AccessLog among follow-up events"),
    ("--dispose-fraction", "workload.mix.dispose_fraction", float, 0, 1,
     "fraction of evidence that ends with DisposeEvidence"),
    ("--payload-bytes", "workload.payload_bytes", int, 0, None, "synthetic Codex-Entry filler per event (B)"),
    ("--audit-cases", "workload.audit_cases", int, 1, None, "cases reconstructed for the audit time"),
    ("--flush-timeout-ms", "anchoring.flush_timeout_ms", int, 0, None, "batcher flush timeout (0 = size-only)"),
    ("--monitor-interval", "monitor.interval_s", int, 1, None, "docker resource monitor sampling interval (s)"),
)
# Anywhere in the line, so Node's raw TypeError/RangeError and "(node:N) Warning" crash text shows too.
PROGRESS_RE = re.compile(r"Transaction Info\]|Finished round|error|warn|fail", re.I)
CALIPER = {"version": "0.6.0", "binding": "fabric:fabric-gateway"}   # benchmark/README.md
CONFIG_FILES = [
    "network/configtx/configtx.yaml", "network/core.yaml", "network/orderer.yaml",
    "network/compose/compose-net.yaml", "network/compose/compose-ca.yaml", "network/compose/compose-services.yaml",
]
PEER_CHAINS = "/var/hyperledger/production/ledgersData/chains/chains"


# ------------------------------------------------------------------ small helpers

def now_iso():
    return datetime.now(timezone.utc).isoformat()


def sh(cmd, cwd=REPO_ROOT, env=None, capture=False):
    print("+ " + " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, env=env, check=True, capture_output=capture, text=True)


def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""


def read_env():
    env = {}
    if os.path.exists(ENV_PATH):
        for ln in open(ENV_PATH, encoding="utf-8").read().splitlines():
            if "=" in ln and not ln.lstrip().startswith("#"):
                k, v = ln.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def set_env_var(key, value):
    """Write/replace KEY=VALUE in network/compose/.env (mirrors lib.sh set_env_var)."""
    lines = open(ENV_PATH, encoding="utf-8").read().splitlines() if os.path.exists(ENV_PATH) else []
    for i, ln in enumerate(lines):
        if ln.startswith(key + "="):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    with open(ENV_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")


def compose(*args):
    sh(["docker", "compose", "-p", "gleipnir", "--project-directory", COMPOSE_DIR,
        "-f", os.path.join(COMPOSE_DIR, "compose-net.yaml"),
        "-f", os.path.join(COMPOSE_DIR, "compose-ca.yaml"),
        "-f", os.path.join(COMPOSE_DIR, "compose-services.yaml"), *args])


def http(url, method="GET", timeout=60):
    req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body.strip() else {}


def wait_http(url, tries=30):
    for _ in range(tries):
        try:
            http(url, timeout=3)
            return
        except Exception:  # noqa: BLE001
            time.sleep(1)
    raise RuntimeError(f"timeout waiting for {url}")


def mem_gb():
    try:
        for ln in open("/proc/meminfo", encoding="utf-8"):
            if ln.startswith("MemTotal:"):
                return round(int(ln.split()[1]) / (1024 * 1024), 1)
    except OSError:
        pass
    return None


def load_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def dump_json(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)


# ------------------------------------------------------------------ plan

def levels_dir(levels, rates=None, tag=None):
    parts = []
    if levels.get("batchSize") is not None:
        parts.append(f"batch{levels['batchSize']}")
    parts += [f"ch{levels['channels']}", f"cases{levels['cases']}"]
    if rates:   # cell only: the send rate is a free factor there, so two cells must not share a dir
        parts.append("rate" + "-".join(str(r) for r in rates))
    if levels.get("reference"):
        parts.append("ref")
    if tag:     # cell with CLI control overrides: never shares a dir with the sweeps.yaml defaults
        parts.append(tag)
    return "-".join(parts)


def overrides_tag(overrides):
    return "x" + hashlib.sha256(json.dumps(overrides, sort_keys=True).encode()).hexdigest()[:6] if overrides else None


def fit_events(cases, wanted, workers):
    """Largest v <= wanted with casesxv divisible by workers (per-worker slice must be an integer)."""
    for v in range(wanted, 0, -1):
        if (cases * v) % workers == 0:
            return v
    sys.exit(f"FATAL: no events_per_case_per_round <= {wanted} makes casesxevents divisible by workers={workers}")


def make_run(sweeps, exp, variant, rep, kind, cases, batch, rates, events, rounds_n, reference=False,
             overrides=None):
    w = sweeps["workload"]
    # One channel per case on the parallel variants — structural: a plan passes only the case
    # count, so channels can never drift from cases. Standard/Anchoring: 1 (rounds.channels_for).
    ch = R.channels_for(variant, cases)
    batch = batch if variant in R.ANCHORED_VARIANTS else None
    levels = {"batchSize": batch, "channels": ch, "cases": cases,
              "sendRateTps": rates[0] if len(set(rates)) == 1 else None, "reference": bool(reference)}
    trace = None
    if kind in ("trace", "smoke"):
        if (cases * events) % sweeps["workers"]:
            # Caught at plan time: trace/generate.js would only throw after the ledger reset.
            sys.exit(f"FATAL: {exp}/{variant}: cases x events_per_case_per_round = {cases} x {events} is not "
                     f"divisible by workers={sweeps['workers']} (the per-worker trace slice must be an integer)")
        evidence = sweeps["regimes"]["smoke"]["evidence_per_case"] if kind == "smoke" else w["evidence_per_case"]
        trace = {"seed": sweeps["seed"], "cases": cases, "channels": ch, "evidence_per_case": evidence,
                 "events_per_case_per_round": events, "rounds": rounds_n, "workers": sweeps["workers"],
                 "mix": dict(w["mix"]), "payload_bytes": w["payload_bytes"]}
        per_case = rounds_n * events
    else:  # ops: create + transfer + access + dispose over the pool
        per_case = 4 * w["evidence_per_case"]
    # The floor is a per-CHANNEL rule: one case per channel on the parallel variants, every case
    # on the single channel otherwise. NOMINAL count — execute() re-checks a `steady` label
    # against the generated trace's actual per-channel counts (they scatter around this).
    min_channel_events = per_case * (cases // ch)
    if exp == "e0":
        regime = "smoke"
    elif exp in ("ramp", "ops"):
        # Never a scalability datapoint, whatever the arithmetic says: the floor
        # rule divides by the channel count, so it would label the same ramp/ops
        # workload `steady` on the single-channel variants and `sub-floor` on the
        # multi-channel ones — mixed labels inside one table, and a pilot ramp
        # citable as steady state. Documented in CLAUDE.md / CONTRACTS §12-14.
        regime = "sub-floor"
    else:
        regime = "steady" if min_channel_events >= sweeps["regimes"]["steady"]["min_events_per_channel"] else "sub-floor"
    lv_dir = levels_dir(levels, sorted(set(rates)) if exp == "cell" else None, overrides_tag(overrides))
    run_id = f"{exp}/{variant}/{lv_dir}/r{rep}"
    return {"runId": run_id, "exp": exp, "variant": variant, "rep": rep, "kind": kind, "levels": levels,
            "overrides": dict(overrides or {}),
            "regime": regime, "rates": list(rates), "trace": trace, "writeEventsPerChannel": min_channel_events,
            "audit": trace is not None, "dir": os.path.join(RESULTS_DIR, *run_id.split("/"))}


def _dest(flag):
    return flag[2:].replace("-", "_")


def apply_controls(args, sweeps):
    """--exp cell: CLI control overrides applied to an in-memory COPY of sweeps.yaml (the file is
    never rewritten). Returns (effective sweeps, {sweeps.yaml path: value}) — the dict goes into
    every run.json so a cell run states exactly which controls departed from the file."""
    given = [(flag, path, getattr(args, _dest(flag)), lo, hi) for flag, path, _, lo, hi, _ in CONTROL_FLAGS
             if getattr(args, _dest(flag)) is not None]
    if not given:
        return sweeps, {}
    if args.exp != "cell":
        sys.exit(f"{', '.join(g[0] for g in given)} only apply to --exp cell; a campaign's controls come from "
                 f"sweeps.yaml (edit it, or pass --sweeps <file>)")
    sw, overrides = copy.deepcopy(sweeps), {}
    for flag, path, val, lo, hi in given:
        if val < lo or (hi is not None and val > hi):
            sys.exit(f"{flag} must be in [{lo}, {'inf' if hi is None else hi}] (got {val})")
        node, keys = sw, path.split(".")
        for k in keys[:-1]:
            node = node[k]
        node[keys[-1]] = val
        overrides[path] = val
    return sw, overrides


def cell_levels(args, sweeps, variants):
    """Resolve + validate the --exp cell factor levels; None for every other exp.

    A factor flag that no selected variant uses is an error, not a no-op: a run
    labelled with a batch size it never used is mislabelled data. --cases is used by every
    variant (and IS the channel count on the parallel ones), so it is never rejected that way.
    """
    given = [flag for dest, flag in CELL_FLAGS if getattr(args, dest) is not None]
    if args.exp != "cell":
        if given:
            sys.exit(f"{', '.join(given)} only apply to --exp cell; --exp {args.exp} takes every level from sweeps.yaml")
        return None
    for dest, flag in CELL_FLAGS:
        val = getattr(args, dest)
        if val is not None and min(val if isinstance(val, list) else [val]) < 1:
            sys.exit(f"{flag} must be >= 1 (got {val})")
    used = set(variants)
    if args.batch_size is not None and not used & set(R.ANCHORED_VARIANTS):
        sys.exit("--batch-size is used only by anchoring and parallel-anchored; select one with --variant")
    b = sweeps["baseline"]
    cases = args.cases or b["channels"]   # the set case count; = the channel count on parallel variants
    if cases > (os.cpu_count() or cases) and used & set(R.MULTI_CHANNEL_VARIANTS):
        print(f"  ! {cases} cases = {cases} channels > {os.cpu_count()} host cores: beyond the E2 bound "
              "(one core per fully-loaded channel)")
    rates = sorted(set(args.send_rate or [b["send_rate_tps"]]))
    if getattr(args, "rounds", None) is not None and len(rates) > 1:
        sys.exit("--rounds applies to ONE send rate; with several send rates every rate is one round")
    return {"rates": rates, "batch": args.batch_size or b["batch_size"], "cases": cases}


def plan(sweeps, exp, variants, reps, cell=None):
    b, w, s = sweeps["baseline"], sweeps["workload"], sweeps["regimes"]["smoke"]
    rate, batch = b["send_rate_tps"], b["batch_size"]
    n_rounds, events = w["rounds"], w["events_per_case_per_round"]

    runs = []
    if exp == "e0":
        ev = fit_events(s["cases"], s["logs_per_case_max"], sweeps["workers"])
        for v in variants:
            runs.append(make_run(sweeps, exp, v, 0, "smoke", s["cases"], batch, [s["send_rate_tps"]], ev, 1))
    elif exp == "ramp":
        rates = sorted(sweeps["send_rates_tps"])   # ascending: a ramp must climb into saturation, not jump
        for v in variants:
            runs.append(make_run(sweeps, exp, v, 0, "trace", b["channels"], batch, rates,
                                 sweeps["ramp"]["events_per_case_per_round"], len(rates)))
    elif exp == "e1":
        for v in [x for x in variants if x in R.ANCHORED_VARIANTS]:
            for bs in sweeps["batch_sizes"]:
                for r in range(reps):
                    runs.append(make_run(sweeps, exp, v, r, "trace", b["channels"], bs,
                                         [rate] * n_rounds, events, n_rounds))
        for v in [x for x in variants if x in ("standard", "parallel")]:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, v, r, "trace", b["channels"], None,
                                     [rate] * n_rounds, events, n_rounds, reference=True))
    elif exp == "e2":
        for ch in sweeps["channel_counts"]:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, "parallel", r, "trace", ch, None,
                                     [rate] * n_rounds, events, n_rounds))
    elif exp == "e3a":
        rates = sorted(sweeps["send_rates_tps"])   # brief §9: one round per send rate, ASCENDING
        for v in variants:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, v, r, "trace", b["channels"], batch,
                                     rates, events, len(rates)))
    elif exp == "e3b":
        for cases in [c for c in sweeps["case_counts"] if c <= b["channels_max"]]:
            for v in variants:
                for r in range(reps):
                    runs.append(make_run(sweeps, exp, v, r, "trace", cases, batch,
                                         [rate] * n_rounds, events, n_rounds))
    elif exp == "ops":
        for v in variants:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, v, r, "ops", b["channels"], batch,
                                     [rate], None, None))
    elif exp == "cell":
        # Several send rates -> one round each, ascending (the e3a shape); one rate ->
        # workload.rounds slices at it (the e1/e2/e3b shape).
        per_round = cell["rates"] if len(cell["rates"]) > 1 else cell["rates"] * n_rounds
        for v in variants:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, v, r, "trace", cell["cases"], cell["batch"],
                                     per_round, events, len(per_round), overrides=cell.get("overrides")))
    for run in runs:
        if run["regime"] == "sub-floor" and exp not in ("ramp", "ops"):   # those are sub-floor by design
            print(f"  ! {run['runId']}: {run['writeEventsPerChannel']:.0f} write events on the least-loaded channel < "
                  f"{sweeps['regimes']['steady']['min_events_per_channel']} -> labelled sub-floor, not steady")
    return runs


def build_rounds(sweeps, run, trace_path):
    v, rate = run["variant"], run["rates"][0]
    if run["kind"] == "ops":
        return R.ops_rounds(sweeps, v, run["levels"]["cases"], rate)
    t = run["trace"]
    slice_size = t["cases"] * t["events_per_case_per_round"] // sweeps["workers"]
    if run["kind"] == "smoke":
        return R.smoke_rounds(sweeps, v) + [R.trace_round(sweeps, v, "smoke-trace", trace_path, 0, slice_size, rate)]
    per_rate = len(set(run["rates"])) > 1
    return [R.trace_round(sweeps, v, f"rate{r}" if per_rate else f"slice{k}", trace_path, k, slice_size, r)
            for k, r in enumerate(run["rates"])]


# ------------------------------------------------------------------ lifecycle steps

def provenance(run, sweeps_path):
    env = read_env()
    return {"gitCommit": git("rev-parse", "HEAD"),
            "configShas": {rel: git("hash-object", rel) for rel in CONFIG_FILES},
            "sweepsSha": git("hash-object", sweeps_path),   # the file actually loaded (--sweeps)
            "sweepsPath": os.path.relpath(sweeps_path, REPO_ROOT),
            "caliper": {**CALIPER, "connector": R.mode_for(run["variant"])},
            "fabricTag": env.get("FABRIC_TAG"),
            "host": {"cores": os.cpu_count(), "memGb": mem_gb(), "platform": sys.platform}}


STALE_ARTIFACTS = ("checkpoints.jsonl", "anchoring.json", "audit.json", "manifest.json")


def clean_run_dir(run):
    """Clear a re-executed run's artifacts before it starts.

    The per-transaction logs (txlog.js) and checkpoints.jsonl are APPENDED, so a
    retried or interrupted run left in place would be collected together with
    the previous attempt: doubled counts, percentiles over two attempts, a send
    rate computed across the gap, and an inflated storage series.
    """
    rounds_dir = os.path.join(run["dir"], "rounds")
    if os.path.isdir(rounds_dir):
        shutil.rmtree(rounds_dir)
    for name in STALE_ARTIFACTS:
        path = os.path.join(run["dir"], name)
        if os.path.exists(path):
            os.remove(path)


def seed_run_json(run, sweeps, sweeps_path):
    os.makedirs(run["dir"], exist_ok=True)
    clean_run_dir(run)
    # The trace params (added once the trace exists) carry seed/mix/events/rounds; these are the
    # controls every run has, trace or not (ops runs have none but still use workers/pool/payload).
    w = sweeps["workload"]
    controls = {"workers": sweeps["workers"],
                "evidencePerCase": run["trace"]["evidence_per_case"] if run["trace"] else w["evidence_per_case"],
                "payloadBytes": w["payload_bytes"], "auditCases": audit_cases(sweeps, run),
                "flushTimeoutMs": sweeps["anchoring"]["flush_timeout_ms"],
                "monitorIntervalS": sweeps["monitor"]["interval_s"]}
    doc = {"runId": run["runId"], "experiment": run["exp"], "variant": run["variant"], "levels": run["levels"],
           "repetition": run["rep"], "regime": run["regime"], "status": "running", "trace": None,
           "controls": controls, "overrides": run["overrides"],
           "provenance": provenance(run, sweeps_path), "startedAt": now_iso(), "finishedAt": None,
           "wallSeconds": None}
    dump_json(os.path.join(run["dir"], "run.json"), doc)
    return doc


def ensure_network(run, fresh):
    """Step 2: every run gets its OWN ledger (brief §9; spec §5.5-6).

    The trace replays deterministic evidence ids, so a second run against the
    same ledger fails every CreateEvidence on the direct-write variants and
    silently appends duplicate events to the off-chain trail on the anchored
    ones — the repetitions would be neither independent nor valid, and the
    storage series would start dirty. Hence fresh-by-default; --reuse-network is
    an explicit, warned-about escape hatch for a single ad-hoc run.
    """
    v, ch = run["variant"], run["levels"]["channels"]
    reset = os.path.join(ORCH, "reset-network.sh")
    if fresh:
        if os.environ.get("GLEIPNIR_ALLOW_LEDGER_WIPE") != "1":
            sys.exit("refusing to reset ledgers: a campaign resets the ledger before every run and that "
                     "needs GLEIPNIR_ALLOW_LEDGER_WIPE=1.\n"
                     "  reset-network.sh removes ONLY the ledger/receipt/verify-metrics volumes — never the "
                     "library data (accounts, cases, blobs) — but back up first if in doubt:\n"
                     f"    bash {os.path.join(ORCH, 'backup-volumes.sh')} <dir>\n"
                     f"  then re-run with GLEIPNIR_ALLOW_LEDGER_WIPE=1, or reset by hand:\n"
                     f"    GLEIPNIR_ALLOW_LEDGER_WIPE=1 bash {reset} --variant {v} --channels {ch}\n"
                     "  (single ad-hoc run against the ledger as it stands: --reuse-network)")
        sh(["bash", reset, "--variant", v, "--channels", str(ch)])
        return
    print("  ! --reuse-network: this run inherits the ledger as it stands. Valid for ONE run only — a second "
          "run of the same trace collides on the evidence ids it replays (duplicate CreateEvidence) and the "
          "storage delta starts from a dirty t0.")
    env = read_env()
    if env.get("VARIANT") != v:
        sys.exit(f"running stack is VARIANT={env.get('VARIANT')} but this run needs {v}: "
                 f"drop --reuse-network (with GLEIPNIR_ALLOW_LEDGER_WIPE=1) or bring up {v} first")
    out = sh(["docker", "exec", "peer0.org1.example.com", "ls", PEER_CHAINS], capture=True).stdout.split()
    if v in R.MULTI_CHANNEL_VARIANTS:
        wanted = {R.case_name(i) for i in range(1, ch + 1)}
        extra = sorted(c for c in out if c.startswith("case-") and c not in wanted)
        if extra:
            # Idle channels still hold ledger dirs (they enter the checkpoint
            # series) and still cost the peer CPU, so a stack left at 50 channels
            # must not silently serve a 5-channel cell.
            sys.exit(f"stack has case channels this run does not use ({', '.join(extra)}); a {ch}-channel cell "
                     f"must run on exactly {ch} case channels. Drop --reuse-network, or reset by hand:\n"
                     f"  GLEIPNIR_ALLOW_LEDGER_WIPE=1 bash {reset} --variant {v} --channels {ch}")
        for name in sorted(wanted - set(out)):
            sh(["bash", os.path.join(ORCH, "provision-channel.sh"), name])
    elif "coc-main" not in out:
        sys.exit(f"coc-main is not provisioned on peer0.org1 (channels seen: {out}); bring up {v} first")


def set_batcher_env(run, sweeps):
    set_env_var("BATCH_SIZE", run["levels"]["batchSize"])
    set_env_var("BATCH_FLUSH_MS", sweeps["anchoring"]["flush_timeout_ms"])
    set_env_var("BATCH_EPOCH", f"{run['runId'].replace('/', '-')}-{int(time.time())}")


def recreate_batcher(batcher_url):
    compose("--profile", "anchoring", "--profile", "parallel-anchored", "up", "-d", "--force-recreate", "merkle-batcher")
    wait_http(batcher_url + "/healthz")


def trace_argv(t, out):
    return ["node", os.path.join(BENCH_DIR, "trace", "generate.js"),
            "--seed", str(t["seed"]), "--cases", str(t["cases"]), "--channels", str(t["channels"]),
            "--evidence-per-case", str(t["evidence_per_case"]),
            "--events-per-case-per-round", str(t["events_per_case_per_round"]),
            "--rounds", str(t["rounds"]), "--workers", str(t["workers"]),
            "--transfer-weight", str(t["mix"]["transfer_weight"]), "--access-weight", str(t["mix"]["access_weight"]),
            "--dispose-fraction", str(t["mix"]["dispose_fraction"]), "--payload-bytes", str(t["payload_bytes"]),
            "--out", out]


def ensure_trace(t):
    """Generate (deterministic, cheap) -> benchmark/traces/<hash>.json; returns (path, doc)."""
    os.makedirs(TRACES_DIR, exist_ok=True)
    pending = os.path.join(TRACES_DIR, f"pending-{os.getpid()}.json")
    try:
        out = sh(trace_argv(t, pending), cwd=BENCH_DIR, capture=True).stdout
    except subprocess.CalledProcessError as e:   # capture=True swallows the generator's reason
        sys.exit(f"FATAL: trace/generate.js failed: {(e.stderr or e.stdout or '').strip()}")
    m = re.findall(r"\b[0-9a-f]{64}\b", out)
    if not m:
        sys.exit(f"FATAL: trace/generate.js printed no sha256 hash:\n{out}")
    final = os.path.join(TRACES_DIR, f"{m[-1]}.json")
    if os.path.exists(final):
        os.remove(pending)
    else:
        os.replace(pending, final)
    doc = load_json(final) or sys.exit(f"FATAL: cannot read trace {final}")
    if doc.get("hash") != m[-1]:
        sys.exit(f"FATAL: trace hash mismatch: printed {m[-1]}, file says {doc.get('hash')}")
    return final, doc


def check_trace(t):
    """Plan-time: `generate.js --dry` (writes nothing) -> its JSON ({hash, opCounts,
    minChannelWriteEvents, ...}), so a trace the generator rejects (e.g. CLI controls asking for
    more items per worker than the rounds can hold) fails before anything runs. None if node is
    missing on this host (the run itself still generates and checks the trace)."""
    try:
        out = subprocess.run(trace_argv(t, os.devnull) + ["--dry"], cwd=BENCH_DIR, check=True,
                             capture_output=True, text=True).stdout
    except OSError:
        return None
    except subprocess.CalledProcessError as e:
        sys.exit(f"FATAL: these controls do not make a valid trace: {(e.stderr or e.stdout or '').strip()}")
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def preview_floor(sweeps, runs, cell):
    """Plan-time view of what recheck_floor() will do at run time: a `steady` run whose generated
    trace leaves its least-loaded channel under the floor is shown as sub-floor now (the generator
    fixes totals per worker, not per case). Also validates every cell trace."""
    floor = sweeps["regimes"]["steady"]["min_events_per_channel"]
    groups = {}
    for r in runs:
        if r["trace"] and (cell or r["regime"] == "steady"):
            groups.setdefault(json.dumps(r["trace"], sort_keys=True), []).append(r)
    for rs in groups.values():
        dry = check_trace(rs[0]["trace"])
        low = (dry or {}).get("minChannelWriteEvents")
        if low is None or low >= floor:
            continue
        steady = [r for r in rs if r["regime"] == "steady"]
        for r in steady:
            r["regime"], r["writeEventsPerChannel"] = "sub-floor", low
        if steady:
            print(f"  ! {len(steady)} run(s) ({steady[0]['runId']}{' ...' if len(steady) > 1 else ''}): the trace's "
                  f"least-loaded channel gets {low} write events < {floor} -> will run as sub-floor")


def channel_events(tdoc):
    """{case-NNN channel: write events} from a generated trace — the ACTUAL per-channel load.

    Every trace item is a ledger write (CREATE/TRANSFER/ACCESS/DISPOSE). The generator fixes the
    total per worker, not per case, so channels scatter around the nominal rounds x events x
    cases/channel (e.g. 935..1070 at a nominal 1000)."""
    counts = {}
    for seq in tdoc.get("workers") or []:
        for item in seq:
            counts[item["caseId"]] = counts.get(item["caseId"], 0) + 1
    return counts


def recheck_floor(run, doc, tdoc, sweeps):
    """The plan's `steady` label is nominal; the replayed trace is what the ledger actually gets.
    Records the least-loaded channel's write events and demotes the run if it is below the floor."""
    per_channel = channel_events(tdoc)
    doc["minChannelWriteEvents"] = min(per_channel.values()) if per_channel else None
    floor = sweeps["regimes"]["steady"]["min_events_per_channel"]
    if run["regime"] == "steady" and (doc["minChannelWriteEvents"] or 0) < floor:
        low = sorted(c for c, n in per_channel.items() if n < floor)
        print(f"  ! {len(low)}/{len(per_channel)} channel(s) of the generated trace carry < {floor} write events "
              f"(min {doc['minChannelWriteEvents']}: {', '.join(low[:5])}{' ...' if len(low) > 5 else ''})"
              " -> labelled sub-floor, not steady", flush=True)
        run["regime"] = doc["regime"] = "sub-floor"


def checkpoint(run, label):
    sh([sys.executable, os.path.join(ORCH, "checkpoint.py"), run["runId"], "--label", label])


def network_config_path(run):
    """Relative to benchmark/ — except parallel, whose parallel-c{C}.yaml rounds.py renders
    into the run dir, passed as that ABSOLUTE path; the paths inside resolve against the
    Caliper workspace, not the file's location."""
    rel = R.network_config(run["variant"], run["levels"]["channels"])
    if run["variant"] != "parallel":
        return rel
    path = os.path.join(run["dir"], os.path.basename(rel))
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(R.render_parallel_network(run["levels"]["channels"]))
    return path


def launch_round(sweeps, run, spec, index, env, monitor, verbose=False):
    rdir = os.path.join(run["dir"], "rounds", spec["label"])
    os.makedirs(rdir, exist_ok=True)
    bench = os.path.join(rdir, "bench.yaml")
    with open(bench, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(R.dump_yaml(R.render_round(sweeps, run["variant"], spec, run["levels"]["channels"], monitor),
                             [f"# run {run['runId']} round {index} ({spec['label']})"]))
    dump_json(os.path.join(rdir, "round.json"),
              {"index": index, "label": spec["label"], "sendRateTps": spec["sendRateTps"], "module": spec["module"],
               "txNumber": spec["txNumber"], "slice": spec["arguments"].get("slice"), "arguments": spec["arguments"]})
    npx = shutil.which("npx") or "npx"
    cmd = [npx, "caliper", "launch", "manager", "--caliper-workspace", ".",
           "--caliper-benchconfig", bench,
           "--caliper-networkconfig", network_config_path(run),
           "--caliper-report-path", os.path.join(rdir, "report.html")]
    log_path = os.path.join(rdir, "caliper.log")
    print(f"+ (in benchmark/) {' '.join(cmd)}  | tee {log_path}", flush=True)
    round_env = {**env, "GLEIPNIR_TXLOG_DIR": rdir}
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen(cmd, cwd=BENCH_DIR, env=round_env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, errors="replace")
        for line in proc.stdout:
            log.write(line)
            if verbose or PROGRESS_RE.search(line):   # Caliper's tx-progress lines, warnings, errors
                sys.stdout.write(line)
        proc.wait()
    text = open(log_path, encoding="utf-8", errors="replace").read()
    if proc.returncode != 0 or "### All test results ###" not in text:
        raise RuntimeError(f"caliper round {spec['label']} failed (exit {proc.returncode}); see {log_path}")


def round_result(run, spec):
    """One-line result of a finished round, parsed exactly as collect.py will parse it."""
    rdir = os.path.join(run["dir"], "rounds", spec["label"])
    try:
        rows = C.parse_caliper_log(os.path.join(rdir, "caliper.log"))["results"]
        row = next((r for r in rows if r["Name"] == spec["label"]), None)
        if row is None:
            return "no result row in caliper.log"
        s = C.round_summary(row)
        p95 = (((C.txlog_metrics(C.load_txlog(rdir)) or {}).get("latencyMs")) or {}).get("p95")
        total = s["succ"] + s["fail"]
        lat = s["latency"]
        return (f"success {s['succ']} | failure {s['fail']} ({100.0 * s['fail'] / total if total else 0:.2f} %) | "
                f"throughput {s['throughputSuccessfulOnlyTps']} TPS at send rate {spec['sendRateTps']} tx/s | "
                f"latency avg {lat['avgS']} s (min {lat['minS']} - max {lat['maxS']})"
                + (f", p95 {p95 / 1000:.3f} s" if isinstance(p95, (int, float)) else ""))
    except Exception as e:  # noqa: BLE001 - the progress line is cosmetic; collect.py is the real parse
        return f"summary unavailable ({e})"


def hms(seconds):
    return str(timedelta(seconds=int(seconds))) if seconds is not None else "?"


def flush_batcher(run, batcher_url):
    http(batcher_url + "/flush", method="POST", timeout=300)
    dump_json(os.path.join(run["dir"], "anchoring.json"), http(batcher_url + "/status"))


def settle_batcher(batcher_url, tries=60):
    """Wait until no closed batch is still waiting for its root to commit.

    The batcher commits roots asynchronously, so a checkpoint taken the instant
    Caliper exits can miss the last batches' root bytes and receipts and
    attribute them to the NEXT round's checkpoint. Read-only on purpose: it
    never flushes, which would change batch composition mid-run.
    """
    for _ in range(tries):
        st = http(batcher_url + "/status")
        if not any(b.get("rootStatus") == "pending" for b in st.get("batches", [])):
            return
        time.sleep(1)
    print("  ! batcher still has pending roots after the settle wait — the next checkpoint may undercount")


def audit_cases(sweeps, run):
    """reconstruct.js only audits cases that exist in the trace, so record (and ask for) no more."""
    return min(sweeps["workload"]["audit_cases"], run["levels"]["cases"])


def audit(run, sweeps, trace_path, env):
    sh(["node", os.path.join(BENCH_DIR, "audit", "reconstruct.js"), "--variant", run["variant"],
        "--trace", trace_path, "--cases", str(audit_cases(sweeps, run)),
        "--gateway", env["GATEWAY_URL"], "--out", os.path.join(run["dir"], "audit.json")], cwd=BENCH_DIR, env=env)


def collect(run):
    sh([sys.executable, os.path.join(ORCH, "collect.py"), run["dir"]])
    m = load_json(os.path.join(run["dir"], "manifest.json")) or {}
    if m.get("status") != "complete" or not m.get("rounds"):
        raise RuntimeError(f"collect produced no complete manifest for {run['runId']}")
    return m


def runlog(run, started, status):
    os.makedirs(RESULTS_DIR, exist_ok=True)
    finished = now_iso()
    with open(RUNLOG, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"runId": run["runId"], "exp": run["exp"], "variant": run["variant"],
                             "levels": run["levels"], "rep": run["rep"], "startedAt": started,
                             "finishedAt": finished, "wallSeconds": round(time.time() - run["_t0"], 1),
                             "status": status}) + "\n")


# The progress prints in execute() and main() are parsed by benchcore.parse_line (the desktop
# app): change their format only together with test_benchapp.py.
def execute(sweeps, run, args, env, tag=""):
    print(f"\n===== {tag}{run['runId']} (regime {run['regime']}) =====", flush=True)
    run["_t0"] = time.time()
    doc = seed_run_json(run, sweeps, args.sweeps)
    try:
        if run["variant"] in R.ANCHORED_VARIANTS:
            set_batcher_env(run, sweeps)
        trace_path = None
        if run["trace"]:
            # Before the ledger reset: the trace is pure and cheap, so a bad control fails here,
            # not after the reset has already cost a network lifetime.
            trace_path, tdoc = ensure_trace(run["trace"])
            doc["trace"] = {"hash": tdoc.get("hash"), "params": tdoc.get("params"),
                            "opCounts": tdoc.get("opCounts"), "path": os.path.relpath(trace_path, REPO_ROOT)}
            recheck_floor(run, doc, tdoc, sweeps)
            dump_json(os.path.join(run["dir"], "run.json"), doc)
        ensure_network(run, not args.reuse_network)
        if run["variant"] in R.ANCHORED_VARIANTS:
            recreate_batcher(env["BATCHER_URL"])
        specs = build_rounds(sweeps, run, trace_path)
        anchored = run["variant"] in R.ANCHORED_VARIANTS
        checkpoint(run, "t0")
        for k, spec in enumerate(specs):
            print(f"\n--- {tag}round {k + 1}/{len(specs)}: {spec['label']} | send rate {spec['sendRateTps']} tx/s | "
                  f"{spec['txNumber']} tx | run elapsed {hms(time.time() - run['_t0'])}", flush=True)
            launch_round(sweeps, run, spec, k, env, not args.no_monitor, args.verbose)
            print(f"    done {spec['label']}: {round_result(run, spec)}", flush=True)
            if anchored:
                # Let in-flight roots land before measuring; on the LAST round
                # flush first, so the run-end partial batch (the stated policy)
                # is inside the t0->tN delta instead of after it.
                if k == len(specs) - 1:
                    flush_batcher(run, env["BATCHER_URL"])
                else:
                    settle_batcher(env["BATCHER_URL"])
            checkpoint(run, f"t{k + 1}")
        if run["audit"] and not args.no_audit:
            audit(run, sweeps, trace_path, env)
        doc["finishedAt"] = now_iso()
        doc["wallSeconds"] = round(time.time() - run["_t0"], 1)
        doc["status"] = "collecting"
        dump_json(os.path.join(run["dir"], "run.json"), doc)
        manifest = collect(run)
    except BaseException:
        runlog(run, doc["startedAt"], "failed")
        raise
    runlog(run, doc["startedAt"], "complete")
    return manifest


# ------------------------------------------------------------------ reporting helpers

def ramp_summary(manifest):
    """Throughput vs send rate for one ramp run + suggested sub-saturation baseline (confirm with D).
    The rule lives in report.ramp_suggestion, shared with the desktop app."""
    rows = REP.ramp_rows(manifest)
    print(f"\n--- ramp {manifest['variant']}: send rate (tx/s) | throughput (TPS) | ratio | p95 (ms)")
    for rate, tps, ratio, p95 in rows:
        print(f"  {rate:>6} | {tps:>8.1f} | {ratio:5.2f} | {p95 if p95 is None else round(p95, 1)}")
    sat, suggested = REP.ramp_suggestion(rows)
    print(f"  saturation (throughput < {REP.SATURATION_RATIO}x send rate): {sat or 'not reached'}; "
          f"suggested baseline.send_rate_tps = {suggested} (confirm with D)")


def eta_seconds(exp, remaining):
    walls = [r["wallSeconds"] for r in (load_json_lines(RUNLOG) or [])
             if r.get("status") == "complete" and isinstance(r.get("wallSeconds"), (int, float))]
    same = [r["wallSeconds"] for r in (load_json_lines(RUNLOG) or [])
            if r.get("status") == "complete" and r.get("exp") == exp]
    pool = same or walls
    return statistics.median(pool) * remaining if pool else None


def load_json_lines(path):
    if not os.path.exists(path):
        return []
    out = []
    for ln in open(path, encoding="utf-8"):
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


def is_complete(run):
    m = load_json(os.path.join(run["dir"], "manifest.json"))
    return bool(m and m.get("status") == "complete" and m.get("rounds"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exp", required=True, choices=EXPS)
    ap.add_argument("--variant", action="append", choices=R.VARIANTS, help="restrict to variant(s); repeatable")
    ap.add_argument("--reps", type=int, help="override sweeps.repetitions (e0/ramp always 1)")
    ap.add_argument("--resume", action="store_true", help="skip runs whose manifest.json says status: complete")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and exit (no docker, no writes)")
    ap.add_argument("--reuse-network", action="store_true",
                    help="do NOT reset the ledger before the run (default: reset-network.sh before every run, "
                         "which needs GLEIPNIR_ALLOW_LEDGER_WIPE=1). Valid for a single ad-hoc run only — the "
                         "replayed trace collides with the evidence ids already on the ledger")
    ap.add_argument("--no-monitor", action="store_true", help="omit the Caliper docker resource monitor")
    ap.add_argument("--no-audit", action="store_true", help="skip audit reconstruction")
    ap.add_argument("--sweeps", default=R.SWEEPS_PATH, help="experiment constants file (default benchmark/sweeps.yaml)")
    ap.add_argument("--verbose", action="store_true",
                    help="echo Caliper's full output (default: only its transaction-progress lines, warnings and "
                         "errors; the full log is always in rounds/<label>/caliper.log)")
    cell = ap.add_argument_group(
        "--exp cell factors (the independent variables)", "an omitted factor takes its sweeps.yaml baseline value")
    cell.add_argument("--send-rate", type=int, nargs="+", action="extend", metavar="TX_S",
                      help="configured send rate(s) in tx/s (Caliper fixed-rate); several -> one round per rate, "
                           "ascending (default baseline.send_rate_tps)")
    cell.add_argument("--batch-size", type=int, metavar="EVENTS",
                      help="events per Merkle batch — anchoring, parallel-anchored (default baseline.batch_size)")
    cell.add_argument("--cases", type=int, metavar="N",
                      help="cases in the replayed trace, identical for every variant; parallel and "
                           "parallel-anchored run ONE CHANNEL PER CASE, standard and anchoring put them all on "
                           "their one shared channel (default baseline.channels)")
    ctl = ap.add_argument_group(
        "--exp cell controls (the controlled workload)", "default: the sweeps.yaml value; a cell that overrides "
        "any of these records them in run.json `overrides` and gets its own results dir (-x<hash>)")
    for flag, path, typ, _, _, hlp in CONTROL_FLAGS:
        ctl.add_argument(flag, type=typ, metavar=typ.__name__.upper(), help=f"{hlp} (sweeps.yaml {path})")
    args = ap.parse_args()
    args.sweeps = os.path.abspath(args.sweeps)   # git hash-object runs from REPO_ROOT, not from the caller's cwd

    sweeps, overrides = apply_controls(args, R.load_sweeps(args.sweeps))
    reps = 1 if args.exp in ("e0", "ramp") else (args.reps or sweeps["repetitions"])
    variants = list(dict.fromkeys(args.variant or R.VARIANTS))   # a repeated --variant must not plan a run twice
    cell = cell_levels(args, sweeps, variants)
    if cell is not None:
        cell["overrides"] = overrides
    runs = plan(sweeps, args.exp, variants, reps, cell)
    preview_floor(sweeps, runs, cell is not None)
    todo = [r for r in runs if not (args.resume and is_complete(r))]

    print(f"\nplan {args.exp}: {len(runs)} run(s), {len(todo)} to execute"
          + (f" ({len(runs) - len(todo)} already complete, --resume)" if args.resume else ""))
    if overrides:
        print(f"  control overrides (vs {os.path.relpath(args.sweeps, REPO_ROOT)}): {json.dumps(overrides)}")
    for r in todo:
        n_rounds = len(r["rates"]) if r["kind"] == "trace" else (
            len(R.ops_rounds(sweeps, r["variant"], r["levels"]["cases"], r["rates"][0])) if r["kind"] == "ops"
            else len(R.smoke_rounds(sweeps, r["variant"])) + 1)
        print(f"  {r['runId']:<48} regime={r['regime']:<9} rounds={n_rounds:<2} rates={r['rates']}"
              f" trace={'-' if not r['trace'] else r['trace']['events_per_case_per_round']}evx{r['trace']['rounds'] if r['trace'] else '-'}")
    eta = eta_seconds(args.exp, len(todo))
    print(f"ETA: {'unknown (no complete runs in runlog.jsonl yet)' if eta is None else f'{eta / 3600:.1f} h'}")
    if args.dry_run:
        return
    if args.reuse_network and len(todo) > 1:
        sys.exit(f"--reuse-network is valid for ONE run, but this plan has {len(todo)}. Every run replays the "
                 "same deterministic evidence ids, so runs 2..n would collide on the ledger run 1 left behind "
                 "(duplicate CreateEvidence, duplicated off-chain trail, dirty storage baseline).\n"
                 "  Drop --reuse-network (with GLEIPNIR_ALLOW_LEDGER_WIPE=1) for the campaign, or narrow the "
                 "plan with --variant/--reps until it is a single run.")

    env_file = read_env()
    env = {**os.environ,
           "GATEWAY_URL": os.environ.get("GATEWAY_URL", "http://localhost:3000"),
           "BATCHER_URL": os.environ.get("BATCHER_URL", "http://localhost:4001"),
           "GLEIPNIR_TOKEN": os.environ.get("GLEIPNIR_TOKEN") or env_file.get("GLEIPNIR_TOKEN", "dev-token")}
    t_start, walls, csv_path = time.time(), [], None
    for i, run in enumerate(todo, 1):
        remaining = len(todo) - i + 1
        # ETA from this session's own runs once there are some, else from runlog.jsonl history.
        eta = statistics.median(walls) * remaining if walls else eta_seconds(args.exp, remaining)
        print(f"\n##### [run {i}/{len(todo)} | {100 * (i - 1) // len(todo)} % done | elapsed "
              f"{hms(time.time() - t_start)} | ETA {hms(eta)}] #####", flush=True)
        manifest = execute(sweeps, run, args, env, tag=f"[run {i}/{len(todo)}] ")
        walls.append(time.time() - run["_t0"])
        if args.exp == "ramp":
            ramp_summary(manifest)
        try:
            csv_path = REP.export_rounds(args.exp, RESULTS_DIR)
            print(f"  results CSV updated ({i}/{len(todo)} runs): {csv_path}", flush=True)
        except OSError as e:   # e.g. the CSV is open in Excel (write-locked): never stop a campaign for it
            print(f"  ! results CSV not updated ({e}); close it in Excel — the next run rewrites it, or run "
                  f"python3 orchestration/report.py --exp {args.exp}", flush=True)
    print(f"\n{args.exp} complete: {len(todo)} run(s) executed in {hms(time.time() - t_start)}.")
    if csv_path:
        print(f"  per-round results (Excel): {csv_path}\n"
              f"  re-export with decimal commas: python3 orchestration/report.py --exp {args.exp} --decimal-comma"
              + (f"\n  aggregated tables + charts:   python3 orchestration/report.py --exp {args.exp}"
                 if args.exp in REP.EXPS else ""))


if __name__ == "__main__":
    main()
