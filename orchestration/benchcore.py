#!/usr/bin/env python3
"""GLEIPNIR Bench core — everything the desktop app (benchapp.pyw) does that is not a widget.

  - WSL command builders: the benchmark itself always runs inside the Ubuntu-22.04 distro
    (Caliper's native addons are Linux builds; the runner calls bash + docker), driven through
    `wsl.exe` with an argv list (never a shell string — PowerShell mangles nested quotes).
  - Runner: one subprocess at a time, its stdout pumped line by line into a queue by a daemon
    thread (Tk is not thread-safe, so the UI drains the queue with root.after()).
  - parse_line: turns experiment.py's progress prints into events. experiment.py marks those
    prints; change their format only together with test_benchapp.py.
  - set_sweeps_value: edits benchmark/sweeps.yaml IN PLACE, keeping every comment (the thesis
    cites the file's git blob SHA, so a yaml.safe_dump rewrite is not acceptable).
  - Backup / restore / stack-up scripts: every benchmark run resets the ledger volumes, which
    erases the manual-test custody trails, so the app backs up all gleipnir_* volumes first and
    can put them back. Never `down.sh --wipe`, never `up.sh` on a restore (it would re-create
    channels that the restored ledger already has).

No tkinter import here: it is tested under WSL's Python too (test_benchapp.py).
"""
import json
import os
import queue
import re
import shlex
import subprocess
import threading

import yaml

import experiment as E

REPO, SWEEPS, RESULTS = E.REPO_ROOT, E.R.SWEEPS_PATH, E.RESULTS_DIR
BACKUPS = os.path.join(REPO, "backups")
DISTRO = "Ubuntu-22.04"


# ------------------------------------------------------------------ WSL commands

def wsl_path(p):
    """C:\\a\\b -> /mnt/c/a/b (the repo lives on the Windows drive, WSL sees it under /mnt)."""
    p = str(p).replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", p):
        return f"/mnt/{p[0].lower()}{p[2:]}"
    return os.path.abspath(p).replace("\\", "/") if os.name != "nt" else wsl_path(os.path.abspath(p))


def wsl_argv(script):
    # --exec, NOT `--`: with `--` wsl.exe re-parses the command line through the default shell, which
    # expands $vars / $(...) in `script` before bash -lc ever sees them (found live: backup's gzip loop
    # and stack-up's "${P[@]}" came out empty).
    return ["wsl", "-d", DISTRO, "-u", "root", "--exec", "bash", "-lc",
            f"cd {shlex.quote(wsl_path(REPO))} && {script}"]


def experiment_args(exp, variants=(), reps=None, send_rates=(), batch_size=None, cases=None, controls=None,
                    reuse_network=False, no_monitor=False, no_audit=False):
    """experiment.py argv (after the script name). `controls` = {"--seed": 7, ...} (cell only)."""
    a = ["--exp", exp]
    for v in variants:
        a += ["--variant", v]
    if reps:
        a += ["--reps", str(reps)]
    if send_rates:
        a += ["--send-rate", *[str(r) for r in send_rates]]
    if batch_size:
        a += ["--batch-size", str(batch_size)]
    if cases:
        a += ["--cases", str(cases)]
    for flag, val in (controls or {}).items():
        a += [flag, str(val)]
    a += [f for f, on in (("--reuse-network", reuse_network), ("--no-monitor", no_monitor),
                          ("--no-audit", no_audit)) if on]
    return a


# ANY experiment.py (the app's, or one started from a terminal as `python3 -u experiment.py` inside
# orchestration/ — the README form) but not test_experiment.py. `[e]` keeps pgrep off this command line.
BUSY_CHECK = "if pgrep -f '(^|[ /])[e]xperiment\\.py( |$)' >/dev/null; then echo '@@busy'; exit 3; fi"
APP_MARK = "-X benchapp"   # a no-op CPython -X option that tags the app's OWN runs for Cancel


