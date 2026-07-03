#!/usr/bin/env python3
"""GLEIPNIR metrics collector (docs/CONTRACTS.md §10, §11; ARCHITECTURE §4.7).

`collect.py <runId>` parses the Caliper round summary (from benchmark/results/<runId>/
caliper.log, which sweep.py tees), recomputes SUCCESSFUL-ONLY throughput, tabulates
MVCC_READ_CONFLICT as its own failure class, and merges everything into
benchmark/results/<runId>/manifest.json with the config commit SHA + per-file blob SHAs.

Successful-only throughput note (Caliper issue #1418): Caliper's reported Throughput
numerator is (Succ+Fail). Since reported = (Succ+Fail)/window, the successful-only rate
is  reported * Succ/(Succ+Fail)  — derivable from the summary alone.
"""
import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_FILES = [
    "network/configtx/configtx.yaml",
    "network/core.yaml",
    "network/orderer.yaml",
    "network/compose/compose-net.yaml",
    "network/compose/compose-ca.yaml",
    "network/compose/compose-services.yaml",
]


def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def config_shas():
    shas = {}
    for rel in CONFIG_FILES:
        sha = git("hash-object", rel)
        if sha:
            shas[rel] = sha
    return shas


def parse_caliper_log(log_path):
    """Parse the cli-table3 round summary rows from a Caliper log.

    Columns (0.6.0): Name | Succ | Fail | Send Rate (TPS) | Max Latency (s) |
    Min Latency (s) | Avg Latency (s) | Throughput (TPS).
    Returns a list of per-round dicts with successful-only throughput added.
    """
    rounds = []
    if not os.path.exists(log_path):
        return rounds
    with open(log_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line.lstrip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) != 8:
                continue
            name = cells[0]
            if name.lower() == "name" or set(name) <= set("-+ "):
                continue  # header / separator
            try:
                succ = int(cells[1])
                fail = int(cells[2])
                send_rate = float(cells[3])
                max_lat = _num(cells[4])
                min_lat = _num(cells[5])
                avg_lat = _num(cells[6])
                throughput = float(cells[7])
            except ValueError:
                continue
            total = succ + fail
            succ_only_tps = throughput * succ / total if total else 0.0
            rounds.append({
                "label": name,
                "succ": succ,
                "fail": fail,
                "sendRateTps": send_rate,
                "latency": {"maxS": max_lat, "minS": min_lat, "avgS": avg_lat},
                "throughputReportedTps": throughput,
                "throughputSuccessfulOnlyTps": round(succ_only_tps, 3),
            })
    return rounds


def _num(s):
    try:
        return float(s)
    except ValueError:
        return None


def count_mvcc(log_path):
    if not os.path.exists(log_path):
        return 0
    with open(log_path, encoding="utf-8", errors="replace") as fh:
        return len(re.findall(r"MVCC_READ_CONFLICT", fh.read()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_id")
    args = ap.parse_args()

    run_dir = os.path.join(REPO_ROOT, "benchmark", "results", args.run_id)
    os.makedirs(run_dir, exist_ok=True)
    log_path = os.path.join(run_dir, "caliper.log")
    manifest_path = os.path.join(run_dir, "manifest.json")

    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)

    rounds = parse_caliper_log(log_path)
    manifest.setdefault("runId", args.run_id)
    manifest["collectedAt"] = datetime.now(timezone.utc).isoformat()
    manifest["gitCommit"] = git("rev-parse", "HEAD")
    manifest["configShas"] = config_shas()
    manifest["rounds"] = rounds
    manifest["failureClasses"] = {"MVCC_READ_CONFLICT": count_mvcc(log_path)}
    manifest["throughputPolicy"] = "successful-only (Succ/window); Caliper reported=(Succ+Fail)/window, issue #1418"

    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"collected {len(rounds)} rounds -> {manifest_path}")


if __name__ == "__main__":
    main()
