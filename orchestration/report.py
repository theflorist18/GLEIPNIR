#!/usr/bin/env python3
"""GLEIPNIR report — tables (CSV + Markdown, UNITS in headers, mean ± SD over
repetitions) and optional matplotlib charts per experiment (brief 2026-09-22 §9),
plus a per-round CSV export for Excel of EVERY experiment.

  report.py --exp e0|ramp|e1|e2|e3a|e3b|ops|cell [--out docs/results/<exp>] [--results <dir>]
            [--no-charts] [--decimal-comma]

Always: benchmark/results/<exp>/<exp>-results.csv — one row per (run, round), every
factor level, control and metric as its own numeric column with its unit in the
header (column order follows the supervisor's table: send rate, throughput, latency
min/max/avg/p95, CPU, memory, success, failure, failure rate). UTF-8 with BOM so
Excel opens it directly; --decimal-comma writes `;`-separated, comma-decimal CSV for
an Excel whose regional settings use a decimal comma (e.g. Indonesian). The
aggregated tables and charts below exist for e1|e2|e3a|e3b|ops only.

Loads every `status: complete` manifest under benchmark/results/<exp>/ and groups
runs by (variant, X): E1 X = batch size (Standard/Parallel reference runs -> dashed
horizontal lines), E2 X = channels, E3a X = send rate (one data point per ROUND;
y = x reference; saturation = first send rate where mean throughput < 0.9 x send
rate; latency knee = first rate where p95 >= 2 x p95 at the lowest rate), E3b X =
cases, ops -> two tables (writes, reads) keyed by round label.

Run-level numbers are means over the run's rounds (p95 = mean of per-round p95;
the per-transaction p95 of each round is in the manifest). Charts are skipped with a
message when matplotlib is not installed — the tables are always written.
"""
import argparse
import csv
import glob
import json
import os
import statistics
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_DIR = os.path.join(REPO_ROOT, "benchmark", "results")
EXPS = ["e1", "e2", "e3a", "e3b", "ops"]              # aggregated tables + charts
EXPORT_EXPS = ["e0", "ramp", *EXPS, "cell"]            # per-round CSV export
VARIANT_ORDER = ["standard", "anchoring", "parallel", "parallel-anchored"]
SATURATION_RATIO = 0.9
RAMP_MARGIN = 0.5             # suggested send rate <= this x the saturation point (a margin below the knee)
# Baseline-selection thresholds — docs/methodology/experiments.md §4.1/§4.2 (confirm with D).
PLATEAU_REL = 0.05            # §4.1 throughput AND on-chain bytes/event change to the next level <= 5 %
AUDIT_BOUND = 1.5             # §4.1 audit time per case <= 1.5 x its value at the smallest level
HEALTHY_TPS_RATIO = 0.95      # §4.2 throughput >= 0.95 x the previous level
HEALTHY_MAX_FAIL_PCT = 1.0    # §4.2 failure rate <= 1 %
HEALTHY_CPU_FRAC = 0.9        # §4.2 summed container CPU <= 0.9 x cores x 100 %
WRITE_OPS = ("create", "transfer", "access", "dispose")
READ_OPS = ("read-evidence", "read-trail", "verify-event")
X_LABEL = {"e1": "batch size (events)", "e2": "channels (n)", "e3a": "send rate (tx/s)", "e3b": "cases (n)",
           "ops": "operation"}
FAILURE_CLASSES = ("MVCC_READ_CONFLICT", "ENDORSEMENT_POLICY_FAILURE", "TIMEOUT", "HTTP_4XX", "HTTP_5XX", "OTHER")

# (key, header with unit, decimals) — column order follows the supervisor's result table:
# send rate | throughput | latency (min, max, avg, p95) | CPU | memory | success | failure rate
METRICS = [
    ("sendRateTps", "send rate (tx/s)", 0),
    ("throughputTps", "throughput (TPS)", 1),
    ("latencyMinS", "latency min (s)", 3),
    ("latencyMaxS", "latency max (s)", 3),
    ("latencyAvgS", "latency avg (s)", 3),
    ("latencyP95S", "latency p95 (s)", 3),
    ("cpuPct", "CPU (%, sum of container avgs)", 1),
    ("memMb", "memory (MB, sum of container avgs)", 0),
    ("succ", "success (n)", 0),
    ("fail", "failure (n)", 0),
    ("failureRatePct", "failure rate (%)", 2),
    ("onChainBytesPerEvent", "on-chain bytes/event (B)", 1),
    ("offChainBytesPerEvent", "off-chain bytes/event (B)", 1),
    ("auditSPerCase", "audit time per case (s)", 3),
    ("anchoringDelayS", "anchoring delay (s)", 3),
]
CHART_METRICS = [k for k, _, _ in METRICS if k not in ("sendRateTps", "latencyMinS", "latencyMaxS", "succ", "fail")]
LATENCY_KEYS = ("latencyMinS", "latencyMaxS", "latencyAvgS", "latencyP95S")


def mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return sum(xs) / len(xs) if xs else None


def load_manifests(exp, results_dir):
    out = []
    for path in sorted(glob.glob(os.path.join(results_dir, exp, "*", "*", "r*", "manifest.json"))):
        try:
            with open(path, encoding="utf-8") as fh:
                m = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        if m.get("status") == "complete" and m.get("rounds"):
            out.append(m)
    return out


def round_metrics(m, r):
    tl = r.get("txlog") or {}
    lat = tl.get("latencyMs") or {}
    groups = ((r.get("resources") or {}).get("groups") or {}).get("all") or {}
    st = m.get("storage") or {}
    reg = st.get("bytesPerEventRegression") or {}
    au = ((m.get("audit") or {}).get("summary") or {}).get("msPerCase") or {}
    an = ((m.get("anchoring") or {}).get("delay") or {})
    succ, fail = r.get("succ", 0), r.get("fail", 0)
    return {
        "sendRateTps": r.get("sendRateTps"),
        "throughputTps": r.get("throughputSuccessfulOnlyTps"),
        "latencyAvgS": (r.get("latency") or {}).get("avgS"),
        "latencyMinS": (r.get("latency") or {}).get("minS"),
        "latencyMaxS": (r.get("latency") or {}).get("maxS"),
        "latencyP95S": lat["p95"] / 1000.0 if isinstance(lat.get("p95"), (int, float)) else None,
        "succ": succ, "fail": fail,
        "failureRatePct": 100.0 * fail / (succ + fail) if (succ + fail) else None,
        "cpuPct": groups.get("cpuAvgPctSum"), "memMb": groups.get("memAvgMbSum"),
        "onChainBytesPerEvent": reg.get("slope") if reg else st.get("bytesPerEventDelta"),
        "offChainBytesPerEvent": st.get("offChainBytesPerEvent"),
        "auditSPerCase": au["mean"] / 1000.0 if isinstance(au.get("mean"), (int, float)) else None,
        "anchoringDelayS": an.get("meanS"),
    }


def run_metrics(m):
    per = [round_metrics(m, r) for r in m["rounds"]]
    out = {k: mean(p[k] for p in per) for k, _, _ in METRICS}
    out["succ"] = sum(p["succ"] for p in per)
    out["fail"] = sum(p["fail"] for p in per)
    tot = out["succ"] + out["fail"]
    out["failureRatePct"] = 100.0 * out["fail"] / tot if tot else None
    mins = [p["latencyMinS"] for p in per if p["latencyMinS"] is not None]
    maxs = [p["latencyMaxS"] for p in per if p["latencyMaxS"] is not None]
    out["latencyMinS"] = min(mins) if mins else None
    out["latencyMaxS"] = max(maxs) if maxs else None
    return out


def data_points(exp, manifests):
    """-> [(variant, x, reference, metrics)] one per run (or per round for e3a/ops)."""
    pts = []
    for m in manifests:
        lv, v = m.get("levels") or {}, m["variant"]
        ref = bool(lv.get("reference"))
        if exp == "e3a":
            for r in m["rounds"]:
                pts.append((v, r.get("sendRateTps"), ref, round_metrics(m, r)))
        elif exp == "ops":
            for r in m["rounds"]:
                pts.append((v, r["label"], ref, round_metrics(m, r)))
        else:
            x = {"e1": lv.get("batchSize"), "e2": lv.get("channels"), "e3b": lv.get("cases")}[exp]
            pts.append((v, x, ref, run_metrics(m)))
    return pts


def aggregate(points):
    """group by (variant, x, reference) -> {metric: (mean, sd, n)}."""
    groups = {}
    for v, x, ref, met in points:
        groups.setdefault((v, x, ref), []).append(met)
    rows = []
    for (v, x, ref), mets in sorted(groups.items(), key=lambda kv: (VARIANT_ORDER.index(kv[0][0]), _sort_x(kv[0][1]), kv[0][2])):
        agg = {}
        for k, _, _ in METRICS:
            vals = [mm[k] for mm in mets if isinstance(mm.get(k), (int, float))]
            agg[k] = (mean(vals), statistics.stdev(vals) if len(vals) > 1 else 0.0, len(vals)) if vals else (None, 0.0, 0)
        rows.append({"variant": v, "x": x, "reference": ref, "n": len(mets), "metrics": agg})
    return rows


def _sort_x(x):
    return (0, x, "") if isinstance(x, (int, float)) else (1, 0, str(x))