def experiment_script(args, wipe):
    """wipe=True: a real run (ledger resets allowed; its own session so Cancel reaches Caliper too).
    wipe=False: a preview (--dry-run) — the wipe flag is never set. No BUSY_CHECK in here: this very
    command line names experiment.py, so pgrep would find itself — the app runs BUSY_CHECK as its own
    call (run_quick) or inside backup_script() first."""
    cmd = f"python3 -u {APP_MARK} orchestration/experiment.py " + " ".join(shlex.quote(a) for a in args)
    if not wipe:
        return f"exec {cmd}"
    return f"export GLEIPNIR_ALLOW_LEDGER_WIPE=1 && exec setsid --wait {cmd}"


def cancel_script(force=False):
    """SIGINT (or SIGKILL) to the process group of the APP'S OWN experiment.py (tagged APP_MARK) —
    Caliper and its workers included. Never a terminal campaign, never a backup or restore in flight."""
    sig = "KILL" if force else "INT"
    return (f"for p in $(pgrep -f '[-]X benchapp orchestration/experiment\\.py'); do kill -{sig} -- -$p 2>/dev/null; "
            f"done; true")


_ALPINE = "docker image inspect alpine >/dev/null 2>&1 || docker pull alpine"   # backup-volumes.sh uses it


def stack_up_script():
    """Start the stack the .env names on its EXISTING volumes (profiles as in up.sh) and wait for health."""
    return ("source orchestration/lib.sh && V=$(grep '^VARIANT=' network/compose/.env | cut -d= -f2) && P=() && "
            "case \"$V\" in anchoring) P=(--profile anchoring);; parallel-anchored) P=(--profile parallel-anchored);; "
            "esac && compose \"${P[@]}\" up -d --no-build && wait_healthz 9443 orderer0 && "
            "wait_healthz 9446 peer0-org1 && wait_healthz 9447 peer0-org2 && "
            "{ [ \"$V\" != parallel-anchored ] || wait_healthz 9448 peer0-anchor; } && "
            "curl -sf --retry 30 --retry-delay 2 --retry-all-errors localhost:3000/healthz >/dev/null && "
            "echo \"@@stack-up $V\"")


def backup_script(dst):
    """Stop the stack (volumes kept), copy every gleipnir_* volume + .env to dst, verify the archives."""
    d = shlex.quote(wsl_path(dst))
    return (f"set -euo pipefail; {BUSY_CHECK}; {_ALPINE}; bash orchestration/down.sh; "
            f"bash orchestration/backup-volumes.sh {d}; cp network/compose/.env {d}/compose.env; "
            f"for f in {d}/*.tar.gz; do gzip -t \"$f\"; done; echo \"@@backup-ok\"")


def restore_script(dst):
    """Stop the stack, REPLACE every volume from dst, restore its .env, start that stack again."""
    d = shlex.quote(wsl_path(dst))
    # `&&`, not `;`: set -e does not fire inside an && list, so a failed stack-up must gate the marker.
    return (f"set -euo pipefail; {BUSY_CHECK}; {_ALPINE}; bash orchestration/down.sh; "
            f"bash orchestration/backup-volumes.sh {d} --restore; cp {d}/compose.env network/compose/.env; "
            f"{stack_up_script()} && echo \"@@restore-ok\"")


