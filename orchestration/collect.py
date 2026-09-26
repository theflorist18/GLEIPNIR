#!/usr/bin/env python3
"""GLEIPNIR metrics collector (docs/CONTRACTS.md §10, §11; supervisor brief 2026-09-22 §9).

  collect.py <run-dir> [--baseline <standard-run-dir>]
  collect.py --selftest

<run-dir> is benchmark/results/<exp>/<variant>/<levels>/r<rep>/ (absolute, or
relative to benchmark/results/). It reads what experiment.py left there —
run.json (seeded identity + provenance), rounds/<label>/{caliper.log,round.json,
tx-w*.jsonl}, checkpoints.jsonl, anchoring.json, audit.json — and writes
manifest.json (`status: complete`), merging INTO the seeded run.json fields
(identity and provenance come only from run.json — experiment.py is their one writer).

Round table (audit F48): Caliper prints every round twice — per round and in
the final `### All test results ###` table. Only rows AFTER the LAST marker
are parsed. The `### docker resource stats ###` table printed per round is
parsed by header name (Memory(max)/Memory(avg) -> MB, CPU% -> %, traffic/disc ->
MB) so column order never matters.

Successful-only throughput (Caliper issue #1418): the reported Throughput
numerator is (Succ+Fail); the successful-only rate is reported x Succ/(Succ+Fail).

Per-transaction JSONL (written by the workloads from Caliper's own TxStatus
timestamps) gives p50/p95/p99 latency, measured send rate, failure classes and
the per-operation split — none of which the round summary can provide.

Storage (audit F9/F12/F70): per-channel block store from the hosting peer (org1
for app channels, the anchor peer for anchor-main), world state once per
container, receipt store separately. bytes/event = OLS slope over the
checkpoint series (>=3 points) with the t0->tN delta as cross-check. Compression
vs the Standard baseline = reduction in on-chain bytes/event — NEVER 1/N of
total ledger size (CLAUDE.md metrics contract).
"""
import argparse
import glob
import json
import math
import os
import re
import statistics
import sys
import tempfile
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_DIR = os.path.join(REPO_ROOT, "benchmark", "results")
RESULTS_MARKER = "### All test results ###"
WRITE_OPS = ("CREATE", "TRANSFER", "ACCESS", "DISPOSE")
ANCHOR_CHANNEL = "anchor-main"
CHANNEL_HOST = {ANCHOR_CHANNEL: "peer0.anchor.example.com"}
DEFAULT_HOST = "peer0.org1.example.com"
OFFCHAIN_CONTAINERS = ("gleipnir-gateway", "gleipnir-merkle-batcher", "gleipnir-receipt-store",
                       "gleipnir-verification", "gleipnir-anchor-client")
FAILURE_CLASSES = ("MVCC_READ_CONFLICT", "ENDORSEMENT_POLICY_FAILURE", "TIMEOUT", "HTTP_4XX", "HTTP_5XX", "OTHER")
THROUGHPUT_POLICY = "successful-only = reported x Succ/(Succ+Fail); Caliper reported=(Succ+Fail)/window (issue #1418)"


# ------------------------------------------------------------------ helpers

# Not statistics.quantiles(method="inclusive"): same interpolation, but a different
# float evaluation order (last-ULP differences, int -> float) would change the
# manifests of runs already collected.
def _percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * (p / 100.0)
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def summarize(values):
    vals = sorted(v for v in values if isinstance(v, (int, float)))
    if not vals:
        return None
    return {"min": vals[0], "p50": _percentile(vals, 50), "p95": _percentile(vals, 95),
            "p99": _percentile(vals, 99), "max": vals[-1], "mean": sum(vals) / len(vals), "n": len(vals)}