def fmt(pair, dec):
    m, sd, n = pair
    if m is None:
        return "-"
    return f"{m:.{dec}f}" if n < 2 else f"{m:.{dec}f} ± {sd:.{dec}f}"


def x_cell(r):
    """E1's Standard/Parallel reference runs have no batch size — print the
    horizontal-reference marker, never the literal 'None'."""
    return "ref" if r["x"] is None else str(r["x"])


# Metrics measured once per RUN, not per round: in the per-round tables (e3a,
# ops) the same run-level value repeats on every row, so the table says so.
RUN_LEVEL_METRICS = ("onChainBytesPerEvent", "offChainBytesPerEvent", "auditSPerCase", "anchoringDelayS")


def csv_writer(fh, decimal_comma):
    return csv.writer(fh, delimiter=";" if decimal_comma else ",")


def num(v, dec=None, decimal_comma=False):
    """CSV cell: '' for missing, a plain number otherwise (Excel parses it as a number)."""
    if v is None or v == "":
        return ""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return v
    s = str(round(v, 6 if dec is None else dec))   # 6 dp: drops float noise like 2.0582399999999996
    return s.replace(".", ",") if decimal_comma else s


def latency_cell(met):
    """Markdown latency column, the call's format: avg (min–max), plus p95 (means over reps; SDs in the CSV)."""
    avg, lo, hi, p95 = (met[k][0] for k in ("latencyAvgS", "latencyMinS", "latencyMaxS", "latencyP95S"))
    if avg is None:
        return "-"
    rng = f" ({lo:.3f}–{hi:.3f})" if lo is not None and hi is not None else ""
    return f"{avg:.3f}{rng}" + (f", p95 {p95:.3f}" if p95 is not None else "")


def write_tables(exp, rows, out_dir, name, x_label, flags=None, per_round=False, decimal_comma=False):
    os.makedirs(out_dir, exist_ok=True)
    # e3a's X IS the send rate, so the separate send-rate column would only repeat it.
    metrics = [m for m in METRICS if not (exp == "e3a" and m[0] == "sendRateTps")]
    headers = ["variant", x_label, "reps (n)"] + [h for _, h, _ in metrics] + (["flag"] if flags else [])
    csv_path, md_path = os.path.join(out_dir, f"{name}.csv"), os.path.join(out_dir, f"{name}.md")
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv_writer(fh, decimal_comma)
        w.writerow(headers + [f"{h} SD" for _, h, _ in metrics])
        for r in rows:
            base = [r["variant"] + (" (reference)" if r["reference"] else ""), num(r["x"], None, decimal_comma)
                    if r["x"] is not None else "ref", r["n"]]
            means = [num(r["metrics"][k][0], d, decimal_comma) for k, _, d in metrics]
            sds = [num(r["metrics"][k][1] if r["metrics"][k][0] is not None else None, d, decimal_comma)
                   for k, _, d in metrics]
            w.writerow(base + means + ([flags.get((r["variant"], r["x"]), "")] if flags else []) + sds)
    # Markdown: one table per variant (the supervisor's layout: X down the rows) and latency as ONE
    # column, avg (min–max) + p95, per the 17 Sep call.
    md_metrics = [m for m in metrics if m[0] not in LATENCY_KEYS]
    lat_at = next(i for i, m in enumerate(md_metrics) if m[0] == "cpuPct")
    md_headers = [x_label, "reps (n)"] + [h for _, h, _ in md_metrics[:lat_at]] + \
        ["latency (s): avg (min–max), p95"] + [h for _, h, _ in md_metrics[lat_at:]] + (["flag"] if flags else [])
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(f"# {exp} — {name}\n\nmean ± SD over repetitions; throughput is successful-only; "
                 "latency avg/min/max are Caliper's, p95 from per-transaction logs (mean of per-round p95); "
                 "the latency column shows means only — the SDs are in the CSV.\n")
        if per_round:
            fh.write("\nOne row per round. "
                     + ", ".join(h for k, h, _ in METRICS if k in RUN_LEVEL_METRICS)
                     + " are measured once per RUN, so the same value repeats on every row of a run — "
                       "they are not per-row measurements.\n")
        for v in VARIANT_ORDER:
            vrows = [r for r in rows if r["variant"] == v]
            if not vrows:
                continue
            fh.write(f"\n## {v}\n\n| " + " | ".join(md_headers) + " |\n|" + "---|" * len(md_headers) + "\n")
            for r in vrows:
                cells = [x_cell(r) + (" (reference)" if r["reference"] else ""), str(r["n"])]
                cells += [fmt(r["metrics"][k], d) for k, _, d in md_metrics[:lat_at]]
                cells.append(latency_cell(r["metrics"]))
                cells += [fmt(r["metrics"][k], d) for k, _, d in md_metrics[lat_at:]]
                if flags:
                    cells.append(flags.get((r["variant"], r["x"]), ""))
                fh.write("| " + " | ".join(cells) + " |\n")
    print(f"wrote {csv_path}\nwrote {md_path}")