class Runner:
    """One WSL process at a time; its output goes to `q` as (tag, "line", text) and finally
    (tag, "exit", returncode)."""

    def __init__(self):
        self.q = queue.Queue()
        self.proc = None

    def busy(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self, script, tag):
        if self.busy():
            raise RuntimeError("another benchmark process is still running")
        self.proc = subprocess.Popen(wsl_argv(script), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
                                     bufsize=1, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        threading.Thread(target=self._pump, args=(self.proc, tag), daemon=True).start()

    def _pump(self, proc, tag):
        for line in proc.stdout:
            self.q.put((tag, "line", line.rstrip("\r\n").replace("\x00", "")))   # wsl.exe errors are UTF-16
        self.q.put((tag, "exit", proc.wait()))


def run_quick(script, timeout=120):
    """A short WSL call (cancel, preview helpers); returns (returncode, output)."""
    p = subprocess.run(wsl_argv(script), capture_output=True, text=True, encoding="utf-8", errors="replace",
                       stdin=subprocess.DEVNULL, timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return p.returncode, (p.stdout + p.stderr).replace("\x00", "")


# ------------------------------------------------------------------ progress parsing

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_NUM = r"(?P<{}>-?[\d.]+|None)"
_PATTERNS = [
    ("plan", re.compile(r"^plan (?P<exp>\w+): (?P<runs>\d+) run\(s\), (?P<todo>\d+) to execute")),
    ("run", re.compile(r"^##### \[run (?P<i>\d+)/(?P<n>\d+) \| (?P<pct>\d+) % done \| elapsed (?P<elapsed>.+?) \| "
                       r"ETA (?P<eta>.+?)\] #####")),
    ("runstart", re.compile(r"^===== \[run (?P<i>\d+)/(?P<n>\d+)\] (?P<runId>\S+) \(regime (?P<regime>[\w-]+)\) =====")),
    ("round", re.compile(r"^--- \[run \d+/\d+\] round (?P<j>\d+)/(?P<m>\d+): (?P<label>\S+) \| send rate "
                         r"(?P<sendRate>\S+) tx/s \| (?P<tx>\d+) tx")),
    ("done", re.compile(r"^\s+done (?P<label>\S+): success (?P<succ>\d+) \| failure (?P<fail>\d+) "
                        r"\((?P<failPct>[\d.]+) %\) \| throughput " + _NUM.format("throughput") +
                        r" TPS at send rate " + _NUM.format("sendRate") + r" tx/s \| latency avg " +
                        _NUM.format("latAvg") + r" s \(min " + _NUM.format("latMin") + r" - max " +
                        _NUM.format("latMax") + r"\)(?:, p95 " + _NUM.format("p95") + r" s)?")),
    ("donetext", re.compile(r"^\s+done (?P<label>\S+): (?P<text>.*)$")),
    ("caliper", re.compile(r"\[(?P<label>\S+) Round \d+ Transaction Info\] - Submitted: (?P<submitted>\d+) "
                           r"Succ: (?P<succ>\d+) Fail:\s*(?P<fail>\d+) Unfinished:\s*(?P<unfinished>\d+)")),
    ("csv", re.compile(r"results CSV updated \((?P<i>\d+)/(?P<n>\d+) runs\): (?P<path>.+)$")),
    ("complete", re.compile(r"^(?P<exp>\w+) complete: (?P<runs>\d+) run\(s\) executed in (?P<wall>.+)\.$")),
    ("marker", re.compile(r"^@@(?P<name>\S+)\s*(?P<arg>.*)$")),
    ("warn", re.compile(r"^\s*! (?P<text>.+)$")),
    ("error", re.compile(r"Traceback \(most recent|FATAL:|refusing to|\berror:|Error: ")),
]
_INT = {"runs", "todo", "i", "n", "pct", "j", "m", "tx", "succ", "fail", "submitted", "unfinished"}
_FLOAT = {"sendRate", "failPct", "throughput", "latAvg", "latMin", "latMax", "p95"}


def _f(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def parse_line(line):
    """-> {"kind": ..., fields} for a line the UI reacts to, else None."""
    line = _ANSI.sub("", line)
    for kind, rx in _PATTERNS:
        m = rx.search(line) if kind in ("caliper", "csv", "error") else rx.match(line)
        if not m:
            continue
        if kind == "error":
            return {"kind": kind, "text": line.strip()}
        f = {k: int(v) if k in _INT else _f(v) if k in _FLOAT else v for k, v in m.groupdict().items()}
        return {"kind": "done" if kind == "donetext" else kind, **f}
    return None


# ------------------------------------------------------------------ sweeps.yaml, comment-preserving

# path -> (label with unit, kind). Each value is editable in exactly ONE tab of the app.
FIELDS = {
    "seed": ("seed (trace PRNG — same sequence for all variants)", "int"),
    "workers": ("Caliper workers", "int"),
    "repetitions": ("repetitions r (results = mean ± SD)", "int"),
    "workload.evidence_per_case": ("evidence items per case (n)", "int"),
    "workload.events_per_case_per_round": ("write events per case per round (n)", "int"),
    "workload.rounds": ("trace rounds per run at one send rate (n)", "int"),
    "workload.mix.transfer_weight": ("TransferCustody weight (relative)", "float"),
    "workload.mix.access_weight": ("AccessLog weight (relative)", "float"),
    "workload.mix.dispose_fraction": ("fraction of evidence disposed (0–1)", "float"),
    "workload.payload_bytes": ("evidence file size (B) — off-chain; only its hash goes on-chain", "int"),
    "workload.audit_cases": ("cases reconstructed for audit time (n)", "int"),
    "anchoring.flush_timeout_ms": ("batcher flush timeout (ms, 0 = size-only)", "int"),
    "monitor.interval_s": ("CPU/memory monitor interval (s)", "int"),
    "regimes.steady.min_events_per_channel": ("steady floor (write events per channel) — methodology rule", "int"),
    "baseline.send_rate_tps": ("send rate (tx/s) — from E0", "int"),
    "baseline.batch_size": ("batch size (events) — from E1", "int"),
    "baseline.channels": ("cases (= channels on Parallel variants) — E2 median", "int"),
    "baseline.channels_max": ("max cases / channels — E2 top of healthy range", "int"),
    "regimes.smoke.cases": ("smoke cases (n) — Parallel runs one channel per case", "int"),
    "regimes.smoke.evidence_per_case": ("smoke evidence per case (n)", "int"),
    "regimes.smoke.logs_per_case_min": ("smoke logs per case, min (n)", "int"),
    "regimes.smoke.logs_per_case_max": ("smoke logs per case, max (n)", "int"),
    "regimes.smoke.send_rate_tps": ("smoke send rate (tx/s)", "int"),
    "ramp.events_per_case_per_round": ("ramp events per case per send rate (n)", "int"),
    "send_rates_tps": ("send-rate grid (tx/s) — ramp + E3a", "list"),
    "batch_sizes": ("batch-size grid (events per batch)", "list"),
    "channel_counts": ("channel = case grid (n)", "list"),
    "case_counts": ("case grid (n, trimmed to ≤ max cases)", "list"),
}

_KEY = re.compile(r"^(\s*)([A-Za-z_][\w-]*):(.*)$")
_VAL = re.compile(r"^(\s*)(\{[^}]*\}|\[[^\]]*\]|[^#]*?)(\s*)(#.*)?$")
_TAG = re.compile(r"\[(PLACEHOLDER[^\]]*|set (?:from|by)[^\]]*)\]")


def fmt_value(v):
    if isinstance(v, bool):
        raise TypeError("booleans are not sweeps.yaml values")
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt_value(x) for x in v) + "]"
    raise TypeError(f"unsupported value {v!r}")


def get_path(d, path):
    for k in path.split("."):
        d = d[k]
    return d


def _set_path(d, path, value):
    keys = path.split(".")
    for k in keys[:-1]:
        d = d[k]
    if keys[-1] not in d:
        raise KeyError(path)
    d[keys[-1]] = value


def _locate(lines, path):
    """-> (line index, "block" | "inline") of the line holding `path`'s value."""
    keys, stack = path.split("."), []
    for i, ln in enumerate(lines):
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        m = _KEY.match(ln)
        if not m:
            continue
        indent = len(m.group(1))
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, m.group(2)))
        cur = [k for _, k in stack]
        if cur == keys:
            return i, "block"
        if cur == keys[:-1] and m.group(3).strip().startswith("{"):
            return i, "inline"
    raise KeyError(path)


