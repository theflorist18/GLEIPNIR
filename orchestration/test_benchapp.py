#!/usr/bin/env python3
"""No-docker checks for benchcore.py (the desktop app's non-UI half).

  python test_benchapp.py      # exits non-zero on the first failed assert (Windows or WSL)
"""
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import benchcore as B  # noqa: E402
import yaml  # noqa: E402

EDITABLE = [
    "seed", "workers", "repetitions", "batch_sizes", "channel_counts", "send_rates_tps", "case_counts",
    "baseline.send_rate_tps", "baseline.batch_size", "baseline.channels", "baseline.channels_max",
    "workload.evidence_per_case", "workload.events_per_case_per_round", "workload.rounds",
    "workload.mix.transfer_weight", "workload.mix.access_weight", "workload.mix.dispose_fraction",
    "workload.payload_bytes", "workload.audit_cases", "anchoring.flush_timeout_ms", "monitor.interval_s",
    "regimes.smoke.cases", "regimes.smoke.evidence_per_case", "regimes.smoke.logs_per_case_min",
    "regimes.smoke.logs_per_case_max", "regimes.smoke.send_rate_tps", "regimes.steady.min_events_per_channel",
    "ramp.events_per_case_per_round",
]


def comments(text):
    return [ln[ln.index("#"):].strip() for ln in text.split("\n") if "#" in ln]


def other(v):
    """A different value of the same kind and no longer text (so the comment column never clamps)."""
    if isinstance(v, list):
        return v[:-1]
    if isinstance(v, float):
        return round(v / 2, 3)
    return v + 1 if v < 9 else v - 1


def sweeps_setter():
    with open(B.SWEEPS, encoding="utf-8", newline="") as fh:
        text = fh.read()
    base = yaml.safe_load(text)
    for path in EDITABLE:
        old = B.get_path(base, path)
        new = other(old)
        edited = B.set_sweeps_value(text, path, new)
        want = yaml.safe_load(text)
        B._set_path(want, path, new)
        assert yaml.safe_load(edited) == want, path                              # only that value changed
        assert edited.count("\n") == text.count("\n") and "\r" not in edited, path
        assert comments(edited) == comments(text), path                          # every comment kept
        assert B.set_sweeps_value(edited, path, old) == text, path               # round trip: byte-identical
    tagged = B.set_sweeps_value(text, "baseline.batch_size", 100, tag="set from e1 2026-09-25")
    assert B.baseline_provenance(tagged, "baseline.batch_size") == "set from e1 2026-09-25"
    assert B.baseline_provenance(text, "baseline.batch_size").startswith("PLACEHOLDER")
    for bad, exc in (("baseline.nope", KeyError), ("nope", KeyError)):
        try:
            B.set_sweeps_value(text, bad, 1)
        except exc:
            pass
        else:
            raise AssertionError(bad)
    try:
        B.set_sweeps_value(text, "seed", True)
    except TypeError:
        pass
    else:
        raise AssertionError("bool accepted")


LINES = {
    "plan e1: 36 run(s), 36 to execute": {"kind": "plan", "exp": "e1", "runs": 36, "todo": 36},
    "  e1/anchoring/batch10-ch1-cases20/r0             regime=steady    rounds=5  rates=[50, 50, 50, 50, 50] "
    "trace=200evx5": {"kind": "planrow", "runId": "e1/anchoring/batch10-ch1-cases20/r0", "regime": "steady"},
    "ETA: 3.4 h": {"kind": "eta", "eta": "3.4 h"},
    "##### [run 3/12 | 16 % done | elapsed 0:41:10 | ETA 1 day, 3:12:00] #####":
        {"kind": "run", "i": 3, "n": 12, "pct": 16, "elapsed": "0:41:10", "eta": "1 day, 3:12:00"},
    "===== [run 3/12] e1/anchoring/batch25-ch1-cases20/r0 (regime sub-floor) =====":
        {"kind": "runstart", "i": 3, "runId": "e1/anchoring/batch25-ch1-cases20/r0", "regime": "sub-floor"},
    "--- [run 3/12] round 2/5: slice1 | send rate 50 tx/s | 4000 tx | run elapsed 0:03:02":
        {"kind": "round", "j": 2, "m": 5, "label": "slice1", "sendRate": 50.0, "tx": 4000},
    "    done slice1: success 3990 | failure 10 (0.25 %) | throughput 49.8 TPS at send rate 50 tx/s | "
    "latency avg 0.41 s (min 0.1 - max 1.2), p95 0.812 s":
        {"kind": "done", "label": "slice1", "succ": 3990, "fail": 10, "failPct": 0.25, "throughput": 49.8,
         "latMin": 0.1, "latMax": 1.2, "latAvg": 0.41, "p95": 0.812},
    "    done smoke-create: success 20 | failure 0 (0.00 %) | throughput 6.1 TPS at send rate 5 tx/s | "
    "latency avg 0.87 s (min -0.08 - max 1.68)": {"kind": "done", "succ": 20, "latMin": -0.08, "p95": None},
    "    done slice1: summary unavailable (boom)": {"kind": "done", "label": "slice1", "text": "summary unavailable (boom)"},
    "  results CSV updated (3/12 runs): /mnt/c/x/e1-results.csv": {"kind": "csv", "i": 3, "n": 12},
    "e1 complete: 12 run(s) executed in 2:01:00.": {"kind": "complete", "exp": "e1", "runs": 12},
    "  ! 18 run(s) (e1/parallel-anchored/batch10-ch20-cases20/r0 ...): the trace's least-loaded channel gets 938":
        {"kind": "warn"},
    "@@backup-ok": {"kind": "marker", "name": "backup-ok"},
    "FATAL: trace/generate.js failed: nope": {"kind": "error"},
    "+ bash /mnt/c/x/orchestration/reset-network.sh --variant standard --channels 1": None,
}


