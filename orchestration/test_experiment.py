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
    for exp in ("e0", "ramp", "e1", "e2", "e3a", "e3b", "e3c", "ops", "sens"):
        for r in E.plan(SW, exp, R.VARIANTS, 1):
            want = r["levels"]["cases"] if r["variant"] in R.MULTI_CHANNEL_VARIANTS else 1
            assert r["levels"]["channels"] == want, (exp, r["runId"])
            if r["trace"]:
                assert r["trace"]["channels"] == want and r["trace"]["cases"] == r["levels"]["cases"], r["runId"]

    # Steady floor per channel: one case per parallel channel, so 3 send rates x 224 = 672 < 1000.
    c = E.cell_levels(cell_args(send_rate=[25, 50, 100], cases=9), SW, ["parallel"])
    (run,) = E.plan(SW, "cell", ["parallel"], 1, c)
    assert run["regime"] == "sub-floor" and run["writeEventsPerChannel"] == 3 * SW["workload"]["events_per_case_per_round"], run
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

    # CSV export: one row per (run, round), the result-table column order, units in headers.
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
    new_plans()
    e3a_climb()
    print("test_experiment: all checks passed")


def new_plans():
    e, ws = SW["e3a"], SW["workers"]
    # E3a base ladder: one round per rate, ascending, rounds of e3a.events_per_case_per_round, rate-labelled.
    runs = E.plan(SW, "e3a", R.VARIANTS, 3)
    assert len(runs) == 12 and all(r["rates"] == sorted(e["send_rates_tps"]) for r in runs)
    assert runs[0]["runId"] == f"e3a/standard/ch1-cases{B['channels']}/r0", runs[0]["runId"]
    assert runs[0]["trace"]["events_per_case_per_round"] == e["events_per_case_per_round"]
    assert runs[0]["trace"]["rounds"] == len(e["send_rates_tps"]) and runs[0]["regime"] == "steady"
    assert [s["label"] for s in E.build_rounds(runs[0]["sweeps"], runs[0], "t.json")][:2] == ["rate100", "rate150"]
    # E3a runs with its own Caliper worker count; the other experiments keep `workers`.
    assert {r["sweeps"]["workers"] for r in runs} == {r["trace"]["workers"] for r in runs} == {e["workers"]} != {ws}
    assert E.plan(SW, "e1", ["standard"], 1)[0]["trace"]["workers"] == ws

    # E3c: the per-case send rate is fixed, so the total grows with the cases; 20 cases is sens/baseline.
    runs = E.plan(SW, "e3c", R.VARIANTS, 3)
    per_case = SW["e3c"]["send_rate_per_case_tps"]
    assert len(runs) == 4 * 3 * len(SW["e3c"]["case_counts"]) and B["channels"] not in SW["e3c"]["case_counts"]
    assert all(r["rates"] == [r["levels"]["cases"] * per_case] * SW["workload"]["rounds"] for r in runs)
    assert {r["levels"]["cases"]: r["rates"][0] for r in runs}[50] == 250
    assert {r["regime"] for r in runs} == {"steady"}

    # sens: repetition by repetition; the idle cell only on the anchored variants; each run carries
    # its own effective constants, the cell's overrides and the cell name in its dir.
    runs = E.plan(SW, "sens", R.VARIANTS, 3)
    assert len(runs) == 3 * (4 + 4 + 2), len(runs)
    assert [r["rep"] for r in runs] == sorted(r["rep"] for r in runs), "rep-major order"
    by = {(r["cell"], r["variant"], r["rep"]): r for r in runs}
    assert ("idle-5s", "standard", 0) not in by and ("idle-5s", "parallel-anchored", 2) in by
    ea, idle, base = by[("endorse-all", "parallel", 1)], by[("idle-5s", "anchoring", 0)], by[("baseline", "standard", 0)]
    assert ea["sweeps"]["endorsement"]["policy"] == "all" and ea["overrides"] == {"endorsement.policy": "all"}
    assert idle["sweeps"]["anchoring"]["idle_timeout_ms"] == 5000 and idle["sweeps"]["endorsement"]["policy"] == "any"
    assert base["sweeps"]["anchoring"]["idle_timeout_ms"] == 0 and base["overrides"] == {}
    assert idle["runId"] == f"sens/anchoring/batch{B['batch_size']}-ch1-cases{B['channels']}-idle-5s/r0", idle["runId"]
    assert SW["endorsement"]["policy"] == "any" and SW["anchoring"]["idle_timeout_ms"] == 0, "sweeps.yaml unchanged"
    assert all(r["rates"] == [B["send_rate_tps"]] * SW["workload"]["rounds"] for r in runs)

    # A cell may move the point itself: its levels come from its own copy of the constants.
    moved = copy.deepcopy(SW)
    moved["sensitivity"] = {"fast": {"baseline.send_rate_tps": 150, "workload.rounds": 2}}
    (run,) = E.plan(moved, "sens", ["standard"], 1)
    assert run["rates"] == [150, 150] and run["trace"]["rounds"] == 2 and run["cell"] == "fast", run["rates"]

    # Overrides: an unknown sweeps.yaml path or an unknown endorsement policy stops the plan.
    for bad in ({"anchoring.idle_timeout": 1}, {"endorsement.policy": "majority"}, {"no.such.path": 1}):
        try:
            E.with_overrides(SW, bad)
            raise AssertionError(f"accepted {bad}")
        except SystemExit:
            pass
    # The two new cell controls.
    ctl = cell_args(endorsement="all", idle_timeout_ms=5000)
    for flag, *_ in E.CONTROL_FLAGS:
        setattr(ctl, E._dest(flag), getattr(ctl, E._dest(flag), None))
    sw, ov = E.apply_controls(ctl, SW)
    assert ov == {"anchoring.idle_timeout_ms": 5000, "endorsement.policy": "all"}, ov
    assert E.fit_events_up(20, 3662, ws) == 3662 and E.fit_events_up(5, 3, ws) == 4