def set_sweeps_value(text, path, value, tag=None):
    """Return `text` with `path` (e.g. "workload.mix.dispose_fraction") set to `value`, every comment and
    all spacing kept. `tag` replaces a baseline's "[PLACEHOLDER ...]" / "[set from ...]" provenance note.
    Refuses (ValueError) unless the re-parsed result differs from the original at exactly that path."""
    new_val = fmt_value(value)
    lines = text.split("\n")
    i, how = _locate(lines, path)
    m = _KEY.match(lines[i])
    head = f"{m.group(1)}{m.group(2)}:"
    if how == "block":
        v = _VAL.match(m.group(3))
        lead, old, gap, comment = v.group(1), v.group(2), v.group(3), v.group(4) or ""
        if comment:   # keep the comment in its column
            gap = " " * max(1, len(old) + len(gap) - len(new_val))
        lines[i] = f"{head}{lead}{new_val}{gap}{comment}"
    else:
        key = path.split(".")[-1]
        rest, n = re.subn(rf"(?<![\w]){re.escape(key)}:(\s*)([^,}}\s]+)", lambda mm: f"{key}:{mm.group(1)}{new_val}",
                          m.group(3), count=0)
        if n != 1:
            raise ValueError(f"{path}: expected exactly one '{key}:' in the inline map, found {n}")
        lines[i] = f"{head}{rest}"
    if tag:
        if _TAG.search(lines[i]):
            lines[i] = _TAG.sub(f"[{tag}]", lines[i], count=1)
        else:
            lines[i] += f"  [{tag}]" if "#" in lines[i] else f"  # [{tag}]"
    new_text = "\n".join(lines)
    want = yaml.safe_load(text)
    _set_path(want, path, value)
    if yaml.safe_load(new_text) != want:
        raise ValueError(f"{path}: the edit would change more than that value — refusing to write")
    return new_text