def _num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _read_lines(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read().splitlines()


# ------------------------------------------------------------------ caliper.log

def _tables(lines):
    """Every cli-table in the log as (start_line_index, [row dicts keyed by header])."""
    out, i = [], 0
    while i < len(lines):
        ln = lines[i]
        cells = _cells(ln)
        if cells and cells[0].lower() == "name":
            headers, rows, start = cells, [], i
            i += 1
            while i < len(lines) and lines[i].lstrip().startswith(("|", "+")):
                c = _cells(lines[i])
                if c and len(c) == len(headers) and not set(c[0]) <= set("-+ "):
                    rows.append(dict(zip(headers, c)))
                i += 1
            out.append((start, rows))
        else:
            i += 1
    return out


def _cells(line):
    s = line.strip()
    if not s.startswith("|"):
        return None
    return [c.strip() for c in s.strip("|").split("|")]


def parse_caliper_log(path):
    """-> {"results": [round rows after the LAST results marker], "docker": [table rows per round]}."""
    if not os.path.exists(path):
        return {"results": [], "docker": []}
    lines = _read_lines(path)
    marker_at = max((i for i, ln in enumerate(lines) if RESULTS_MARKER in ln), default=None)
    results, docker = [], []
    for start, rows in _tables(lines):
        if not rows:
            continue
        if "Succ" in rows[0]:
            if marker_at is None or start > marker_at:
                results.extend(rows)
        elif any(k.startswith("Memory(max)") for k in rows[0]):
            docker.append(rows)  # printed after the `### docker resource stats ###` line, once per round
    return {"results": results, "docker": docker}


def round_summary(row):
    succ, fail = int(row["Succ"]), int(row["Fail"])
    throughput = _num(row.get("Throughput (TPS)")) or 0.0
    total = succ + fail
    return {
        "label": row["Name"],
        "succ": succ,
        "fail": fail,
        "sendRateReportedTps": _num(row.get("Send Rate (TPS)")),
        "latency": {"minS": _num(row.get("Min Latency (s)")), "avgS": _num(row.get("Avg Latency (s)")),
                    "maxS": _num(row.get("Max Latency (s)"))},
        "throughputReportedTps": throughput,
        "throughputSuccessfulOnlyTps": round(throughput * succ / total, 3) if total else 0.0,
    }


_UNIT = {"B": 1 / (1024 * 1024), "KB": 1 / 1024, "MB": 1.0, "GB": 1024.0, "TB": 1024.0 * 1024}


def to_mb(value, header=""):
    """'123.4MB' | '1.2GB' | '512KB' | '123' (+ '[MB]' in the header) -> MB; '-'/'N/A' -> None."""
    if value is None:
        return None
    m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*([KMGT]?B)?\s*", str(value), re.I)
    if not m:
        return None
    unit = (m.group(2) or "").upper()
    if not unit:
        h = re.search(r"\[([KMGT]?B)\]", header, re.I)
        unit = h.group(1).upper() if h else "B"
    return round(float(m.group(1)) * _UNIT[unit], 3)


def parse_resources(table):
    """docker table rows -> {container: {memMaxMb, memAvgMb, cpuMaxPct, cpuAvgPct, ...}}."""
    per = {}
    for row in table:
        cols = {k.split(" [")[0]: (k, v) for k, v in row.items()}

        def mb(name):
            k, v = cols.get(name, ("", None))
            return to_mb(v, k)

        def pct(name):
            return _num(cols.get(name, ("", None))[1])

        name = row["Name"].lstrip("/")
        per[name] = {"memMaxMb": mb("Memory(max)"), "memAvgMb": mb("Memory(avg)"),
                     "cpuMaxPct": pct("CPU%(max)"), "cpuAvgPct": pct("CPU%(avg)"),
                     "trafficInMb": mb("Traffic In"), "trafficOutMb": mb("Traffic Out"),
                     "discReadMb": mb("Disc Read"), "discWriteMb": mb("Disc Write")}
    return per


def group_resources(per):
    def is_fabric(n):
        return n.startswith(("orderer", "peer0.", "ccaas-"))

    groups = {"fabric": [n for n in per if is_fabric(n)],
              "offchain": [n for n in per if n in OFFCHAIN_CONTAINERS],
              "all": list(per)}
    out = {}
    for g, names in groups.items():
        def s(key):
            vals = [per[n][key] for n in names if per[n].get(key) is not None]
            return round(sum(vals), 3) if vals else None
        out[g] = {"containers": names, "cpuAvgPctSum": s("cpuAvgPct"), "cpuMaxPctSum": s("cpuMaxPct"),
                  "memAvgMbSum": s("memAvgMb"), "memMaxMbSum": s("memMaxMb")}
    return out


# ------------------------------------------------------------------ tx logs

def classify_err(err):
    e = (err or "").upper()
    if "MVCC_READ_CONFLICT" in e:
        return "MVCC_READ_CONFLICT"
    if "ENDORSEMENT_POLICY_FAILURE" in e or "ENDORSEMENT POLICY" in e:
        return "ENDORSEMENT_POLICY_FAILURE"
    if "DEADLINE_EXCEEDED" in e or "TIMEOUT" in e or "TIMED OUT" in e:
        return "TIMEOUT"
    m = re.search(r"HTTP\s*(\d{3})", e)
    if m:
        return "HTTP_4XX" if m.group(1).startswith("4") else "HTTP_5XX" if m.group(1).startswith("5") else "OTHER"
    return "OTHER"


def load_txlog(round_dir):
    recs = []
    for path in sorted(glob.glob(os.path.join(round_dir, "tx-w*.jsonl"))):
        for ln in _read_lines(path):
            ln = ln.strip()
            if ln:
                try:
                    recs.append(json.loads(ln))
                except json.JSONDecodeError:
                    continue
    return recs


def is_timed(rec):
    """Untimed records (`timed: false`) are the pool/verify seeding — real ledger
    writes that were never measured. They belong in the storage denominator and
    in NO timing/throughput/failure statistic. Pre-M26 logs have no field."""
    return rec.get("timed") is not False


def scan_log_failure_classes(log_path):
    """Failure classes for the FABRIC-mode variants (Standard / Parallel).

    The pinned caliper-fabric 0.6.0 peer-gateway connector never calls
    SetErrMsg: on a failed transaction it only logs the error and returns a
    failed TxStatus (PeerGateway._submitOrEvaluateTransaction), so the
    per-transaction log records err: null and every fabric-mode failure would
    classify as OTHER. The error text exists only in the Caliper stdout that
    experiment.py tees here, so the class split for those variants is derived by
    scanning it. Counts are per log, not per transaction, and are reported
    alongside (never merged into) the tx-log classes.
    """
    if not os.path.exists(log_path):
        return None
    text = "\n".join(_read_lines(log_path))
    counts = {
        "MVCC_READ_CONFLICT": len(re.findall(r"MVCC_READ_CONFLICT", text)),
        "ENDORSEMENT_POLICY_FAILURE": len(re.findall(r"ENDORSEMENT_POLICY_FAILURE", text)),
        "TIMEOUT": len(re.findall(r"DEADLINE_EXCEEDED|deadline exceeded|ETIMEDOUT", text)),
    }
    # `Failed to submit trasaction with status code: N` — N is the Fabric
    # TxValidationCode. Recorded raw (not name-mapped) so a code this collector
    # does not know is still visible in the manifest.
    codes = {}
    for code in re.findall(r"status code:\s*(\d+)", text):
        codes[code] = codes.get(code, 0) + 1
    if not any(counts.values()) and not codes:
        return None
    return {**counts, "fabricStatusCodes": codes,
            "source": "caliper.log scan (fabric-mode connector does not populate per-tx error messages)"}


def txlog_metrics(records):
    records = [r for r in records if is_timed(r)]
    if not records:
        return None

    def block(recs):
        ok = [r for r in recs if r.get("ok") is True]
        classes = {c: 0 for c in FAILURE_CLASSES}
        for r in recs:
            if r.get("ok") is not True:
                classes[classify_err(r.get("err"))] += 1
        n = len(recs)
        return {"count": n, "ok": len(ok), "fail": n - len(ok),
                "failureRatePct": round(100.0 * (n - len(ok)) / n, 3) if n else None,
                "failureClasses": classes,
                "latencyMs": summarize([r.get("latencyMs") for r in ok])}

    out = block(records)
    creates = [r["tCreate"] for r in records if isinstance(r.get("tCreate"), (int, float))]
    finals = [r["tFinal"] for r in records if isinstance(r.get("tFinal"), (int, float))]
    window_s = (max(creates) - min(creates)) / 1000.0 if len(creates) > 1 else None
    out["sendRateMeasuredTps"] = round(len(creates) / window_s, 3) if window_s else None
    out["windowS"] = round((max(finals) - min(creates)) / 1000.0, 3) if creates and finals else None
    out["perOp"] = {op: block([r for r in records if r.get("op") == op])
                    for op in sorted({r.get("op") for r in records if r.get("op")})}
    return out


# ------------------------------------------------------------------ rounds

def collect_rounds(run_dir):
    rounds = []
    for rdir in sorted(glob.glob(os.path.join(run_dir, "rounds", "*"))):
        if not os.path.isdir(rdir):
            continue
        label = os.path.basename(rdir)
        meta = _load_json(os.path.join(rdir, "round.json")) or {}
        parsed = parse_caliper_log(os.path.join(rdir, "caliper.log"))
        rows = parsed["results"]
        row = next((r for r in rows if r["Name"] == label), rows[0] if len(rows) == 1 else None)
        if row is None:
            print(f"  ! round {label}: no summary row in caliper.log (parse miss or aborted run)")
            continue
        rnd = round_summary(row)
        rnd["index"] = meta.get("index", len(rounds))
        rnd["sendRateTps"] = meta.get("sendRateTps")
        rnd["module"] = meta.get("module")
        rnd["slice"] = meta.get("slice")
        records = load_txlog(rdir)
        rnd["txlog"] = txlog_metrics(records)
        rnd["untimedWrites"] = sum(1 for r in records
                                   if not is_timed(r) and r.get("ok") is True and r.get("op") in WRITE_OPS)
        rnd["failureClasses"] = rnd["txlog"]["failureClasses"] if rnd["txlog"] else None
        if rnd["fail"]:
            rnd["failureClassesLogScan"] = scan_log_failure_classes(os.path.join(rdir, "caliper.log"))
        table = parsed["docker"][0] if parsed["docker"] else None
        if table:
            per = parse_resources(table)
            rnd["resources"] = {"containers": per, "groups": group_resources(per)}
        else:
            rnd["resources"] = None
        rounds.append(rnd)
    rounds.sort(key=lambda r: (r["index"], r["label"]))
    return rounds


def annotate_channels(rounds, channels):
    if not channels or channels <= 1:
        return
    for r in rounds:
        r["channelsInCell"] = channels
        r["throughputScope"] = "aggregate-across-channels"
        r["perChannelTpsDerived"] = round(r["throughputSuccessfulOnlyTps"] / channels, 3)


def write_events(rnd):
    """Ledger write events a round produced — the storage denominator.

    Counts the TIMED successful writes (tx-log per-op split, else Succ for a
    write module) PLUS the round's untimed pool/verify seeding, which commits
    real transactions before the measured phase. Omitting the seeds divides an
    `ops` round's block-store growth by the timed count alone and inflates
    bytes/event several-fold.
    """
    tl = rnd.get("txlog")
    if tl and tl.get("perOp"):
        timed = sum(v["ok"] for op, v in tl["perOp"].items() if op in WRITE_OPS)
    else:
        timed = rnd["succ"] if (rnd.get("module") or "").endswith(
            ("trace.js", "createEvidence.js", "transferCustody.js", "accessLog.js", "disposeEvidence.js")) else 0
    return timed + (rnd.get("untimedWrites") or 0)


# ------------------------------------------------------------------ storage

def load_checkpoints(run_dir):
    path = os.path.join(run_dir, "checkpoints.jsonl")
    if not os.path.exists(path):
        return []
    return [json.loads(ln) for ln in _read_lines(path) if ln.strip()]


def reduce_checkpoint(rows, label):
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
    on_chain = sum(ledger.values())
    return {"label": label, "tsUtc": ts, "ledgerBytes": ledger, "onChainBytes": on_chain,
            "stateBytes": state_total, "receiptBytes": receipts}


def ols(points):
    """points = [(x, y)] -> {slope, intercept, r2, points} or None (< 3 points / degenerate x)."""
    if len(points) < 3:
        return None
    xs, ys = zip(*points)
    try:
        slope, intercept = statistics.linear_regression(xs, ys)
    except statistics.StatisticsError:   # constant x
        return None
    # A flat y series has no variance to explain: r2 is undefined, not 1.0
    # (reporting 1.0 would dress a dead storage probe as a perfect fit).
    try:
        r2 = round(statistics.correlation(xs, ys) ** 2, 5)
    except statistics.StatisticsError:
        r2 = None
    return {"slope": round(slope, 4), "intercept": round(intercept, 1), "r2": r2, "points": len(points)}


def storage_metrics(run_dir, rounds):
    rows = load_checkpoints(run_dir)
    if not rows:
        return None, None
    labels = list(dict.fromkeys(r["label"] for r in rows))   # t0..tN, first-seen order
    checkpoints = []
    for k, lb in enumerate(labels):
        cp = reduce_checkpoint(rows, lb)
        # t_k follows round k-1: cumulative successful write events of rounds[:k]
        cp["events"] = sum(write_events(r) for r in rounds[:k])
        checkpoints.append(cp)
    if len(checkpoints) < 2:
        return checkpoints, None
    t0, tn = checkpoints[0], checkpoints[-1]
    if not tn["ledgerBytes"]:
        # No checkpoint row matched the hosting-peer filter (container or channel
        # name drift, or `du` failing inside the container). Publish nothing
        # rather than "0 bytes/event" — report.py then prints '-'.
        print("  ! storage: no block-store rows for the hosting peer at the last checkpoint "
              f"({tn['label']}) — storage metrics omitted; check checkpoint.py's container/channel names")
        return checkpoints, None
    per_channel = {ch: tn["ledgerBytes"][ch] - t0["ledgerBytes"].get(ch, 0) for ch in tn["ledgerBytes"]}
    app_delta = sum(v for ch, v in per_channel.items() if ch != ANCHOR_CHANNEL)
    anchor_delta = per_channel.get(ANCHOR_CHANNEL, 0)
    on_chain_delta = app_delta + anchor_delta
    events = tn["events"]
    off_chain = (tn["receiptBytes"] - t0["receiptBytes"]
                 if tn.get("receiptBytes") is not None and t0.get("receiptBytes") is not None else None)
    storage = {
        "checkpoints": [cp["label"] for cp in checkpoints],
        "bytesPerEventRegression": ols([(cp["events"], cp["onChainBytes"]) for cp in checkpoints]),
        "bytesPerEventDelta": round(on_chain_delta / events, 3) if events else None,
        "onChainDeltaBytes": on_chain_delta,
        "appChannelsDeltaBytes": app_delta,
        "anchorChannelDeltaBytes": anchor_delta,
        "perChannelDeltaBytes": per_channel,
        "stateDeltaBytes": tn["stateBytes"] - t0["stateBytes"],
        "offChainDeltaBytes": off_chain,
        "offChainBytesPerEvent": round(off_chain / events, 3) if (off_chain is not None and events) else None,
        "successfulWriteEvents": events,
        "policy": ("on-chain bytes/event = OLS slope of (cumulative successful write events, app-channel + "
                   "anchor-channel block store bytes) over the t0..tN checkpoints, cross-checked by the t0->tN "
                   "delta / events; per-channel from its hosting peer; world state once per container; receipt "
                   "store (off-chain, incl. event bodies) reported separately; never 1/N of total ledger size"),
    }
    return checkpoints, storage


# ------------------------------------------------------------------ anchoring / audit

def anchoring_metrics(run_dir):
    st = _load_json(os.path.join(run_dir, "anchoring.json"))
    if not st:
        return None
    batches = [b for b in st.get("batches", []) if b.get("rootStatus", "committed") == "committed"]

    def delay(bs):
        with_delay = [b for b in bs if isinstance(b.get("delayMs"), dict)]
        if not with_delay:
            return None
        weights = [b.get("leafCount") or 1 for b in with_delay]
        mean = sum(b["delayMs"]["mean"] * w for b, w in zip(with_delay, weights)) / sum(weights)
        return {"minS": round(min(b["delayMs"]["min"] for b in with_delay) / 1000, 3),
                "meanS": round(mean / 1000, 3),
                "maxS": round(max(b["delayMs"]["max"] for b in with_delay) / 1000, 3),
                "batches": len(with_delay)}

    return {"batchSize": st.get("batchSize"), "flushTimeoutMs": st.get("flushTimeoutMs"),
            "batches": len(st.get("batches", [])), "committedBatches": len(batches),
            "forcedBatches": sum(1 for b in st.get("batches", []) if b.get("forced")),
            "delay": delay(batches), "delayExcludingForced": delay([b for b in batches if not b.get("forced")]),
            "note": "delay = committedAt - event enqueue time (batcher), leafCount-weighted mean over committed batches"}


def audit_metrics(run_dir):
    a = _load_json(os.path.join(run_dir, "audit.json"))
    if not a:
        return None
    return {"method": a.get("method"), "cases": len(a.get("cases", [])), "summary": a.get("summary")}


def compression_vs_baseline(storage, baseline_dir):
    bpe = (storage or {}).get("bytesPerEventRegression") or {}
    mine = bpe.get("slope") if bpe else (storage or {}).get("bytesPerEventDelta")
    base = _load_json(os.path.join(resolve_run_dir(baseline_dir), "manifest.json"))
    if mine is None or not base:
        print("  ! baseline compression skipped (missing bytes/event or baseline manifest)")
        return None
    bst = base.get("storage") or {}
    breg = bst.get("bytesPerEventRegression") or {}
    base_bpe = breg.get("slope") if breg else bst.get("bytesPerEventDelta")
    if not base_bpe:
        print("  ! baseline has no bytes/event (collect it first)")
        return None
    return {"baselineRunId": base.get("runId"), "baselineBytesPerEvent": base_bpe, "bytesPerEvent": mine,
            "reductionFraction": round(1 - mine / base_bpe, 4),
            "note": "reduction in on-chain log-payload bytes per event vs the Standard baseline; NOT 1/N of ledger size"}


# ------------------------------------------------------------------ main

def _load_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return None


def resolve_run_dir(arg):
    return arg if os.path.isdir(arg) else os.path.join(RESULTS_DIR, arg)


def collect(run_dir, baseline=None):
    run_dir = resolve_run_dir(run_dir)
    manifest = _load_json(os.path.join(run_dir, "manifest.json")) or {}
    seeded = _load_json(os.path.join(run_dir, "run.json")) or {}
    for k, v in seeded.items():           # identity + provenance from experiment.py win
        manifest[k] = v
    levels = manifest.get("levels") or {}

    rounds = collect_rounds(run_dir)
    annotate_channels(rounds, levels.get("channels"))
    checkpoints, storage = storage_metrics(run_dir, rounds)
    manifest["rounds"] = rounds
    manifest["storage"] = storage or {}
    if checkpoints:
        manifest["storage"]["series"] = checkpoints
    manifest["anchoring"] = anchoring_metrics(run_dir)
    manifest["audit"] = audit_metrics(run_dir)
    if baseline:
        comp = compression_vs_baseline(storage, baseline)
        if comp:
            manifest["payloadCompressionVsBaseline"] = comp
    manifest["throughputPolicy"] = THROUGHPUT_POLICY
    manifest["collectedAt"] = datetime.now(timezone.utc).isoformat()
    manifest["status"] = "complete" if rounds else "incomplete"
    with open(os.path.join(run_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"collected {len(rounds)} round(s) -> {os.path.join(run_dir, 'manifest.json')} (status {manifest['status']})")
    return manifest


# ------------------------------------------------------------------ selftest

_FIXTURE_LOG = """
2026.09.22-10:00:00.000 info [caliper] [report] ### Test result ###
+--------+------+------+-----------------+-----------------+-----------------+-----------------+------------------+
| Name   | Succ | Fail | Send Rate (TPS) | Max Latency (s) | Min Latency (s) | Avg Latency (s) | Throughput (TPS) |
|--------|------|------|-----------------|-----------------|-----------------|-----------------|------------------|
| slice0 | 90   | 10   | 50.1            | 0.90            | 0.10            | 0.30            | 50.0             |
+--------+------+------+-----------------+-----------------+-----------------+-----------------+------------------+
2026.09.22-10:00:01.000 info [caliper] [report] ### docker resource stats ###'
+---------------------------+------------------+------------------+-----------+-----------+------------------+-------------------+----------------+-----------------+
| Name                      | Memory(max) [MB] | Memory(avg) [MB] | CPU%(max) | CPU%(avg) | Traffic In [KB]  | Traffic Out [KB]  | Disc Read [B]  | Disc Write [MB] |
|---------------------------|------------------|------------------|-----------|-----------|------------------|-------------------|----------------|-----------------|
| /peer0.org1.example.com   | 200              | 150              | 40.5      | 20.25     | 512              | 256               | 0              | 2.5             |
| /gleipnir-gateway         | 1.5GB            | 512KB            | 10        | 5         | 1024             | 1024              | 0              | 0               |
+---------------------------+------------------+------------------+-----------+-----------+------------------+-------------------+----------------+-----------------+
2026.09.22-10:00:02.000 info [caliper] [report-builder] ### All test results ###
+--------+------+------+-----------------+-----------------+-----------------+-----------------+------------------+
| Name   | Succ | Fail | Send Rate (TPS) | Max Latency (s) | Min Latency (s) | Avg Latency (s) | Throughput (TPS) |
|--------|------|------|-----------------|-----------------|-----------------|-----------------|------------------|
| slice0 | 90   | 10   | 50.1            | 0.90            | 0.10            | 0.30            | 50.0             |
+--------+------+------+-----------------+-----------------+-----------------+-----------------+------------------+
"""


def selftest():
    with tempfile.TemporaryDirectory() as tmp:
        run = os.path.join(tmp, "e1", "anchoring", "batch50-ch1-cases20", "r0")
        rdir = os.path.join(run, "rounds", "slice0")
        os.makedirs(rdir)
        _dump(os.path.join(run, "run.json"), {"runId": "e1/anchoring/batch50-ch1-cases20/r0", "experiment": "e1",
                                              "variant": "anchoring", "repetition": 0, "regime": "steady",
                                              "levels": {"batchSize": 50, "channels": 1, "cases": 20,
                                                         "sendRateTps": 50, "reference": False},
                                              "provenance": {"gitCommit": "abc"}})
        with open(os.path.join(rdir, "caliper.log"), "w", encoding="utf-8") as fh:
            fh.write(_FIXTURE_LOG)
        _dump(os.path.join(rdir, "round.json"), {"index": 0, "label": "slice0", "sendRateTps": 50,
                                                 "module": "workload/trace.js", "slice": 0})
        # 100 tx: 90 ok (latency 100..990 ms), 10 failed with mixed classes; tCreate 1 per 20 ms.
        with open(os.path.join(rdir, "tx-w0.jsonl"), "w", encoding="utf-8") as fh:
            errs = ["MVCC_READ_CONFLICT: x"] * 4 + ["endorsement policy failure"] * 2 + \
                   ["DEADLINE_EXCEEDED"] * 2 + ["HTTP 503"] + ["weird"]
            for i in range(100):
                ok = i < 90
                rec = {"round": "slice0", "op": "ACCESS" if i % 2 else "CREATE", "caseId": "case-001",
                       "evidenceId": f"ev-{i}", "tCreate": 1000 + 20 * i, "tFinal": 1000 + 20 * i + 100 + 10 * i,
                       "latencyMs": 100 + 10 * i, "ok": ok, "err": None if ok else errs[i - 90]}
                fh.write(json.dumps(rec) + "\n")
            # 20 UNTIMED pool seeds (18 committed): real ledger writes, so they
            # count toward storage bytes/event and toward NO timing statistic.
            for i in range(20):
                fh.write(json.dumps({"round": "slice0", "op": "CREATE", "caseId": "case-001",
                                     "evidenceId": f"seed-{i}", "tCreate": None, "tFinal": None,
                                     "latencyMs": None, "ok": i < 18, "err": None, "timed": False}) + "\n")
        cps = []
        for label, ev_bytes, receipt in (("t0", 1000, 100), ("t1", 1900, 1000)):
            cps.append({"runId": "x", "label": label, "tsUtc": "t", "container": "peer0.org1.example.com",
                        "channel": "coc-main", "blockstoreBytes": ev_bytes, "stateBytes": None, "receiptBytes": None})
            cps.append({"runId": "x", "label": label, "tsUtc": "t", "container": "peer0.org2.example.com",
                        "channel": "coc-main", "blockstoreBytes": ev_bytes + 7, "stateBytes": None, "receiptBytes": None})
            cps.append({"runId": "x", "label": label, "tsUtc": "t", "container": "peer0.org1.example.com",
                        "channel": None, "blockstoreBytes": None, "stateBytes": 50, "receiptBytes": None})
            cps.append({"runId": "x", "label": label, "tsUtc": "t", "container": "gleipnir-receipt-store",
                        "channel": None, "blockstoreBytes": None, "stateBytes": None, "receiptBytes": receipt})
        with open(os.path.join(run, "checkpoints.jsonl"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(json.dumps(c) for c in cps) + "\n")
        _dump(os.path.join(run, "anchoring.json"), {"batchSize": 50, "flushTimeoutMs": 0, "batches": [
            {"batchId": "b1", "leafCount": 50, "rootStatus": "committed", "forced": False,
             "delayMs": {"min": 100, "mean": 200, "max": 300}},
            {"batchId": "b2", "leafCount": 40, "rootStatus": "committed", "forced": True,
             "delayMs": {"min": 50, "mean": 650, "max": 900}},
            {"batchId": "b3", "leafCount": 10, "rootStatus": "failed", "forced": False,
             "delayMs": {"min": 1, "mean": 1, "max": 1}}]})
        _dump(os.path.join(run, "audit.json"), {"variant": "anchoring", "method": "merkle",
                                                "cases": [{"caseId": "case-001"}],
                                                "summary": {"msPerCase": {"mean": 12.0}, "okRate": 1.0}})

        m = collect(run)
        r = m["rounds"][0]
        assert m["status"] == "complete" and len(m["rounds"]) == 1, m["status"]
        assert m["runId"] == "e1/anchoring/batch50-ch1-cases20/r0" and m["provenance"]["gitCommit"] == "abc"
        assert r["succ"] == 90 and r["fail"] == 10 and r["throughputSuccessfulOnlyTps"] == 45.0, r
        assert r["latency"] == {"minS": 0.1, "avgS": 0.3, "maxS": 0.9}
        t = r["txlog"]
        # Untimed seeds are invisible to every timing/failure statistic...
        assert t["count"] == 100 and t["ok"] == 90 and t["fail"] == 10 and t["failureRatePct"] == 10.0
        # ...and visible to the storage denominator alone.
        assert r["untimedWrites"] == 18, r["untimedWrites"]
        assert t["failureClasses"] == {"MVCC_READ_CONFLICT": 4, "ENDORSEMENT_POLICY_FAILURE": 2, "TIMEOUT": 2,
                                       "HTTP_4XX": 0, "HTTP_5XX": 1, "OTHER": 1}, t["failureClasses"]
        lat = t["latencyMs"]
        assert lat["min"] == 100 and lat["max"] == 990 and lat["p50"] == 545.0 and abs(lat["p95"] - 945.5) < 1e-9
        assert abs(lat["mean"] - 545.0) < 1e-9 and lat["n"] == 90, lat
        assert abs(t["sendRateMeasuredTps"] - 100 / 1.98) < 1e-3, t["sendRateMeasuredTps"]  # rounded to 3 dp
        assert set(t["perOp"]) == {"CREATE", "ACCESS"} and t["perOp"]["CREATE"]["count"] == 50
        res = r["resources"]["containers"]
        assert res["peer0.org1.example.com"] == {"memMaxMb": 200.0, "memAvgMb": 150.0, "cpuMaxPct": 40.5,
                                                 "cpuAvgPct": 20.25, "trafficInMb": 0.5, "trafficOutMb": 0.25,
                                                 "discReadMb": 0.0, "discWriteMb": 2.5}, res
        assert res["gleipnir-gateway"]["memMaxMb"] == 1536.0 and res["gleipnir-gateway"]["memAvgMb"] == 0.5
        g = r["resources"]["groups"]
        assert g["fabric"]["containers"] == ["peer0.org1.example.com"] and g["offchain"]["cpuAvgPctSum"] == 5.0
        assert g["all"]["cpuAvgPctSum"] == 25.25 and g["all"]["memMaxMbSum"] == 1736.0, g["all"]
        s = m["storage"]
        # 90 timed successful writes + 18 untimed seeds = 108 ledger events.
        assert s["onChainDeltaBytes"] == 900 and s["successfulWriteEvents"] == 108, s
        assert s["bytesPerEventDelta"] == 8.333 and s["offChainDeltaBytes"] == 900 \
            and s["offChainBytesPerEvent"] == 8.333, s
        assert s["bytesPerEventRegression"] is None  # 2 points < 3 -> no OLS, delta only
        assert [cp["events"] for cp in s["series"]] == [0, 108]
        assert ols([(0, 1000), (90, 1900), (180, 2800)]) == {"slope": 10.0, "intercept": 1000.0, "r2": 1.0, "points": 3}
        # A flat series has no variance to explain: r2 is undefined, never 1.0.
        assert ols([(0, 500), (90, 500), (180, 500)])["r2"] is None
        a = m["anchoring"]
        assert a["batches"] == 3 and a["committedBatches"] == 2 and a["forcedBatches"] == 1, a
        assert a["delay"] == {"minS": 0.05, "meanS": 0.4, "maxS": 0.9, "batches": 2}, a["delay"]
        assert a["delayExcludingForced"] == {"minS": 0.1, "meanS": 0.2, "maxS": 0.3, "batches": 1}
        assert m["audit"]["cases"] == 1 and m["audit"]["summary"]["msPerCase"]["mean"] == 12.0
        assert to_mb("1.2GB") == 1228.8 and to_mb("512KB") == 0.5 and to_mb("123.4MB") == 123.4 and to_mb("-") is None
        assert classify_err("HTTP 404") == "HTTP_4XX" and classify_err(None) == "OTHER"
    print("collect.py selftest OK")


def _dump(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dir", nargs="?", help="results/<exp>/<variant>/<levels>/r<rep> (abs or relative to results/)")
    ap.add_argument("--baseline", help="Standard-variant run dir to compute payload compression against")
    ap.add_argument("--selftest", action="store_true", help="run the inline fixture check and exit")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    if not args.run_dir:
        ap.error("run_dir required (or --selftest)")
    m = collect(args.run_dir, args.baseline)
    if not m["rounds"]:
        sys.exit("FATAL: 0 rounds collected — caliper.log parse miss or the run had no summary rows")


if __name__ == "__main__":
    main()