def _get(d, *path):
    for k in path:
        d = d.get(k) if isinstance(d, dict) else None
    return d


# (header with unit, value(manifest, round, round_metrics)) — one CSV row per (run, round).
# Metrics first in the supervisor's table order, then everything needed to filter/pivot in Excel.
EXPORT_COLUMNS = [
    ("experiment", lambda m, r, x: m.get("experiment")),
    ("variant", lambda m, r, x: m.get("variant")),
    ("batch size (events)", lambda m, r, x: _get(m, "levels", "batchSize")),
    ("channels (n)", lambda m, r, x: _get(m, "levels", "channels")),
    ("cases (n)", lambda m, r, x: _get(m, "levels", "cases")),
    ("repetition", lambda m, r, x: m.get("repetition")),
    ("round", lambda m, r, x: r.get("label")),
    ("send rate (tx/s)", lambda m, r, x: x["sendRateTps"]),
    ("throughput (TPS)", lambda m, r, x: x["throughputTps"]),
    ("latency min (s)", lambda m, r, x: x["latencyMinS"]),
    ("latency max (s)", lambda m, r, x: x["latencyMaxS"]),
    ("latency avg (s)", lambda m, r, x: x["latencyAvgS"]),
    ("latency p95 (s)", lambda m, r, x: x["latencyP95S"]),
    ("CPU (%)", lambda m, r, x: x["cpuPct"]),
    ("memory (MB)", lambda m, r, x: x["memMb"]),
    ("success (n)", lambda m, r, x: x["succ"]),
    ("failure (n)", lambda m, r, x: x["fail"]),
    ("failure rate (%)", lambda m, r, x: x["failureRatePct"]),
    ("measured send rate (tx/s)", lambda m, r, x: _get(r, "txlog", "sendRateMeasuredTps")),
    ("per-channel throughput (TPS)", lambda m, r, x: r.get("perChannelTpsDerived")),
    ("latency p50 (s)", lambda m, r, x: _ms_to_s(_get(r, "txlog", "latencyMs", "p50"))),
    ("latency p99 (s)", lambda m, r, x: _ms_to_s(_get(r, "txlog", "latencyMs", "p99"))),
    ("CPU fabric (%)", lambda m, r, x: _get(r, "resources", "groups", "fabric", "cpuAvgPctSum")),
    ("memory fabric (MB)", lambda m, r, x: _get(r, "resources", "groups", "fabric", "memAvgMbSum")),
    ("CPU off-chain (%)", lambda m, r, x: _get(r, "resources", "groups", "offchain", "cpuAvgPctSum")),
    ("memory off-chain (MB)", lambda m, r, x: _get(r, "resources", "groups", "offchain", "memAvgMbSum")),
    *[(f"{c} (n)", (lambda c: lambda m, r, x: _get(r, "failureClasses", c))(c)) for c in FAILURE_CLASSES],
    ("fabric status codes (caliper.log)", lambda m, r, x: json.dumps(_get(r, "failureClassesLogScan", "fabricStatusCodes"))
     if _get(r, "failureClassesLogScan", "fabricStatusCodes") else ""),
    ("on-chain bytes/event (B, per run)", lambda m, r, x: x["onChainBytesPerEvent"]),
    ("off-chain bytes/event (B, per run)", lambda m, r, x: x["offChainBytesPerEvent"]),
    ("audit time per case (s, per run)", lambda m, r, x: x["auditSPerCase"]),
    ("anchoring delay (s, per run)", lambda m, r, x: x["anchoringDelayS"]),
    ("regime", lambda m, r, x: m.get("regime")),
    ("reference run", lambda m, r, x: "yes" if _get(m, "levels", "reference") else "no"),
    ("min channel write events (n, per run)", lambda m, r, x: m.get("minChannelWriteEvents")),
    ("seed", lambda m, r, x: _get(m, "trace", "params", "seed")),
    # ops runs have no trace but still use workers / the evidence pool / payload -> run.json controls
    ("workers (n)", lambda m, r, x: _first(_get(m, "trace", "params", "workers"), _get(m, "controls", "workers"))),
    ("evidence per case (n)", lambda m, r, x: _first(_get(m, "trace", "params", "evidencePerCase"),
                                                     _get(m, "controls", "evidencePerCase"))),
    ("events per case per round (n)", lambda m, r, x: _get(m, "trace", "params", "eventsPerCasePerRound")),
    ("trace rounds (n)", lambda m, r, x: _get(m, "trace", "params", "rounds")),
    ("transfer weight", lambda m, r, x: _get(m, "trace", "params", "mix", "transfer_weight")),
    ("access weight", lambda m, r, x: _get(m, "trace", "params", "mix", "access_weight")),
    ("dispose fraction", lambda m, r, x: _get(m, "trace", "params", "mix", "dispose_fraction")),
    ("payload (B)", lambda m, r, x: _first(_get(m, "trace", "params", "payloadBytes"),
                                           _get(m, "controls", "payloadBytes"))),
    ("audit cases (n)", lambda m, r, x: _get(m, "controls", "auditCases")),
    ("flush timeout (ms)", lambda m, r, x: _get(m, "controls", "flushTimeoutMs")),
    ("monitor interval (s)", lambda m, r, x: _get(m, "controls", "monitorIntervalS")),
    ("CLI overrides", lambda m, r, x: json.dumps(m.get("overrides"), sort_keys=True) if m.get("overrides") else ""),
    ("run id", lambda m, r, x: m.get("runId")),
    ("trace hash", lambda m, r, x: _get(m, "trace", "hash")),
    ("git commit", lambda m, r, x: _get(m, "provenance", "gitCommit")),
    ("started at (UTC)", lambda m, r, x: m.get("startedAt")),
    ("run wall time (s)", lambda m, r, x: m.get("wallSeconds")),
]


