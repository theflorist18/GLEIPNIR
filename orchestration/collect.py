#!/usr/bin/env python3
"""GLEIPNIR metrics collector (docs/CONTRACTS.md §10, §11; ARCHITECTURE §4.7).

`collect.py <runId> [--baseline <runId>]` parses the Caliper round summary (from
benchmark/results/<runId>/caliper.log, which sweep.py tees), recomputes
SUCCESSFUL-ONLY throughput, tabulates MVCC_READ_CONFLICT as its own failure class,
reduces checkpoints.jsonl into storage deltas + bytes-per-event, and merges
everything into benchmark/results/<runId>/manifest.json (which sweep.py seeds with
the experiment-identity fields — runId/variant/regime/cell/caliper).

Round table (audit F48): Caliper prints every round twice — once per-round and
once in the final `### All test results ###` table. Only the rows AFTER the LAST
such marker are parsed, so each round appears exactly once.

Multi-channel cells (audit F6): the spread rounds drive all case channels in one
round, so Caliper's throughput is the AGGREGATE across channels. Per-channel rate
is derived as aggregate/channels (uniform round-robin by construction) and marked
as derived.

Storage (audit F9/F12/F70): per-channel blockstore deltas are taken from the peer
that hosts the channel (org1 for app channels, the anchor peer for anchor-main —
both org peers replicate app channels, so counting one avoids double-counting);
world state is counted once per container; the receipt store is measured
separately. bytes-per-event = app-channel blockstore delta / successful write
events. With --baseline (a Standard run), the log-payload compression is reported
as the reduction in on-chain bytes-per-event vs that baseline — NEVER as 1/N of
total ledger size (CLAUDE.md metrics contract).

Successful-only throughput note (Caliper issue #1418): Caliper's reported Throughput
numerator is (Succ+Fail). Since reported = (Succ+Fail)/window, the successful-only
rate is  reported * Succ/(Succ+Fail)  — derivable from the summary alone.
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
RESULTS_MARKER = "### All test results ###"
# The peer whose copy of a channel's blockstore is counted (replicas are equal).
CHANNEL_HOST = {"anchor-main": "peer0.anchor.example.com"}
DEFAULT_HOST = "peer0.org1.example.com"


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
    """Parse the cli-table round summary rows from a Caliper log.

    Columns (0.6.0): Name | Succ | Fail | Send Rate (TPS) | Max Latency (s) |
    Min Latency (s) | Avg Latency (s) | Throughput (TPS).
    Only rows after the LAST `### All test results ###` marker are read (F48);
    if the marker is absent (aborted run) the whole log is scanned and exact
    duplicate rows are collapsed.
    """
    rounds = []
    if not os.path.exists(log_path):
        return rounds
    with open(log_path, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()

    marker_at = None
    for i, ln in enumerate(lines):
        if RESULTS_MARKER in ln:
            marker_at = i
    scan = lines[marker_at + 1:] if marker_at is not None else lines
    dedupe = marker_at is None

    seen = set()
    for line in scan:
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
        if dedupe:
            key = tuple(cells)
            if key in seen:
                continue
            seen.add(key)
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


def load_checkpoints(run_dir):
    path = os.path.join(run_dir, "checkpoints.jsonl")
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.strip()
            if ln:
                rows.append(json.loads(ln))
    return rows


def reduce_checkpoint(rows, label):
    """One label's rows -> {ledgerBytes: {channel: bytes}, stateBytes, receiptBytes, tsUtc}."""
    ledger, state_total, receipts, ts = {}, 0, None, None
    for r in rows:
        if r.get("label") != label:
            continue
        ts = r.get("tsUtc", ts)
        ch = r.get("channel")
        if ch is not None and r.get("blockstoreBytes") is not None:
            if r.get("container") == CHANNEL_HOST.get(ch, DEFAULT_HOST):
                ledger[ch] = r["blockstoreBytes"]
        if ch is None and r.get("stateBytes") is not None:
            state_total += r["stateBytes"]
        if r.get("receiptBytes") is not None:
            receipts = r["receiptBytes"]
    return {"label": label, "tsUtc": ts, "ledgerBytes": ledger,
            "stateBytes": state_total, "receiptBytes": receipts}


