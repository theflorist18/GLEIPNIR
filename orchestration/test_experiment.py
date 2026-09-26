#!/usr/bin/env python3
"""No-docker checks for experiment.py --exp cell (plan, factor + control validation,
steady-floor labelling) and report.py's per-round CSV export.

  python test_experiment.py      # exits non-zero on the first failed assert
"""
import copy
import csv
import json
import os
import sys
import tempfile
from argparse import Namespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import experiment as E  # noqa: E402
import report as REP  # noqa: E402
import rounds as R  # noqa: E402

SW = R.load_sweeps()
B = SW["baseline"]


def cell_args(exp="cell", **kw):
    return Namespace(**{"exp": exp, "send_rate": None, "batch_size": None, "cases": None, **kw})


def rejected(args, variants=R.VARIANTS):
    try:
        E.cell_levels(args, SW, variants)
    except SystemExit:
        return True
    return False


def main():
    # Omitted factors default to the sweeps.yaml baseline; the set case count is baseline.channels.
    c = E.cell_levels(cell_args(), SW, R.VARIANTS)
    assert c == {"rates": [B["send_rate_tps"]], "batch": B["batch_size"], "cases": B["channels"]}, c

    # One cell across all four variants: each factor lands only where the variant uses it, and the
    # parallel variants get ONE CHANNEL PER CASE.
    c = E.cell_levels(cell_args(send_rate=[75], batch_size=100, cases=10), SW, R.VARIANTS)
    runs = {r["variant"]: r for r in E.plan(SW, "cell", R.VARIANTS, 1, c)}
    lv = {v: r["levels"] for v, r in runs.items()}
    assert lv["standard"] == {"batchSize": None, "channels": 1, "cases": 10, "sendRateTps": 75, "reference": False}
    assert (lv["anchoring"]["batchSize"], lv["anchoring"]["channels"]) == (100, 1)
    assert (lv["parallel"]["batchSize"], lv["parallel"]["channels"]) == (None, 10)
    assert runs["parallel-anchored"]["runId"] == "cell/parallel-anchored/batch100-ch10-cases10-rate75/r0"
    assert runs["standard"]["rates"] == [75] * SW["workload"]["rounds"]
    # Same replayed workload everywhere: the trace params differ only in the channel routing field.
    strip = [{k: v for k, v in r["trace"].items() if k != "channels"} for r in runs.values()]
    assert all(s == strip[0] for s in strip), strip

    # Several send rates -> one round per rate, ascending, deduplicated; the rate is in the path.
    c = E.cell_levels(cell_args(send_rate=[100, 25, 50, 25]), SW, ["standard"])
    (run,) = E.plan(SW, "cell", ["standard"], 1, c)
    assert run["rates"] == [25, 50, 100] and run["trace"]["rounds"] == 3, run
    assert run["runId"].endswith("-rate25-50-100/r0"), run["runId"]
    assert [s["label"] for s in E.build_rounds(SW, run, "t.json")] == ["rate25", "rate50", "rate100"]

    # Rejections: unused factor, non-positive level, cell flag on another exp. --cases is used by
    # every variant, so it is accepted whatever the variant set.
    assert rejected(cell_args(batch_size=10), ["standard", "parallel"])
    assert rejected(cell_args(send_rate=[0]))
    assert rejected(cell_args(cases=0))
    assert not rejected(cell_args(cases=5), ["standard"])
    assert rejected(cell_args(exp="e3a", send_rate=[50]))
    assert rejected(cell_args(exp="e3a", cases=5))
    assert E.cell_levels(cell_args(exp="e3a"), SW, R.VARIANTS) is None

    # Parallel renders its network config into the run dir (nothing committed); the others are fixed files.
    with tempfile.TemporaryDirectory() as d:
        run = {"variant": "parallel", "levels": {"channels": 7}, "dir": d}
        path = E.network_config_path(run)
        assert path == os.path.join(d, "parallel-c7.yaml") and "case-007" in open(path).read()
        run["levels"]["channels"] = B["channels"]
        assert E.network_config_path(run) == os.path.join(d, f"parallel-c{B['channels']}.yaml")
        assert E.network_config_path({**run, "variant": "standard"}) == "networks/coc-main.yaml"

    # Channels == cases in EVERY plan for the parallel variants; 1 for standard/anchoring.
    for exp in ("e0", "ramp", "e1", "e2", "e3a", "e3b", "ops"):
        for r in E.plan(SW, exp, R.VARIANTS, 1):
            want = r["levels"]["cases"] if r["variant"] in R.MULTI_CHANNEL_VARIANTS else 1
            assert r["levels"]["channels"] == want, (exp, r["runId"])
            if r["trace"]:
                assert r["trace"]["channels"] == want and r["trace"]["cases"] == r["levels"]["cases"], r["runId"]

    # Steady floor per channel: one case per parallel channel, so 3 send rates x 200 = 600 < 1000.
    c = E.cell_levels(cell_args(send_rate=[25, 50, 100], cases=9), SW, ["parallel"])
    (run,) = E.plan(SW, "cell", ["parallel"], 1, c)
    assert run["regime"] == "sub-floor" and run["writeEventsPerChannel"] == 3 * 200, run
    c = E.cell_levels(cell_args(cases=5), SW, ["parallel", "standard"])
    assert [r["regime"] for r in E.plan(SW, "cell", ["parallel", "standard"], 1, c)] == ["steady", "steady"]

    # ...and re-checked on the generated trace's ACTUAL per-channel counts (the nominal can pass while
    # a channel falls short: the generator fixes the total per worker, not per case).
    tdoc = {"workers": [[{"caseId": "case-001"}] * 1200, [{"caseId": "case-002"}] * 990]}
    run, doc = {"regime": "steady"}, {"regime": "steady"}
    E.recheck_floor(run, doc, tdoc, SW)
    assert (run["regime"], doc["regime"], doc["minChannelWriteEvents"]) == ("sub-floor", "sub-floor", 990)
    run, doc = {"regime": "steady"}, {"regime": "steady"}
    E.recheck_floor(run, doc, {"workers": [[{"caseId": "case-001"}] * 1000]}, SW)
    assert run["regime"] == "steady" and doc["minChannelWriteEvents"] == 1000

    # Controls: applied to a COPY, recorded, tagged into the run dir; cell only; range-checked.
    ctl = cell_args(seed=7, rounds=2, dispose_fraction=0.25, monitor_interval=None)
    for flag, *_ in E.CONTROL_FLAGS:
        setattr(ctl, E._dest(flag), getattr(ctl, E._dest(flag), None))
    sw, ov = E.apply_controls(ctl, SW)
    assert ov == {"seed": 7, "workload.rounds": 2, "workload.mix.dispose_fraction": 0.25}, ov
    assert sw is not SW and sw["workload"]["rounds"] == 2 and sw["workload"]["mix"]["dispose_fraction"] == 0.25
    assert SW["seed"] != 7, "the loaded sweeps.yaml dict must not be mutated"
    c = E.cell_levels(ctl, sw, ["standard"])
    c["overrides"] = ov
    (run,) = E.plan(sw, "cell", ["standard"], 1, c)
    assert run["trace"]["seed"] == 7 and run["trace"]["rounds"] == 2 and run["overrides"] == ov
    assert run["runId"].split("/")[2].endswith(E.overrides_tag(ov)), run["runId"]
    bad = copy.copy(ctl)
    bad.dispose_fraction = 1.5
    assert rejected_controls(bad)
    campaign = copy.copy(ctl)
    campaign.exp = "e3a"
    assert rejected_controls(campaign)
    many = copy.copy(ctl)
    many.send_rate = [25, 50]
    assert rejected(many, ["standard"])   # --rounds with several send rates

    # CSV export: one row per (run, round), the supervisor's column order, units in headers.
    with tempfile.TemporaryDirectory() as d:
        rdir = os.path.join(d, "cell", "standard", "ch1-cases5-rate50", "r0")
        os.makedirs(rdir)
        with open(os.path.join(rdir, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump({"status": "complete", "experiment": "cell", "variant": "standard", "repetition": 0,
                       "levels": {"channels": 1, "cases": 5}, "rounds": [
                           {"label": "slice0", "sendRateTps": 50, "succ": 99, "fail": 1,
                            "throughputSuccessfulOnlyTps": 49.5,
                            "latency": {"minS": 0.1, "avgS": 0.4, "maxS": 1.2},
                            "txlog": {"latencyMs": {"p95": 900.0}},
                            "resources": {"groups": {"all": {"cpuAvgPctSum": 12.5, "memAvgMbSum": 800}}}}]}, fh)
        path = REP.export_rounds("cell", d)
        with open(path, encoding="utf-8-sig", newline="") as fh:
            header, row = list(csv.reader(fh))
        got = dict(zip(header, row))
        assert header[7:18] == ["send rate (tx/s)", "throughput (TPS)", "latency min (s)", "latency max (s)",
                                "latency avg (s)", "latency p95 (s)", "CPU (%)", "memory (MB)", "success (n)",
                                "failure (n)", "failure rate (%)"], header[7:18]
        assert (got["send rate (tx/s)"], got["latency p95 (s)"], got["failure rate (%)"]) == ("50", "0.9", "1.0"), got

    # Export order is numeric: batch10, batch25, batch100 — not the text order batch10, batch100, batch25.
    ms = [{"variant": "anchoring", "levels": {"batchSize": b, "channels": 1, "cases": 20}, "repetition": 0,
           "runId": f"e1/anchoring/batch{b}-ch1-cases20/r0"} for b in (100, 10, 25)]
    assert [m["levels"]["batchSize"] for m in sorted(ms, key=REP._export_order)] == [10, 25, 100]
    baseline_rules()
    print("test_experiment: all checks passed")


def row(v, x, ref=False, n=3, **met):
    """A synthetic report.aggregate() row: metrics {key: (mean, sd, n)}."""
    return {"variant": v, "x": x, "reference": ref, "n": n,
            "metrics": {k: (met.get(k), 0.0, n) for k, _, _ in REP.METRICS}}


def baseline_rules():
    # Ramp (E0 -> baseline.send_rate_tps): saturation at 150 -> highest healthy rate <= 75.
    ramp = [(10, 10, 1.0, 1), (25, 25, 1.0, 1), (50, 50, 1.0, 1), (75, 74, .99, 1), (100, 95, .95, 1),
            (150, 120, .8, 1), (200, 130, .65, 1)]
    assert REP.ramp_suggestion(ramp) == (150, 75)
    assert REP.ramp_suggestion([(10, 10, 1.0, 1), (25, 25, 1.0, 1)]) == (None, 25)       # never saturated
    assert REP.ramp_suggestion([(10, 5, .5, 1)]) == (10, None)                           # saturated at once

    def ramp_manifest(v, pts):
        return {"variant": v, "rounds": [{"sendRateTps": r, "throughputSuccessfulOnlyTps": t} for r, t in pts]}
    grid = [10, 25, 50, 75, 100, 150, 200]
    two = ("standard", "parallel")
    s = REP.suggest_send_rate([ramp_manifest("standard", [(r, r if r < 150 else r * .7) for r in grid]),
                               ramp_manifest("parallel", [(r, r if r < 100 else r * .7) for r in grid])], grid, two)
    assert s["suggested"] == 50 and s["trimmedGrid"] == [10, 25, 50, 75, 100, 150, 200], s   # min over variants
    s = REP.suggest_send_rate([ramp_manifest("standard", [(r, r) for r in grid])], grid, ("standard",))
    assert s["suggested"] == 200 and any("never saturated" in n for n in s["notes"]), s
    # every variant must have a ramp before there is a baseline; the NEWEST ramp per variant counts
    s = REP.suggest_send_rate([ramp_manifest("standard", [(r, r) for r in grid])], grid)
    assert s["suggested"] is None and any("no ramp yet" in n for n in s["notes"]), s
    old = dict(ramp_manifest("standard", [(r, r if r < 25 else r * .5) for r in grid]), startedAt="2026-09-01")
    new = dict(ramp_manifest("standard", [(r, r if r < 150 else r * .7) for r in grid]), startedAt="2026-09-25")
    s = REP.suggest_send_rate([new, old], grid, ("standard",))
    assert s["perVariant"]["standard"]["saturation"] == 150, s
    s = REP.suggest_send_rate([ramp_manifest("standard", [(r, r if r < 200 else r * .7) for r in grid])], grid,
                              ("standard",))
    assert any("no grid level above" in n for n in s["notes"]), s   # saturated only at the top level

    # E1 -> baseline.batch_size: smallest plateau level per variant; the larger of the two when they differ.
    def e1(v, pts):   # (batch, tps, bytes/event, audit s)
        return [row(v, b, throughputTps=t, onChainBytesPerEvent=by, auditSPerCase=a) for b, t, by, a in pts]
    rows = (e1("anchoring", [(10, 40, 400, .010), (25, 48, 200, .011), (50, 49, 195, .012), (100, 49.5, 190, .013),
                             (200, 49.6, 188, .02)])
            + e1("parallel-anchored", [(10, 40, 800, .010), (25, 45, 400, .011), (50, 47, 250, .012),
                                       (100, 48, 245, .013), (200, 48.2, 240, .014)])
            + [row("standard", None, ref=True, throughputTps=50)])
    b = REP.suggest_batch_size(rows)
    assert b["perVariant"] == {"anchoring": 25, "parallel-anchored": 50} and b["suggested"] == 50 and b["disagree"], b
    rows = e1("anchoring", [(10, 40, 400, .010), (25, 48, 200, .02), (50, 49, 195, .021), (100, 49.5, 190, .022)]) \
        + e1("parallel-anchored", [(10, 49, 100, .010), (25, 49.2, 99, .011), (50, 49.3, 98, .012)])
    b = REP.suggest_batch_size(rows)
    assert b["perVariant"]["anchoring"] is None and b["suggested"] is None, b   # audit 2x the smallest: never qualifies

    # E2 -> baseline.channels (MEDIAN of the healthy range) and channels_max (its top).
    def e2(pts):   # (channels, tps, fail %, cpu %)
        return [row("parallel", c, throughputTps=t, failureRatePct=f, cpuPct=cpu, memMb=1000) for c, t, f, cpu in pts]
    c = REP.suggest_channels(e2([(5, 50, 0, 100), (10, 50, 0, 200), (20, 49, .1, 400), (30, 48.5, .2, 600),
                                 (40, 40, .3, 800), (50, 45, .1, 900)]), cores=32)
    assert (c["healthy"], c["channels"], c["channelsMax"]) == ([5, 10, 20, 30], 10, 30), c   # 40 fell >5 %
    c = REP.suggest_channels(e2([(5, 50, 0, 100), (10, 50, 0, 200), (20, 50, 2.0, 300), (30, 50, 0, 400)]), cores=32)
    assert (c["healthy"], c["channels"]) == ([5, 10], 5), c                                   # failures > 1 % at 20
    c = REP.suggest_channels(e2([(5, 50, 0, 100), (10, 50, 0, 3000)]), cores=32)
    assert c["healthy"] == [5], c                                                              # 3000 % > 0.9 x 3200 %
    c = REP.suggest_channels(e2([(5, 50, 5.0, 100)]), cores=32)
    assert c["channels"] is None and c["notes"], c


def rejected_controls(args):
    try:
        E.apply_controls(args, SW)
    except SystemExit:
        return True
    return False


if __name__ == "__main__":
    main()
