#!/usr/bin/env python3
"""GLEIPNIR sweep driver (docs/CONTRACTS.md §10, §11; ARCHITECTURE §4.6, §8).

`sweep.py --variant <v> --regime <steady|smoke>` iterates the applicable sweep cells
from benchmark/sweeps.yaml (N for anchoring, K+channels for parallel-anchored, channels
for parallel), repeats each per the N-runs loop, and for each cell: ensures channels,
sets the batcher batch size, checkpoints storage before/after, runs Caliper, and collects.

Smoke runIds are prefixed 'smoke-'; steady 'run-'. Smoke and steady artifacts are NEVER
mixed in one results dir. Caliper stdout is tee'd to results/<runId>/caliper.log so
collect.py can recompute successful-only throughput.

This orchestrates external tools (docker compose, npx caliper, provision-channel.sh,
checkpoint.py, collect.py); it never generates load itself.
"""
import argparse
import itertools
import os
import subprocess
import sys

import yaml

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH_DIR = os.path.join(REPO_ROOT, "benchmark")
ORCH = os.path.join(REPO_ROOT, "orchestration")
COMPOSE_DIR = os.path.join(REPO_ROOT, "network", "compose")

# Per-variant Caliper benchconfig + networkconfig (relative to the benchmark workspace).
BENCH_CONFIG = {
    "standard": ("benchmarks/steady-standard.yaml", "networks/coc-main.yaml"),
    "anchoring": ("benchmarks/steady-anchoring.yaml", "networks/rest-gateway.yaml"),
    "parallel": ("benchmarks/steady-parallel.yaml", None),           # network per case
    "parallel-anchored": ("benchmarks/steady-parallel-anchored.yaml", "networks/rest-gateway.yaml"),
}


def load_sweeps():
    with open(os.path.join(BENCH_DIR, "sweeps.yaml"), encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def run(cmd, **kw):
    print("+ " + (cmd if isinstance(cmd, str) else " ".join(cmd)))
    return subprocess.run(cmd, shell=isinstance(cmd, str), cwd=kw.pop("cwd", REPO_ROOT), check=False, **kw)


def set_env_var(key, value):
    """Best-effort update of network/compose/.env (mirrors lib.sh set_env_var)."""
    env_path = os.path.join(COMPOSE_DIR, ".env")
    lines, found = [], False
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    for i, ln in enumerate(lines):
        if ln.startswith(key + "="):
            lines[i] = f"{key}={value}"
            found = True
    if not found:
        lines.append(f"{key}={value}")
    with open(env_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def recreate_batcher():
    run(["docker", "compose", "-p", "gleipnir", "--project-directory", COMPOSE_DIR,
         "-f", os.path.join(COMPOSE_DIR, "compose-net.yaml"),
         "-f", os.path.join(COMPOSE_DIR, "compose-ca.yaml"),
         "-f", os.path.join(COMPOSE_DIR, "compose-services.yaml"),
         "up", "-d", "--force-recreate", "merkle-batcher"])


def ensure_channels(n):
    for i in range(1, n + 1):
        run([os.path.join(ORCH, "provision-channel.sh"), f"case-{i:03d}"])


def caliper(run_id, benchconfig, networkconfig):
    out_dir = os.path.join(BENCH_DIR, "results", run_id)
    os.makedirs(out_dir, exist_ok=True)
    log_path = os.path.join(out_dir, "caliper.log")
    report_path = os.path.join(out_dir, "report.html")
    cmd = ["npx", "caliper", "launch", "manager",
           "--caliper-workspace", ".",
           "--caliper-benchconfig", benchconfig,
           "--caliper-networkconfig", networkconfig,
           "--caliper-report-path", report_path]
    print("+ (in benchmark/) " + " ".join(cmd) + f"  | tee {log_path}")
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen(cmd, cwd=BENCH_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            sys.stdout.write(line)
            log.write(line)
        proc.wait()
    return report_path


def cells_for(variant, sweeps):
    """Yield cell dicts (N/K/channels) for the variant, excluding the repetition loop."""
    if variant == "standard":
        yield {}
    elif variant == "anchoring":
        for n in sweeps["anchoring_batch_N"]:
            yield {"N": n}
    elif variant == "parallel":
        for ch in sweeps["channel_counts"]:
            yield {"channels": ch}
    elif variant == "parallel-anchored":
        for k, ch in itertools.product(sweeps["parallel_anchored_batch_K"], sweeps["channel_counts"]):
            yield {"K": k, "channels": ch}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", required=True, choices=list(BENCH_CONFIG))
    ap.add_argument("--regime", default="steady", choices=["steady", "smoke"])
    args = ap.parse_args()

    sweeps = load_sweeps()
    reps = sweeps["repetitions"] if args.regime == "steady" else 1
    prefix = "run" if args.regime == "steady" else "smoke"
    benchconfig, networkconfig = BENCH_CONFIG[args.variant]

    for cell in cells_for(args.variant, sweeps):
        if "N" in cell:
            set_env_var("BATCH_N", cell["N"]); recreate_batcher()
        if "K" in cell:
            set_env_var("BATCH_K", cell["K"]); recreate_batcher()
        if "channels" in cell:
            ensure_channels(cell["channels"])

        for rep in range(reps):
            tag = "-".join([f"{k}{v}" for k, v in cell.items()]) or "base"
            run_id = f"{prefix}-{args.variant}-{tag}-r{rep}"
            print(f"\n===== cell {run_id} =====")

            netcfg = networkconfig
            if args.variant == "parallel":
                netcfg = f"networks/case-{cell.get('channels', 1):03d}.yaml"  # first case as representative

            run([sys.executable, os.path.join(ORCH, "checkpoint.py"), run_id, "--label", "t0"])
            caliper(run_id, benchconfig, netcfg)
            run([sys.executable, os.path.join(ORCH, "checkpoint.py"), run_id, "--label", "t1"])
            run([sys.executable, os.path.join(ORCH, "collect.py"), run_id])

    print("\nsweep complete.")


if __name__ == "__main__":
    main()
