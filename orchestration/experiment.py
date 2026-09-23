#!/usr/bin/env python3
"""GLEIPNIR experiment driver (docs/CONTRACTS.md §10, §11; supervisor brief 2026-09-22 §9).

  experiment.py --exp e0|ramp|e1|e2|e3a|e3b|ops [--variant V]* [--reps N]
                [--resume] [--dry-run] [--reuse-network] [--no-monitor] [--no-audit]

Plans (cells x repetitions; every run = ONE network lifetime):
  e0    every variant, smoke shape at regimes.smoke.send_rate_tps, 1 rep — per-op
        smoke rounds + one replayed smoke trace slice (+ verify, anchored) + audit.
        Labelled `smoke`, never steady.
  ramp  every variant, 1 rep, one round per send rate at ramp.events_per_case_per_round;
        prints throughput vs send rate + a suggested baseline.send_rate_tps.
  e1    anchoring (1 ch) + parallel-anchored (baseline.channels) x batch_sizes x reps at
        baseline.send_rate_tps, workload.rounds slices; PLUS reference runs standard (1 ch)
        and parallel (baseline.channels) x reps at the same point (levels.reference).
  e2    parallel x channel_counts x reps at baseline.send_rate_tps; cases = channels
        unless workload.cases is set.
  e3a   4 variants x reps; batch = baseline.batch_size; parallel* channels =
        baseline.channels; ONE round per send rate, ascending (slices 0..n-1).
  e3b   4 variants x case_counts (<= baseline.channels_max) x reps at baseline.send_rate_tps;
        parallel* channels = cases; standard/anchoring channels = 1.
  ops   4 variants x reps at the E3 point; rounds create/transfer/access/dispose
        (writes), read-evidence/read-trail (reads), verify-event (anchored only).

Per run: (1) stale artifacts cleared + run.json seeded (identity + provenance) ->
(2) network: reset-network.sh by DEFAULT (needs GLEIPNIR_ALLOW_LEDGER_WIPE=1; it
removes only the ledger/receipt/verify-metrics volumes, never the library data).
--reuse-network keeps the running ledger for ONE ad-hoc run and then the stack must
match (.env VARIANT, exactly the case channels the cell uses) -> (3) anchored:
BATCH_SIZE/BATCH_FLUSH_MS/fresh BATCH_EPOCH, batcher recreated -> (4) trace
generated/looked up -> (5) checkpoint t0 -> (6) per round: render bench.yaml,
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
import glob
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rounds as R  # noqa: E402

REPO_ROOT = R.REPO_ROOT
BENCH_DIR = R.BENCH_DIR
ORCH = os.path.dirname(os.path.abspath(__file__))
COMPOSE_DIR = os.path.join(REPO_ROOT, "network", "compose")
ENV_PATH = os.path.join(COMPOSE_DIR, ".env")
RESULTS_DIR = os.path.join(BENCH_DIR, "results")
TRACES_DIR = os.path.join(BENCH_DIR, "traces")
RUNLOG = os.path.join(RESULTS_DIR, "runlog.jsonl")
EXPS = ["e0", "ramp", "e1", "e2", "e3a", "e3b", "ops"]
CALIPER = {"version": "0.6.0", "binding": "fabric:fabric-gateway"}   # benchmark/README.md
CONFIG_FILES = [
    "network/configtx/configtx.yaml", "network/core.yaml", "network/orderer.yaml",
    "network/compose/compose-net.yaml", "network/compose/compose-ca.yaml", "network/compose/compose-services.yaml",
]
PEER_CHAINS = "/var/hyperledger/production/ledgersData/chains/chains"
SATURATION_RATIO = 0.9   # brief §1 Q4: saturated = successful throughput < 0.9 x send rate


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

def levels_dir(levels):
    parts = []
    if levels.get("batchSize") is not None:
        parts.append(f"batch{levels['batchSize']}")
    parts += [f"ch{levels['channels']}", f"cases{levels['cases']}"]
    if levels.get("reference"):
        parts.append("ref")
    return "-".join(parts)


def fit_events(cases, wanted, workers):
    """Largest v <= wanted with casesxv divisible by workers (per-worker slice must be an integer)."""
    for v in range(wanted, 0, -1):
        if (cases * v) % workers == 0:
            return v
    sys.exit(f"FATAL: no events_per_case_per_round <= {wanted} makes casesxevents divisible by workers={workers}")


def make_run(sweeps, exp, variant, rep, kind, cases, channels, batch, rates, events, rounds_n, reference=False):
    w = sweeps["workload"]
    ch = R.channels_for(variant, channels)
    batch = batch if variant in R.ANCHORED_VARIANTS else None
    levels = {"batchSize": batch, "channels": ch, "cases": cases,
              "sendRateTps": rates[0] if len(set(rates)) == 1 else None, "reference": bool(reference)}
    trace = None
    if kind in ("trace", "smoke"):
        evidence = sweeps["regimes"]["smoke"]["evidence_per_case"] if kind == "smoke" else w["evidence_per_case"]
        trace = {"seed": sweeps["seed"], "cases": cases, "channels": ch, "evidence_per_case": evidence,
                 "events_per_case_per_round": events, "rounds": rounds_n, "workers": sweeps["workers"],
                 "mix": dict(w["mix"]), "payload_bytes": w["payload_bytes"]}
        write_events = rounds_n * events * cases
    else:  # ops: create + transfer + access + dispose over the pool
        write_events = 4 * w["evidence_per_case"] * cases
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
        regime = "steady" if write_events / ch >= sweeps["regimes"]["steady"]["min_events_per_channel"] else "sub-floor"
    run_id = f"{exp}/{variant}/{levels_dir(levels)}/r{rep}"
    return {"runId": run_id, "exp": exp, "variant": variant, "rep": rep, "kind": kind, "levels": levels,
            "regime": regime, "rates": list(rates), "trace": trace, "writeEventsPerChannel": write_events / ch,
            "audit": trace is not None, "dir": os.path.join(RESULTS_DIR, *run_id.split("/"))}


def plan(sweeps, exp, variants, reps):
    b, w, s = sweeps["baseline"], sweeps["workload"], sweeps["regimes"]["smoke"]
    rate, batch = b["send_rate_tps"], b["batch_size"]
    n_rounds, events = w["rounds"], w["events_per_case_per_round"]

    def cases_for(channels):
        return w["cases"] or channels

    runs = []
    if exp == "e0":
        ev = fit_events(s["cases"], s["logs_per_case_max"], sweeps["workers"])
        for v in variants:
            runs.append(make_run(sweeps, exp, v, 0, "smoke", s["cases"], 1, batch, [s["send_rate_tps"]], ev, 1))
    elif exp == "ramp":
        rates = sorted(sweeps["send_rates_tps"])   # ascending: a ramp must climb into saturation, not jump
        for v in variants:
            runs.append(make_run(sweeps, exp, v, 0, "trace", cases_for(b["channels"]), b["channels"], batch, rates,
                                 sweeps["ramp"]["events_per_case_per_round"], len(rates)))
    elif exp == "e1":
        for v in [x for x in variants if x in R.ANCHORED_VARIANTS]:
            for bs in sweeps["batch_sizes"]:
                for r in range(reps):
                    runs.append(make_run(sweeps, exp, v, r, "trace", cases_for(b["channels"]), b["channels"], bs,
                                         [rate] * n_rounds, events, n_rounds))
        for v in [x for x in variants if x in ("standard", "parallel")]:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, v, r, "trace", cases_for(b["channels"]), b["channels"], None,
                                     [rate] * n_rounds, events, n_rounds, reference=True))
    elif exp == "e2":
        for ch in sweeps["channel_counts"]:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, "parallel", r, "trace", cases_for(ch), ch, None,
                                     [rate] * n_rounds, events, n_rounds))
    elif exp == "e3a":
        rates = sorted(sweeps["send_rates_tps"])   # brief §9: one round per send rate, ASCENDING
        for v in variants:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, v, r, "trace", cases_for(b["channels"]), b["channels"], batch,
                                     rates, events, len(rates)))
    elif exp == "e3b":
        for cases in [c for c in sweeps["case_counts"] if c <= b["channels_max"]]:
            for v in variants:
                for r in range(reps):
                    runs.append(make_run(sweeps, exp, v, r, "trace", cases, cases, batch,
                                         [rate] * n_rounds, events, n_rounds))
    elif exp == "ops":
        for v in variants:
            for r in range(reps):
                runs.append(make_run(sweeps, exp, v, r, "ops", cases_for(b["channels"]), b["channels"], batch,
                                     [rate], None, None))
    for run in runs:
        if run["regime"] == "sub-floor":
            print(f"  ! {run['runId']}: {run['writeEventsPerChannel']:.0f} write events/channel < "
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

def provenance(run):
    env = read_env()
    return {"gitCommit": git("rev-parse", "HEAD"),
            "configShas": {rel: git("hash-object", rel) for rel in CONFIG_FILES},
            "sweepsSha": git("hash-object", "benchmark/sweeps.yaml"),
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


def seed_run_json(run):
    os.makedirs(run["dir"], exist_ok=True)
    clean_run_dir(run)
    doc = {"runId": run["runId"], "experiment": run["exp"], "variant": run["variant"], "levels": run["levels"],
           "repetition": run["rep"], "regime": run["regime"], "status": "running", "trace": None,
           "provenance": provenance(run), "startedAt": now_iso(), "finishedAt": None, "wallSeconds": None}
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
    bs = run["levels"]["batchSize"]
    for key in ("BATCH_SIZE", "BATCH_N", "BATCH_K"):   # BATCH_N/K = legacy fallback names
        set_env_var(key, bs)
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


_trace_cache = {}


def ensure_trace(t):
    """Generate (deterministic, cheap) -> benchmark/traces/<hash>.json; returns (path, doc)."""
    key = json.dumps(t, sort_keys=True)
    if key in _trace_cache:
        return _trace_cache[key]
    os.makedirs(TRACES_DIR, exist_ok=True)
    pending = os.path.join(TRACES_DIR, f"pending-{os.getpid()}.json")
    out = sh(trace_argv(t, pending), cwd=BENCH_DIR, capture=True).stdout
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
    _trace_cache[key] = (final, doc)
    return final, doc


def checkpoint(run, label):
    sh([sys.executable, os.path.join(ORCH, "checkpoint.py"), run["runId"], "--label", label])


def launch_round(sweeps, run, spec, index, env, monitor):
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
           "--caliper-networkconfig", R.network_config(run["variant"], run["levels"]["channels"]),
           "--caliper-report-path", os.path.join(rdir, "report.html")]
    log_path = os.path.join(rdir, "caliper.log")
    print(f"+ (in benchmark/) {' '.join(cmd)}  | tee {log_path}", flush=True)
    round_env = {**env, "GLEIPNIR_TXLOG_DIR": rdir}
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen(cmd, cwd=BENCH_DIR, env=round_env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, errors="replace")
        for line in proc.stdout:
            sys.stdout.write(line)
            log.write(line)
        proc.wait()
    text = open(log_path, encoding="utf-8", errors="replace").read()
    if proc.returncode != 0 or "### All test results ###" not in text:
        raise RuntimeError(f"caliper round {spec['label']} failed (exit {proc.returncode}); see {log_path}")


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


def audit(run, sweeps, trace_path, env):
    sh(["node", os.path.join(BENCH_DIR, "audit", "reconstruct.js"), "--variant", run["variant"],
        "--trace", trace_path, "--cases", str(sweeps["workload"]["audit_cases"]),
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


def execute(sweeps, run, args, env):
    print(f"\n===== {run['runId']} (regime {run['regime']}) =====", flush=True)
    run["_t0"] = time.time()
    doc = seed_run_json(run)
    try:
        if run["variant"] in R.ANCHORED_VARIANTS:
            set_batcher_env(run, sweeps)
        ensure_network(run, not args.reuse_network)
        if run["variant"] in R.ANCHORED_VARIANTS:
            recreate_batcher(env["BATCHER_URL"])
        trace_path = None
        if run["trace"]:
            trace_path, tdoc = ensure_trace(run["trace"])
            doc["trace"] = {"hash": tdoc.get("hash"), "params": tdoc.get("params"),
                            "opCounts": tdoc.get("opCounts"), "path": os.path.relpath(trace_path, REPO_ROOT)}
            dump_json(os.path.join(run["dir"], "run.json"), doc)
        specs = build_rounds(sweeps, run, trace_path)
        anchored = run["variant"] in R.ANCHORED_VARIANTS
        checkpoint(run, "t0")
        for k, spec in enumerate(specs):
            launch_round(sweeps, run, spec, k, env, not args.no_monitor)
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
    """Throughput vs send rate for one ramp run + suggested sub-saturation baseline (confirm with D)."""
    rows = []
    for r in manifest.get("rounds", []):
        rate = r.get("sendRateTps") or 0
        tps = r.get("throughputSuccessfulOnlyTps") or 0.0
        p95 = ((r.get("txlog") or {}).get("latencyMs") or {}).get("p95")
        rows.append((rate, tps, tps / rate if rate else 0.0, p95))
    print(f"\n--- ramp {manifest['variant']}: send rate (tx/s) | throughput (TPS) | ratio | p95 (ms)")
    for rate, tps, ratio, p95 in rows:
        print(f"  {rate:>6} | {tps:>8.1f} | {ratio:5.2f} | {p95 if p95 is None else round(p95, 1)}")
    sat = next((rate for rate, _, ratio, _ in rows if ratio < SATURATION_RATIO), None)
    ok = [rate for rate, _, ratio, _ in rows if ratio >= SATURATION_RATIO and (sat is None or rate < sat)]
    margin = [rate for rate in ok if sat is None or rate <= sat / 2]
    suggested = max(margin) if margin else (max(ok) if ok else None)
    print(f"  saturation (throughput < {SATURATION_RATIO}x send rate): {sat or 'not reached'}; "
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
    ap.add_argument("--fresh-network", action="store_true",
                    help="(default since M26; kept so existing command lines keep working)")
    ap.add_argument("--no-monitor", action="store_true", help="omit the Caliper docker resource monitor")
    ap.add_argument("--no-audit", action="store_true", help="skip audit reconstruction")
    ap.add_argument("--sweeps", default=R.SWEEPS_PATH)
    args = ap.parse_args()

    sweeps = R.load_sweeps(args.sweeps)
    reps = 1 if args.exp in ("e0", "ramp") else (args.reps or sweeps["repetitions"])
    variants = args.variant or R.VARIANTS
    runs = plan(sweeps, args.exp, variants, reps)
    todo = [r for r in runs if not (args.resume and is_complete(r))]

    print(f"\nplan {args.exp}: {len(runs)} run(s), {len(todo)} to execute"
          + (f" ({len(runs) - len(todo)} already complete, --resume)" if args.resume else ""))
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
    for run in todo:
        manifest = execute(sweeps, run, args, env)
        if args.exp == "ramp":
            ramp_summary(manifest)
    print(f"\n{args.exp} complete: {len(todo)} run(s) executed.")


if __name__ == "__main__":
    main()