def _ms_to_s(v):
    return v / 1000.0 if isinstance(v, (int, float)) else None


def _first(*vals):
    return next((v for v in vals if v is not None), None)


def _export_order(m):
    """Numeric level order (batch10 < batch25 < batch100), so an Excel line chart does not zig-zag."""
    lv = m.get("levels") or {}
    return (VARIANT_ORDER.index(m["variant"]) if m.get("variant") in VARIANT_ORDER else 9,
            bool(lv.get("reference")), lv.get("batchSize") or 0, lv.get("channels") or 0, lv.get("cases") or 0,
            lv.get("sendRateTps") or 0, m.get("repetition") or 0, m.get("runId") or "")


def export_rounds(exp, results_dir=RESULTS_DIR, path=None, decimal_comma=False):
    """Every complete run of `exp` -> one CSV row per (run, round). Returns the path, or None if no runs."""
    manifests = load_manifests(exp, results_dir)
    if not manifests:
        return None
    manifests.sort(key=_export_order)
    path = path or os.path.join(results_dir, exp, f"{exp}-results.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv_writer(fh, decimal_comma)
        w.writerow([h for h, _ in EXPORT_COLUMNS])
        for m in manifests:
            for r in m["rounds"]:
                x = round_metrics(m, r)
                w.writerow([num(get(m, r, x), None, decimal_comma) for _, get in EXPORT_COLUMNS])
    return path


def saturation_flags(rows):
    """E3a: per variant, first send rate with throughput < 0.9 x rate; latency knee = p95 >= 2 x p95(lowest rate)."""
    flags, summary = {}, {}
    for v in VARIANT_ORDER:
        vr = [r for r in rows if r["variant"] == v and isinstance(r["x"], (int, float))]
        if not vr:
            continue
        sat = next((r["x"] for r in vr if r["metrics"]["throughputTps"][0] is not None
                    and r["metrics"]["throughputTps"][0] < SATURATION_RATIO * r["x"]), None)
        p95_0 = vr[0]["metrics"]["latencyP95S"][0]
        knee = next((r["x"] for r in vr if p95_0 and r["metrics"]["latencyP95S"][0]
                     and r["metrics"]["latencyP95S"][0] >= 2 * p95_0), None)
        for r in vr:
            f = []
            if sat is not None and r["x"] >= sat:
                f.append("saturated")
            if knee is not None and r["x"] >= knee:
                f.append("latency-knee")
            flags[(v, r["x"])] = ",".join(f)
        summary[v] = {"saturationSendRateTps": sat, "latencyKneeSendRateTps": knee}
    return flags, summary


def charts(exp, rows, out_dir, x_label, saturation=None):
    """One PNG per metric, one line per variant, in the thesis figure style (gleipnir.mplstyle +
    variant_style.VARIANT_STYLE — looked up by variant slug, never by the colour cycle)."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("charts skipped: matplotlib not installed (pip install matplotlib); tables were written")
        return
    from variant_style import REFERENCE_LINE, VARIANT_STYLE, e1_reference, saturation_line
    style = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gleipnir.mplstyle")
    with plt.style.context(style):
        for key, header, _ in METRICS:
            if key not in CHART_METRICS:
                continue
            fig, ax = plt.subplots()
            drew = False
            for v in VARIANT_ORDER:
                st = VARIANT_STYLE[v]
                series = [r for r in rows if r["variant"] == v and not r["reference"]
                          and isinstance(r["x"], (int, float)) and r["metrics"][key][0] is not None]
                refs = [r for r in rows if r["variant"] == v and r["reference"] and r["metrics"][key][0] is not None]
                if series:
                    xs = [r["x"] for r in series]
                    ys = [r["metrics"][key][0] for r in series]
                    es = [r["metrics"][key][1] for r in series]
                    ax.errorbar(xs, ys, yerr=es, label=st["label"], color=st["color"], mfc=st["mfc"], mec=st["mec"],
                                marker=st["marker"], ms=st["ms"], mew=1.5, ls=st["ls"], elinewidth=1)
                    drew = True
                for r in refs:  # E1: Standard / Parallel at the same point -> horizontal long-dash reference
                    e1_reference(ax, r["metrics"][key][0], v)
                    drew = True
            if not drew:
                plt.close(fig)
                continue
            if exp == "e3a" and key == "throughputTps":
                xs = sorted({r["x"] for r in rows if isinstance(r["x"], (int, float))})
                ax.plot(xs, xs, color=REFERENCE_LINE["color"], ls=REFERENCE_LINE["ls"], lw=REFERENCE_LINE["lw"],
                        label=REFERENCE_LINE["label"])
                for v, s in (saturation or {}).items():
                    if v in VARIANT_STYLE and s.get("saturationSendRateTps") is not None:
                        saturation_line(ax, s["saturationSendRateTps"], v)
            ax.set_xlabel(x_label)
            ax.set_ylabel(header)
            ax.set_title(f"{exp}: {header}")
            ax.legend()
            path = os.path.join(out_dir, f"{exp}-{key}.png")
            fig.savefig(path)
            plt.close(fig)
            print(f"wrote {path}")


# ---------------------------------------------------------------- baseline suggestions
# Pure functions: they SUGGEST, the author decides (the desktop app writes a value into
# sweeps.yaml only after an explicit confirm). "baseline", never "optimal".

def ramp_rows(manifest):
    """[(send rate, successful throughput, throughput / send rate, p95 ms)] per round of one ramp run."""
    rows = []
    for r in manifest.get("rounds", []):
        rate = r.get("sendRateTps") or 0
        tps = r.get("throughputSuccessfulOnlyTps") or 0.0
        p95 = ((r.get("txlog") or {}).get("latencyMs") or {}).get("p95")
        rows.append((rate, tps, tps / rate if rate else 0.0, p95))
    return rows


def ramp_suggestion(rows):
    """-> (saturation send rate | None, suggested sub-saturation send rate | None).

    Saturation = the first send rate whose throughput < 0.9 x send rate. The suggestion is the
    highest healthy rate at or below RAMP_MARGIN (half) of the saturation point (a margin, so E1/E2
    are not run at the knee); the highest healthy rate if there is none that low; None if nothing is
    healthy. Margin and rule: confirm with D.
    """
    sat = next((rate for rate, _, ratio, _ in rows if ratio < SATURATION_RATIO), None)
    ok = [rate for rate, _, ratio, _ in rows if ratio >= SATURATION_RATIO and (sat is None or rate < sat)]
    margin = [rate for rate in ok if sat is None or rate <= sat * RAMP_MARGIN]
    return sat, (max(margin) if margin else (max(ok) if ok else None))


def suggest_send_rate(manifests, grid=None, expected=VARIANT_ORDER):
    """§4.3 over the ramp runs (the NEWEST per variant). E1/E2/E3b run EVERY variant at one send rate,
    so the suggestion is the minimum of the per-variant suggestions (confirm with D) — and none at all
    until every expected variant has a ramp. The trimmed grid keeps every level up to the first one
    above the highest saturation point."""
    newest = {}
    for m in manifests:   # a re-run ramp (e.g. at another case count) must not mix with the old one
        v = m["variant"]
        if v not in newest or (m.get("startedAt") or "") > (newest[v].get("startedAt") or ""):
            newest[v] = m
    per = {}
    for v in sorted(newest, key=lambda x: VARIANT_ORDER.index(x) if x in VARIANT_ORDER else 9):
        rows = ramp_rows(newest[v])
        sat, sug = ramp_suggestion(rows)
        per[v] = {"saturation": sat, "suggested": sug, "rows": rows}
    if grid is None:   # the send rates the ramp actually ran
        grid = {r.get("sendRateTps") for m in newest.values() for r in m.get("rounds", []) if r.get("sendRateTps")}
    sugs = [p["suggested"] for p in per.values() if p["suggested"] is not None]
    sats = [p["saturation"] for p in per.values() if p["saturation"] is not None]
    notes = []
    missing = [v for v in expected if v not in per]
    if missing:
        notes.append("no ramp yet for: " + ", ".join(missing) + " — no baseline until every variant has one")
        sugs = []
    if len([p for p in per.values() if p["suggested"] is not None]) < len(per):
        notes.append("no healthy send rate for: " + ", ".join(v for v, p in per.items() if p["suggested"] is None))
    grid = sorted(grid)
    if len(sats) < len(per):
        notes.append("some variant never saturated — extend send_rates_tps upward")
        trimmed = grid
    else:
        above = [g for g in grid if g > max(sats)]
        trimmed = [g for g in grid if g <= max(sats)] + above[:1]
        if not above:
            notes.append("no grid level above the highest saturation point — extend send_rates_tps upward")
        if len([g for g in grid if g < min(sats)]) < 2:
            notes.append("fewer than two grid levels below the lowest saturation point — add lower send rates")
    return {"perVariant": per, "suggested": min(sugs) if sugs else None, "trimmedGrid": trimmed, "notes": notes}


def _metric(row, key):
    return row["metrics"][key][0]


def _rel(a, b):
    return abs(b - a) / a if a else None


def suggest_batch_size(rows):
    """§4.1 over aggregate(data_points('e1', ...)): per anchored variant, the SMALLEST level whose
    throughput and on-chain bytes/event both change <= 5 % to the next level while audit time stays
    <= 1.5 x the smallest level's. Both variants must qualify; if they differ, the larger level is
    taken and `disagree` is set."""
    evidence, per = [], {}
    for v in ("anchoring", "parallel-anchored"):
        vr = sorted((r for r in rows if r["variant"] == v and not r["reference"] and isinstance(r["x"], (int, float))),
                    key=lambda r: r["x"])
        if not vr:
            continue
        audit0 = _metric(vr[0], "auditSPerCase")
        per[v] = None
        for i, r in enumerate(vr):
            nxt = vr[i + 1] if i + 1 < len(vr) else None
            tp, by, au = _metric(r, "throughputTps"), _metric(r, "onChainBytesPerEvent"), _metric(r, "auditSPerCase")
            d_tp = _rel(tp, _metric(nxt, "throughputTps")) if nxt and tp is not None and _metric(nxt, "throughputTps") is not None else None
            d_by = _rel(by, _metric(nxt, "onChainBytesPerEvent")) if nxt and by is not None and _metric(nxt, "onChainBytesPerEvent") is not None else None
            au_ratio = au / audit0 if au is not None and audit0 else None
            ok = (d_tp is not None and d_tp <= PLATEAU_REL and d_by is not None and d_by <= PLATEAU_REL
                  and au_ratio is not None and au_ratio <= AUDIT_BOUND)
            if ok and per[v] is None:
                per[v] = r["x"]
            evidence.append({"variant": v, "level": r["x"], "reps": r["n"], "throughputTps": tp,
                             "throughputChangePct": None if d_tp is None else 100 * d_tp, "onChainBytesPerEvent": by,
                             "bytesChangePct": None if d_by is None else 100 * d_by, "auditSPerCase": au,
                             "auditRatio": au_ratio, "qualifies": ok})
    notes = []
    if len(per) < 2:
        notes.append("needs E1 results for BOTH anchored variants")
    missing = [v for v, lv in per.items() if lv is None]
    if missing:
        notes.append("no plateau level for: " + ", ".join(missing) + " — extend batch_sizes or relax the rule (confirm with D)")
    levels = [lv for lv in per.values() if lv is not None]
    suggested = max(levels) if len(levels) == 2 else None
    return {"suggested": suggested, "perVariant": per, "disagree": len(set(levels)) > 1,
            "evidence": evidence, "notes": notes}


def suggest_channels(rows, cores):
    """§4.2 over aggregate(data_points('e2', ...)): walk the parallel levels upwards while healthy
    (throughput >= 0.95 x the previous level, failure rate <= 1 %, summed CPU <= 0.9 x cores x 100 %).
    baseline.channels = the MEDIAN of that range (lower-middle), channels_max = its top."""
    vr = sorted((r for r in rows if r["variant"] == "parallel" and isinstance(r["x"], (int, float))),
                key=lambda r: r["x"])
    budget = HEALTHY_CPU_FRAC * cores * 100 if cores else None
    evidence, healthy, prev_tp, broken = [], [], None, False
    for r in vr:
        tp, fail, cpu = _metric(r, "throughputTps"), _metric(r, "failureRatePct"), _metric(r, "cpuPct")
        reasons = []
        if tp is None or (prev_tp is not None and tp < HEALTHY_TPS_RATIO * prev_tp):
            reasons.append("throughput fell")
        if fail is None or fail > HEALTHY_MAX_FAIL_PCT:
            reasons.append("failure rate > 1 %")
        if cpu is None or budget is None or cpu > budget:
            reasons.append("CPU over budget" if cpu is not None and budget else "no CPU data")
        ok = not reasons and not broken
        if ok:
            healthy.append(r["x"])
        elif not broken:
            broken = True
        evidence.append({"level": r["x"], "reps": r["n"], "throughputTps": tp,
                         "ratioToPrevious": None if tp is None or not prev_tp else tp / prev_tp,
                         "failureRatePct": fail, "cpuPct": cpu, "cpuBudgetPct": budget,
                         "memMb": _metric(r, "memMb"), "healthy": ok, "reason": ", ".join(reasons)})
        prev_tp = tp
    notes = [] if healthy else ["no healthy level — even the lowest channel count fails the rule"]
    if healthy and healthy[-1] == (vr[-1]["x"] if vr else None):
        notes.append("still healthy at the top of channel_counts — the host limit was not reached")
    return {"channels": healthy[(len(healthy) - 1) // 2] if healthy else None,
            "channelsMax": healthy[-1] if healthy else None, "healthy": healthy, "evidence": evidence,
            "notes": notes}


def host_cores(manifests):
    return max((((m.get("provenance") or {}).get("host") or {}).get("cores") or 0 for m in manifests), default=0) or None


# ---------------------------------------------------------------- CLI / app entry

def build(exp, results_dir=RESULTS_DIR, out_dir=None, charts_on=True, decimal_comma=False, export=True):
    """Everything `report.py --exp <exp>` produces. Returns {manifests, csv, outDir, suggestion}.
    Raises ValueError when the experiment has no complete run (the CLI turns that into an exit)."""
    out_dir = out_dir or os.path.join(REPO_ROOT, "docs", "results", exp)
    manifests = load_manifests(exp, results_dir)
    if not manifests:
        raise ValueError(f"no complete manifests under {os.path.join(results_dir, exp)}")
    print(f"{exp}: {len(manifests)} complete run(s)")
    out = {"manifests": len(manifests), "csv": None, "outDir": out_dir, "suggestion": None}
    if export:
        try:
            out["csv"] = export_rounds(exp, results_dir, decimal_comma=decimal_comma)
            print(f"wrote {out['csv']}  (one row per run x round)")
        except OSError as e:   # e.g. open in Excel (write-locked); the tables below can still be written
            print(f"! results CSV not written ({e}) — close it in Excel and re-run")
    if exp == "ramp":
        out["suggestion"] = suggest_send_rate(manifests)
        print(f"  suggested baseline.send_rate_tps = {out['suggestion']['suggested']} (confirm with D)")
    if exp not in EXPS:
        return out
    rows = aggregate(data_points(exp, manifests))
    if exp == "ops":
        for name, ops in (("ops-writes", WRITE_OPS), ("ops-reads", READ_OPS)):
            write_tables(exp, [r for r in rows if r["x"] in ops], out_dir, name, X_LABEL["ops"],
                         per_round=True, decimal_comma=decimal_comma)
        return out
    flags, sat = (saturation_flags(rows) if exp == "e3a" else (None, None))
    write_tables(exp, rows, out_dir, exp, X_LABEL[exp], flags, per_round=exp == "e3a", decimal_comma=decimal_comma)
    if sat:
        for v, s in sat.items():
            print(f"  {v}: saturation at send rate {s['saturationSendRateTps']} tx/s "
                  f"(rule: throughput < {SATURATION_RATIO}x send rate); latency knee at {s['latencyKneeSendRateTps']}")
        with open(os.path.join(out_dir, "e3a-saturation.json"), "w", encoding="utf-8") as fh:
            json.dump(sat, fh, indent=2)
    if exp == "e1":
        out["suggestion"] = suggest_batch_size(rows)
        print(f"  suggested baseline.batch_size = {out['suggestion']['suggested']} (confirm with D)")
    elif exp == "e2":
        out["suggestion"] = suggest_channels(rows, host_cores(manifests))
        print(f"  suggested baseline.channels = {out['suggestion']['channels']}, "
              f"channels_max = {out['suggestion']['channelsMax']} (confirm with D)")
    if charts_on:
        charts(exp, rows, out_dir, X_LABEL[exp], sat)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exp", required=True, choices=EXPORT_EXPS)
    ap.add_argument("--out", help="table output dir (default docs/results/<exp>)")
    ap.add_argument("--results", default=RESULTS_DIR, help="results root (default benchmark/results)")
    ap.add_argument("--no-charts", action="store_true")
    ap.add_argument("--decimal-comma", action="store_true",
                    help="CSV with ';' separators and decimal commas (Excel with e.g. Indonesian regional settings)")
    args = ap.parse_args()
    try:
        build(args.exp, args.results, args.out, not args.no_charts, args.decimal_comma)
    except ValueError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