def parser():
    for line, want in LINES.items():
        got = B.parse_line(line)
        if want is None:
            assert got is None, (line, got)
            continue
        assert got is not None, line
        for k, v in want.items():
            assert got.get(k) == v, (line, k, got.get(k), v)
    # Real Caliper progress lines (ANSI colours included) from a collected E0 run, if present.
    logs = glob.glob(os.path.join(B.RESULTS, "e0", "*", "*", "r0", "rounds", "*", "caliper.log"))
    for log in logs[:2]:
        with open(log, encoding="utf-8", errors="replace") as fh:
            tx = [ln for ln in fh if "Transaction Info]" in ln]
        assert tx and all(B.parse_line(ln)["kind"] == "caliper" for ln in tx), log


def scripts():
    assert B.wsl_path("C:\\theflorist18\\Gleipnir") == "/mnt/c/theflorist18/Gleipnir"
    a = B.experiment_args("cell", variants=["standard", "parallel"], reps=1, send_rates=[25, 50], cases=10,
                          controls={"--seed": 7}, dry_run=True)
    assert a == ["--exp", "cell", "--variant", "standard", "--variant", "parallel", "--reps", "1",
                 "--send-rate", "25", "50", "--cases", "10", "--seed", "7", "--dry-run"], a
    run, preview = B.experiment_script(a, wipe=True), B.experiment_script(a, wipe=False)
    assert "GLEIPNIR_ALLOW_LEDGER_WIPE=1" in run and "setsid" in run and B.APP_MARK in run
    assert "GLEIPNIR_ALLOW_LEDGER_WIPE" not in preview
    assert "pgrep" not in run   # a pgrep here would match this very command line

    # BUSY_CHECK sees ANY experiment.py (app's, or a terminal one run inside orchestration/), not tests;
    # Cancel sees only the app's own (tagged) runs; neither pattern matches its own command line.
    def matches(script, cmdline):
        pat = re.search(r"pgrep -f '([^']+)'", script).group(1)
        return re.search(pat, cmdline) is not None
    runline = "python3 -u -X benchapp orchestration/experiment.py --exp e1"
    for line, busy in ((runline, True), ("python3 -u experiment.py --exp cell --reps 1", True),
                       ("python3 /mnt/c/x/orchestration/experiment.py --exp e2", True),
                       ("python3 -B test_experiment.py", False), ("python3 -B test_benchapp.py", False)):
        assert matches(B.BUSY_CHECK, line) is busy, line
    for s in (B.cancel_script(), B.cancel_script(force=True)):
        assert matches(s, runline) and not matches(s, "python3 -u experiment.py --exp cell"), s
        assert "backup-volumes" not in s   # never interrupt a backup or restore in flight
    for s in (B.BUSY_CHECK, B.cancel_script()):
        assert not matches(s, s), s   # the check's own bash command line never matches itself
    r = B.restore_script(os.path.join(B.BACKUPS, "20260925-120000"))
    assert r.index("down.sh") < r.index("--restore") < r.index("compose.env") < r.index("up -d")
    assert "up.sh" not in r and "--wipe" not in r
    assert r.rstrip().endswith('&& echo "@@restore-ok"'), r   # a failed stack-up must not report success
    assert re.search(r"backup-volumes\.sh '?/mnt/c/.*backups/20260925-120000'? --restore", r), r
    b = B.backup_script(os.path.join(B.BACKUPS, "x"))
    assert b.index("pgrep") < b.index("down.sh") < b.index("backup-volumes.sh") < b.index("gzip -t") < b.index("@@backup-ok")
    assert "--wipe" not in b and "--wipe" not in B.stack_up_script() and "up.sh" not in B.stack_up_script()


def help_coverage():
    """Every input box, tab, column and mode the app shows has hover help (a missing key would crash the
    app at start-up). Needs tkinter, so it is skipped under WSL's Python."""
    try:
        import importlib.util
        import tkinter  # noqa: F401
    except ImportError:
        print("  (help coverage skipped: no tkinter here)")
        return
    import benchhelp as H
    spec = importlib.util.spec_from_file_location("benchapp", os.path.join(os.path.dirname(B.__file__), "benchapp.pyw"))
    app = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app)
    assert set(app.FIELDS) <= set(H.FIELD_HELP), set(app.FIELDS) - set(H.FIELD_HELP)
    assert {path for _f, path, *_ in __import__("experiment").CONTROL_FLAGS} <= set(H.FIELD_HELP)
    assert {c for c, _ in app.LIVE_COLS} <= set(H.COLUMN_HELP), {c for c, _ in app.LIVE_COLS} - set(H.COLUMN_HELP)
    assert set(H.MODE_HELP) == {"e0", "ramp", "e3a", "e3b", "ops"}
    tabs = ["Settings & Baselines", "E0 initial test", "E1 batch size", "E2 channels", "E3 main", "Custom test",
            "History & results"]
    assert all(t in H.TAB_HELP for t in tabs)
    banned = ("optimal", "system channel", "lockb0x")   # CLAUDE.md terminology bans
    for text in [*H.FIELD_HELP.values(), *(d for _, d in H.TAB_HELP.values()), *H.COLUMN_HELP.values(),
                 *H.BUTTON_HELP.values(), *H.MODE_HELP.values(), *H.CUSTOM_HELP.values()]:
        t = text.lower().replace("never 'optimal'", "")   # the one allowed mention: the rule itself
        assert not any(b in t for b in banned), text[:60]


def main():
    sweeps_setter()
    parser()
    scripts()
    help_coverage()
    print("test_benchapp: all checks passed")


if __name__ == "__main__":
    main()