def storage_metrics(run_dir, rounds):
    """checkpoints.jsonl (t0/t1) -> canonical checkpoints + deltas + bytes/event (F12/F70)."""
    rows = load_checkpoints(run_dir)
    if not rows:
        return None, None
    labels = []
    for r in rows:
        if r["label"] not in labels:
            labels.append(r["label"])
    events = sum(r["succ"] for r in rounds)
    checkpoints = []
    for lb in labels:
        cp = reduce_checkpoint(rows, lb)
        cp["events"] = 0 if lb == labels[0] else events
        checkpoints.append(cp)
    if len(checkpoints) < 2:
        return checkpoints, None
    t0, t1 = checkpoints[0], checkpoints[-1]
    per_channel = {
        ch: t1["ledgerBytes"][ch] - t0["ledgerBytes"].get(ch, 0)
        for ch in t1["ledgerBytes"]
    }
    app_delta = sum(v for ch, v in per_channel.items() if ch != "anchor-main")
    storage = {
        "blockstoreDeltaPerChannel": per_channel,
        "blockstoreDeltaAppChannels": app_delta,
        "stateDeltaBytes": t1["stateBytes"] - t0["stateBytes"],
        "receiptStoreDeltaBytes": (
            t1["receiptBytes"] - t0["receiptBytes"]
            if t1.get("receiptBytes") is not None and t0.get("receiptBytes") is not None else None
        ),
        "successfulEvents": events,
        "bytesPerEventBlockstore": round(app_delta / events, 3) if events else None,
        "policy": ("per-channel blockstore from its hosting peer (org1 app channels, anchor peer "
                   "anchor-main); world state once per container; receipt store separate (F9/F70)"),
    }
    return checkpoints, storage


def annotate_channels(rounds, manifest):
    """Multi-channel cells: mark aggregate + derive uniform per-channel rate (F6)."""
    ch = (manifest.get("cell") or {}).get("channels")
    if not ch or ch <= 1:
        return
    for r in rounds:
        r["channelsInCell"] = ch
        r["throughputScope"] = "aggregate-across-channels"
        r["perChannelTpsDerived"] = round(r["throughputSuccessfulOnlyTps"] / ch, 3)


def compression_vs_baseline(storage, baseline_run_dir, baseline_id):
    """Log-payload compression vs a Standard baseline, in on-chain bytes/event (F12)."""
    if not storage or storage.get("bytesPerEventBlockstore") is None:
        return None
    base_manifest = os.path.join(baseline_run_dir, "manifest.json")
    if not os.path.exists(base_manifest):
        print(f"  ! baseline manifest missing: {base_manifest}")
        return None
    with open(base_manifest, encoding="utf-8") as fh:
        base = json.load(fh)
    base_bpe = (base.get("storage") or {}).get("bytesPerEventBlockstore")
    if not base_bpe:
        print("  ! baseline has no bytesPerEventBlockstore (run collect.py on it first)")
        return None
    return {
        "baselineRunId": baseline_id,
        "baselineBytesPerEvent": base_bpe,
        "bytesPerEvent": storage["bytesPerEventBlockstore"],
        "reductionFraction": round(1 - storage["bytesPerEventBlockstore"] / base_bpe, 4),
        "note": ("reduction in on-chain log-payload bytes per event vs the Standard baseline; "
                 "deliberately NOT 1/N of total ledger size (CLAUDE.md metrics contract)"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_id")
    ap.add_argument("--baseline", help="Standard-variant runId to compute payload compression against")
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
    annotate_channels(rounds, manifest)
    checkpoints, storage = storage_metrics(run_dir, rounds)

    manifest.setdefault("runId", args.run_id)
    manifest["collectedAt"] = datetime.now(timezone.utc).isoformat()
    manifest["gitCommit"] = git("rev-parse", "HEAD")
    manifest["configShas"] = config_shas()
    manifest["rounds"] = rounds
    manifest["failureClasses"] = {"MVCC_READ_CONFLICT": count_mvcc(log_path)}
    manifest["throughputPolicy"] = "successful-only (Succ/window); Caliper reported=(Succ+Fail)/window, issue #1418"
    if checkpoints is not None:
        manifest["checkpoints"] = checkpoints
    if storage is not None:
        manifest["storage"] = storage
        if args.baseline:
            comp = compression_vs_baseline(
                storage, os.path.join(REPO_ROOT, "benchmark", "results", args.baseline), args.baseline)
            if comp:
                manifest["payloadCompressionVsBaseline"] = comp

    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"collected {len(rounds)} rounds -> {manifest_path}")


if __name__ == "__main__":
    main()