def baseline_provenance(text, path):
    """The "[...]" provenance note on a baseline line: "PLACEHOLDER until E1", "set from e1 2026-09-25", ..."""
    lines = text.split("\n")
    i, _ = _locate(lines, path)
    m = _TAG.search(lines[i])
    return m.group(1) if m else ""


def git_dirty(rel="benchmark/sweeps.yaml"):
    try:
        out = subprocess.run(["git", "status", "--porcelain", "--", rel], cwd=REPO, capture_output=True, text=True,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        return bool(out.strip())
    except OSError:
        return False


# ------------------------------------------------------------------ backup bookkeeping
# backups/<ts>/backup.json marks a COMPLETE backup (written only after "@@backup-ok");
# backups/state.json says what the live ledger holds now ("test data" unless a benchmark ran).

def _dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)


def ledger_origin():
    return (E.load_json(os.path.join(BACKUPS, "state.json")) or {}).get("origin", "test data")


def set_ledger_origin(origin):
    _dump(os.path.join(BACKUPS, "state.json"), {"origin": origin})


def mark_backup(dst, reason, created):
    _dump(os.path.join(dst, "backup.json"), {"createdAt": created, "reason": reason,
                                             "variant": E.read_env().get("VARIANT"), "origin": ledger_origin()})


def list_backups():
    """Complete backups, newest first: [{dir, createdAt, reason, variant, origin, sizeMb}]."""
    out = []
    if os.path.isdir(BACKUPS):
        for name in sorted(os.listdir(BACKUPS), reverse=True):
            d = os.path.join(BACKUPS, name)
            meta = E.load_json(os.path.join(d, "backup.json"))
            if meta:
                size = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
                out.append({"dir": d, **meta, "sizeMb": round(size / 1e6, 1)})
    return out