def e3a_manifest(v, rates, rep, ratio=lambda r: 1.0, gen=lambda r: 1.0, events=None, tag=""):
    """A complete e3a run: finalized throughput and measured send rate as ratios of each round's rate."""
    lv = f"batch{B['batch_size']}-" if v in R.ANCHORED_VARIANTS else ""
    rate_dir = "" if rates == sorted(SW["e3a"]["send_rates_tps"]) else "-rate" + "-".join(map(str, rates))
    return {"variant": v, "repetition": rep, "runId": f"e3a/{v}/{lv}ch1-cases{B['channels']}{rate_dir}{tag}/r{rep}",
            "levels": {"sendRateTps": rates[0] if len(rates) == 1 else None},
            "trace": {"params": {"eventsPerCasePerRound": events or SW["e3a"]["events_per_case_per_round"]}},
            "rounds": [{"index": i, "sendRateTps": r, "throughputSuccessfulOnlyTps": r,
                        "txlog": {"sendRateMeasuredTps": r * gen(r)}, "finalization": {"finalizedTps": r * ratio(r)}}
                       for i, r in enumerate(rates)]}


def e3a_climb():
    base, reps = sorted(SW["e3a"]["send_rates_tps"]), 3
    ladder, ws, cases = sorted(SW["e3a"]["climb"]["send_rates_tps"]), SW["e3a"]["workers"], B["channels"]
    ev = E.fit_events_up(cases, -(-SW["e3a"]["climb"]["min_send_s"] * ladder[-1] // cases), ws)

    def step(ms, variants=("standard",)):
        return E.e3a_next_runs(SW, list(variants), reps, ms)

    def climbed(v, **kw):
        return [e3a_manifest(v, ladder, r, events=ev, **kw) for r in range(reps)]

    # After the base ladder every variant climbs the same rates to the common top, each round
    # sized for >= min_send_s at the top rate, with e3a's own worker count.
    ms = [e3a_manifest("standard", base, r) for r in range(reps)]
    runs, out = step(ms)
    assert [r["rates"] for r in runs] == [ladder] * reps, [r["rates"] for r in runs]
    assert ladder == [1250, 1500, 2000, 2500] and ev == 3752 and runs[0]["trace"]["rounds"] == 4
    assert runs[0]["trace"]["events_per_case_per_round"] == ev and runs[0]["trace"]["workers"] == ws == 16
    assert runs[0]["runId"] == "e3a/standard/ch1-cases20-rate1250-1500-2000-2500/r0", runs[0]["runId"]
    assert out["standard"]["keptUpTo"] == 1000 and out["standard"]["saturatedAt"] is None
    # ...and a variant that kept up at the top, too, is done.
    runs, out = step(ms + climbed("standard"))
    assert runs == [] and out["standard"]["keptUpTo"] == 2500 and "common top" in out["standard"]["decision"], out

    # A partly finished step (one rep missing) is planned again before anything is judged.
    part = ms + [e3a_manifest("standard", ladder, r, events=ev) for r in (0, 1)]
    runs, out = step(part)
    assert [(r["rates"], r["rep"]) for r in runs] == [(ladder, 0), (ladder, 1), (ladder, 2)], runs
    assert "missing repetitions" in out["standard"]["decision"]

    # Saturated at 800 (finalized < 0.9 x) on the base ladder: it still climbs to the common top,
    # then gets ONE run at 700, halfway back, with the saturated run's round size.
    def half(x):
        return 0.5 if x >= 800 else 1.0
    sat = [e3a_manifest("parallel", base, r, ratio=half) for r in range(reps)]
    runs, out = step(sat, ("parallel",))
    assert [r["rates"] for r in runs] == [ladder] * reps and "-midpoint" not in runs[0]["runId"], runs
    sat += climbed("parallel", ratio=half)
    runs, out = step(sat, ("parallel",))
    assert [r["rates"] for r in runs] == [[700]] * reps and runs[0]["runId"].endswith("-rate700-midpoint/r0"), runs
    assert runs[0]["trace"]["events_per_case_per_round"] == SW["e3a"]["events_per_case_per_round"]
    assert [s["label"] for s in E.build_rounds(runs[0]["sweeps"], runs[0], "t.json")] == ["rate700"]
    assert (out["parallel"]["saturatedAt"], out["parallel"]["keptUpTo"]) == (800, 600)
    # ...after which the variant is done, whatever the midpoint showed.
    done = sat + [e3a_manifest("parallel", [700], r, tag="-midpoint") for r in range(reps)]
    runs, out = step(done, ("parallel",))
    assert runs == [] and out["parallel"]["saturatedAt"] == 800 and out["parallel"]["keptUpTo"] == 700, out

    # Saturated only on the climb, at 2000: the halfway run (1750) has the climb run's round size.
    runs, out = step([e3a_manifest("anchoring", base, r) for r in range(reps)]
                     + climbed("anchoring", ratio=lambda x: 0.5 if x >= 2000 else 1.0), ("anchoring",))
    assert [r["rates"] for r in runs] == [[1750]] * reps and runs[0]["trace"]["events_per_case_per_round"] == ev, runs

    # The load generator tops out (measured < 0.95 x configured): never judged as saturation; the
    # climb still runs, and no halfway run follows.
    lim = {"ratio": lambda x: 0.5 if x >= 600 else 1.0, "gen": lambda x: 0.9 if x >= 600 else 1.0}
    gen = [e3a_manifest("anchoring", base, r, **lim) for r in range(reps)]
    runs, out = step(gen, ("anchoring",))
    assert [r["rates"] for r in runs] == [ladder] * reps and out["anchoring"]["generatorLimitAt"] == 600, runs
    runs, out = step(gen + climbed("anchoring", **lim), ("anchoring",))
    assert runs == [] and out["anchoring"]["generatorLimitAt"] == 600 and out["anchoring"]["saturatedAt"] is None

    # Saturated at the lowest rate: it climbs as well, but nothing kept up, so no halfway run.
    low = [e3a_manifest("standard", base, r, ratio=lambda x: 0.5) for r in range(reps)]
    runs, out = step(low)
    assert [r["rates"] for r in runs] == [ladder] * reps, runs
    runs, out = step(low + climbed("standard", ratio=lambda x: 0.5))
    assert runs == [] and out["standard"]["saturatedAt"] == base[0] and out["standard"]["keptUpTo"] is None

    # Variants climb independently in one step.
    runs, out = step(ms + sat, ("standard", "parallel"))
    assert {(r["variant"], tuple(r["rates"])) for r in runs} == {("standard", tuple(ladder)), ("parallel", (700,))}

    # Rounds whose writes succeeded but finalized nothing (a lost batch link) stop the climb.
    lost = [dict(m, rounds=[dict(r, finalization=None, txlog={**r["txlog"], "perOp": {"ACCESS": {"ok": 9}}})
                            for r in m["rounds"]]) for m in ms]
    assert exits(lambda: step(lost))

    # Pre-flight: a complete base ladder previews the climb's next step instead of "nothing to do";
    # --reuse-network is refused; so is a fresh start over an earlier invocation's climb runs.
    nxt = E.e3a_preflight(SW, ["standard"], reps, [], True, False, ms)
    assert [r["rates"] for r in nxt] == [ladder] * reps
    assert E.e3a_preflight(SW, ["standard"], reps, ["base run"], True, False, ms) == []
    assert exits(lambda: E.e3a_preflight(SW, ["standard"], reps, [], True, True, ms))
    climbed = ms + [e3a_manifest("standard", ladder, r, events=3662) for r in range(reps)]
    assert exits(lambda: E.e3a_preflight(SW, ["standard"], reps, ["base run"], False, False, climbed))
    assert E.e3a_preflight(SW, ["parallel"], reps, ["base run"], False, False, climbed) == []   # other variant


def exits(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


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
