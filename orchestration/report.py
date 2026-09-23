#!/usr/bin/env python3
"""GLEIPNIR report — tables (CSV + Markdown, UNITS in headers, mean ± SD over
repetitions) and optional matplotlib charts per experiment (brief 2026-09-22 §9).

  report.py --exp e1|e2|e3a|e3b|ops [--out docs/results/<exp>] [--results <dir>]

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
EXPS = ["e1", "e2", "e3a", "e3b", "ops"]
VARIANT_ORDER = ["standard", "anchoring", "parallel", "parallel-anchored"]
SATURATION_RATIO = 0.9
WRITE_OPS = ("create", "transfer", "access", "dispose")
READ_OPS = ("read-evidence", "read-trail", "verify-event")
X_LABEL = {"e1": "batch size", "e2": "channels", "e3a": "send rate (tx/s)", "e3b": "cases", "ops": "operation"}

# (key, header with unit, decimals)
METRICS = [
    ("throughputTps", "throughput (TPS)", 1),
    ("latencyAvgS", "latency avg (s)", 3),
    ("latencyMinS", "latency min (s)", 3),
    ("latencyMaxS", "latency max (s)", 3),
    ("latencyP95S", "latency p95 (s)", 3),
    ("succ", "success (n)", 0),
    ("fail", "failure (n)", 0),
    ("failureRatePct", "failure rate (%)", 2),
    ("cpuPct", "CPU (%, sum of container avgs)", 1),
    ("memMb", "memory (MB, sum of container avgs)", 0),
    ("onChainBytesPerEvent", "on-chain bytes/event (B)", 1),
    ("offChainBytesPerEvent", "off-chain bytes/event (B)", 1),
    ("auditSPerCase", "audit time per case (s)", 3),
    ("anchoringDelayS", "anchoring delay (s)", 3),
]
CHART_METRICS = [k for k, _, _ in METRICS if k not in ("latencyMinS", "latencyMaxS", "succ", "fail")]


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


def write_tables(exp, rows, out_dir, name, x_label, flags=None, per_round=False):
    os.makedirs(out_dir, exist_ok=True)
    headers = ["variant", x_label, "reps (n)"] + [h for _, h, _ in METRICS] + (["flag"] if flags else [])
    csv_path, md_path = os.path.join(out_dir, f"{name}.csv"), os.path.join(out_dir, f"{name}.md")
    with open(csv_path, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(headers + [f"{h} SD" for _, h, _ in METRICS])
        for r in rows:
            base = [r["variant"] + (" (reference)" if r["reference"] else ""), x_cell(r), r["n"]]
            means = [("" if r["metrics"][k][0] is None else round(r["metrics"][k][0], d)) for k, _, d in METRICS]
            sds = [("" if r["metrics"][k][0] is None else round(r["metrics"][k][1], d)) for k, _, d in METRICS]
            w.writerow(base + means + ([flags.get((r["variant"], r["x"]), "")] if flags else []) + sds)
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(f"# {exp} — {name}\n\nmean ± SD over repetitions; throughput is successful-only; "
                 "latency avg is Caliper's, p95 from per-transaction logs (mean of per-round p95).\n")
        if per_round:
            fh.write("\nOne row per round. "
                     + ", ".join(h for k, h, _ in METRICS if k in RUN_LEVEL_METRICS)
                     + " are measured once per RUN, so the same value repeats on every row of a run — "
                       "they are not per-row measurements.\n")
        fh.write("\n| " + " | ".join(headers) + " |\n|" + "---|" * len(headers) + "\n")
        for r in rows:
            cells = [r["variant"] + (" (reference)" if r["reference"] else ""), x_cell(r), str(r["n"])]
            cells += [fmt(r["metrics"][k], d) for k, _, d in METRICS]
            if flags:
                cells.append(flags.get((r["variant"], r["x"]), ""))
            fh.write("| " + " | ".join(cells) + " |\n")
    print(f"wrote {csv_path}\nwrote {md_path}")


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
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("charts skipped: matplotlib not installed (pip install matplotlib); tables were written")
        return
    for key, header, _ in METRICS:
        if key not in CHART_METRICS:
            continue
        fig, ax = plt.subplots(figsize=(6.4, 4.2))
        drew = False
        for v in VARIANT_ORDER:
            series = [r for r in rows if r["variant"] == v and not r["reference"]
                      and isinstance(r["x"], (int, float)) and r["metrics"][key][0] is not None]
            refs = [r for r in rows if r["variant"] == v and r["reference"] and r["metrics"][key][0] is not None]
            if series:
                xs = [r["x"] for r in series]
                ys = [r["metrics"][key][0] for r in series]
                es = [r["metrics"][key][1] for r in series]
                ax.errorbar(xs, ys, yerr=es, marker="o", capsize=3, label=v)
                drew = True
            for r in refs:  # E1: Standard / Parallel at the same point -> horizontal dashed reference
                ax.axhline(r["metrics"][key][0], linestyle="--", linewidth=1, label=f"{v} (reference)")
                drew = True
        if not drew:
            plt.close(fig)
            continue
        if exp == "e3a" and key == "throughputTps":
            xs = sorted({r["x"] for r in rows if isinstance(r["x"], (int, float))})
            ax.plot(xs, xs, linestyle=":", color="grey", label="y = x (send rate)")
            for v, s in (saturation or {}).items():
                if s.get("saturationSendRateTps") is not None:
                    ax.axvline(s["saturationSendRateTps"], linestyle=":", linewidth=0.8)
        ax.set_xlabel(x_label)
        ax.set_ylabel(header)
        ax.set_title(f"{exp}: {header}")
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=8)
        path = os.path.join(out_dir, f"{exp}-{key}.png")
        fig.tight_layout()
        fig.savefig(path, dpi=130)
        plt.close(fig)
        print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exp", required=True, choices=EXPS)
    ap.add_argument("--out", help="output dir (default docs/results/<exp>)")
    ap.add_argument("--results", default=RESULTS_DIR, help="results root (default benchmark/results)")
    ap.add_argument("--no-charts", action="store_true")
    args = ap.parse_args()
    out_dir = args.out or os.path.join(REPO_ROOT, "docs", "results", args.exp)
    manifests = load_manifests(args.exp, args.results)
    if not manifests:
        sys.exit(f"no complete manifests under {os.path.join(args.results, args.exp)}")
    print(f"{args.exp}: {len(manifests)} complete run(s)")
    rows = aggregate(data_points(args.exp, manifests))
    if args.exp == "ops":
        for name, ops in (("ops-writes", WRITE_OPS), ("ops-reads", READ_OPS)):
            write_tables(args.exp, [r for r in rows if r["x"] in ops], out_dir, name, X_LABEL["ops"],
                         per_round=True)
        return
    flags, sat = (saturation_flags(rows) if args.exp == "e3a" else (None, None))
    write_tables(args.exp, rows, out_dir, args.exp, X_LABEL[args.exp], flags, per_round=args.exp == "e3a")
    if sat:
        for v, s in sat.items():
            print(f"  {v}: saturation at send rate {s['saturationSendRateTps']} tx/s "
                  f"(rule: throughput < {SATURATION_RATIO}x send rate); latency knee at {s['latencyKneeSendRateTps']}")
        with open(os.path.join(out_dir, "e3a-saturation.json"), "w", encoding="utf-8") as fh:
            json.dump(sat, fh, indent=2)
    if not args.no_charts:
        charts(args.exp, rows, out_dir, X_LABEL[args.exp], sat)


if __name__ == "__main__":
    main()
