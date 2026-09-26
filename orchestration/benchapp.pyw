#! python3.11
"""GLEIPNIR Bench — the desktop app for the thesis experiments (double-click, or `pyw -3.11 benchapp.pyw`).

Tabs: Settings & Baselines · E0 initial test · E1 batch size · E2 channels · E3 main · Custom test ·
History & results. Every experiment value is an input box bound to benchmark/sweeps.yaml (saved in
place, comments kept — the thesis cites that file's git SHA); the E-tabs Preview / Run / Resume the
matching `experiment.py --exp` plan inside WSL, with live progress and per-round results in the
supervisor's table columns; History lists every run and exports CSV for Excel (+ tables and charts).

Every run resets the ledger, which erases the manual-test custody trails — so a run first backs up
all gleipnir_* volumes (backups/<timestamp>/), and [Restore my test data] puts them back. Baselines
(send rate from E0, batch size from E1, case count from E2) are SUGGESTED from the results by the
methodology rules and written only when you click "Use as baseline" ("baseline", never "optimal").
All logic that is not a widget lives in benchcore.py (tested by test_benchapp.py).
"""
import datetime
import glob
import os
import queue
import re
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

import benchcore as BC
import benchhelp as H
import benchtheme as T
import experiment as E
import report as REP
import rounds as R
import yaml

FIELDS = BC.FIELDS
WORKLOAD = ["seed", "workers", "repetitions", "workload.evidence_per_case", "workload.events_per_case_per_round",
            "workload.rounds", "workload.mix.transfer_weight", "workload.mix.access_weight",
            "workload.mix.dispose_fraction", "workload.payload_bytes", "workload.audit_cases",
            "anchoring.flush_timeout_ms", "monitor.interval_s", "regimes.steady.min_events_per_channel"]
BASELINES = ["baseline.send_rate_tps", "baseline.batch_size", "baseline.channels", "baseline.channels_max"]
# The last two are measured once per RUN (ledger growth over its rounds): filled in when the run is
# collected, the same value on each of its round rows — as in the CSV export.
LIVE_COLS = [("run", 230), ("round", 80), ("send rate (tx/s)", 90), ("throughput (TPS)", 95),
             ("latency min (s)", 85), ("latency max (s)", 85), ("latency avg (s)", 85), ("latency p95 (s)", 85),
             ("CPU (%)", 65), ("memory (MB)", 80), ("success (n)", 70), ("failure (n)", 65), ("failure rate (%)", 90),
             ("on-chain (B/event)", 110), ("off-chain (B/event)", 110)]
ROUND_KEYS = ["sendRateTps", "throughputTps", "latencyMinS", "latencyMaxS", "latencyAvgS", "latencyP95S",
              "cpuPct", "memMb", "succ", "fail", "failureRatePct", "onChainBytesPerEvent", "offChainBytesPerEvent"]
LOG_DIR = os.path.join(BC.RESULTS, "benchapp-logs")
ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
_IMAGES = {}  # Tk drops a PhotoImage nobody references — every image lives here


def fmt(v):
    if v is None or v == "":
        return ""
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".") if abs(v) < 1e6 else f"{v:.0f}"
    return str(v)


def show_value(v):
    return ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)


def parse_value(kind, s):
    s = s.strip()
    if kind == "int":
        return int(s)
    if kind == "float":
        return float(s)
    return [int(x) for x in re.split(r"[,\s]+", s.strip("[] ")) if x]


def num(var, kind=int):
    s = var.get().strip()
    return kind(s) if s else None


def today():
    return datetime.date.today().isoformat()


class Tip:
    """Hover help: a note next to the pointer after the pointer rests 300 ms on a widget (or a heading)."""

    def __init__(self, widget, text=None):
        self.widget, self.text, self.win, self.pending = widget, text, None, None
        if text:
            widget.bind("<Enter>", lambda e: self.later(self.text, e.x_root, e.y_root), add="+")
            widget.bind("<Leave>", lambda e: self.hide(), add="+")

    def later(self, text, x, y):
        self.hide()
        self.pending = self.widget.after(300, lambda: self.show(text, x, y))

    def show(self, text, x, y):
        self.hide()
        self.win = tk.Toplevel(self.widget)
        self.win.wm_overrideredirect(True)
        self.win.wm_geometry(f"+{x + 14}+{y + 16}")
        T.tooltip_label(self.win, text).pack()

    def hide(self):
        if self.pending:
            self.widget.after_cancel(self.pending)
            self.pending = None
        if self.win:
            self.win.destroy()
            self.win = None


def help_icon(parent, text):
    """The circled "?" (benchtheme spec): a ring at rest, a filled disc on hover; shows `text` on hover."""
    bg = ttk.Style().lookup("TFrame", "background") or parent.winfo_toplevel().cget("background")
    c = tk.Canvas(parent, width=16, height=16, highlightthickness=0, background=bg, cursor="question_arrow")
    T.draw_help_icon(c, 16)
    c.bind("<Enter>", lambda e: T.draw_help_icon(c, 16, hover=True), add="+")
    c.bind("<Leave>", lambda e: T.draw_help_icon(c, 16), add="+")
    Tip(c, text)
    return c


def heading_tips(tree, texts):
    """Hover help on a Treeview's column headings (texts: heading -> help)."""
    tip = Tip(tree)
    state = {"col": None}

    def motion(e):
        col = tree.identify_column(e.x) if tree.identify_region(e.x, e.y) == "heading" else ""
        name = (tree.heading("#0", "text") if col == "#0" else tree.column(col, "id")) if col else None
        if name != state["col"]:
            state["col"] = name
            tip.hide()
            if name in texts:
                tip.later(texts[name], e.x_root, e.y_root)
    tree.bind("<Motion>", motion, add="+")
    tree.bind("<Leave>", lambda e: (tip.hide(), state.update(col=None)), add="+")


def image(name):
    """PhotoImage for orchestration/icons/<name>.png (the Claude Design desktop icons), None if missing."""
    if name not in _IMAGES:
        path = os.path.join(ICON_DIR, f"{name}.png")
        _IMAGES[name] = tk.PhotoImage(file=path) if os.path.exists(path) else None
    return _IMAGES[name]


def icon(name):
    return image(f"gleipnir-desk-icon-{name}-16@1x") if name else None


def button_image(name):
    """ttk image spec: the rest icon plus its separate disabled PNG ('' when the icon is missing)."""
    rest, off = icon(name), image(f"gleipnir-desk-icon-{name}-disabled-16@1x")
    if rest is None:
        return ""
    return (rest, "disabled", off) if off is not None else rest


def marker(variant, reference=False):
    """The variant's 12 px marker; reference-line rows get the marker plus a dashed stroke in its colour."""
    base = image(f"gleipnir-viz-variant-marker-{variant}-12@1x")
    if base is None or not reference:
        return base
    key = f"{variant}+reference"
    if key not in _IMAGES:
        img = tk.PhotoImage(width=32, height=12)
        img.tk.call(img, "copy", base, "-to", 0, 0)
        for x in range(15, 31, 6):
            img.put(T.VARIANT[variant]["color"], to=(x, 5, x + 4, 7))
        _IMAGES[key] = img
    return _IMAGES[key]


def variant_of(run_id):
    """The variant slug inside a run id (longest first, so 'parallel-anchored' wins over 'parallel')."""
    return next((v for v in sorted(T.VARIANT, key=len, reverse=True) if v in (run_id or "")), None)


def ibutton(parent, text, icon_name, command, primary=False, **kw):
    """A native vista button with its 16 px icon on the left (emphasis = bold, the only thing vista honours)."""
    return ttk.Button(parent, text=text, image=button_image(icon_name), compound="left", command=command,
                      style="Primary.TButton" if primary else "TButton", **kw)


def set_chip(label, text, icon_name, style):
    """An icon + text status label; the icon carries the meaning as well as the colour."""
    label.configure(text=f" {text}" if icon_name else text, image=icon(icon_name) or "", style=style)


def keep_awake(on):
    """Stop Windows from sleeping mid-campaign (a laptop shutdown once cost a campaign 10 % of its runs)."""
    try:
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | (0x00000001 if on else 0))
    except Exception:  # noqa: BLE001 — not Windows / no ctypes: nothing to do
        pass


class App:
    def __init__(self, root):
        self.root = root
        self.runner = BC.Runner()
        self.vars, self.job, self.logfh = {}, None, None
        self.plan_lines, self.tail = [], []
        self.live_rows, self.current_run, self.cancel_at = {}, None, None
        root.title("GLEIPNIR Bench — E0 · E1 · E2 · E3")
        root.geometry("1440x920")
        root.report_callback_exception = self.on_error
        self.load_sweeps()
        self.build()
        self.refresh_all()
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        root.after(100, self.poll)

    # ------------------------------------------------------------------ sweeps.yaml
    def load_sweeps(self):
        with open(BC.SWEEPS, encoding="utf-8", newline="") as fh:
            self.text = fh.read()
        self.sweeps = yaml.safe_load(self.text)
        for path in FIELDS:
            val = show_value(BC.get_path(self.sweeps, path))
            if path in self.vars:
                self.vars[path].set(val)
            else:
                self.vars[path] = tk.StringVar(value=val)
                self.vars[path].trace_add("write", lambda *_: self.update_status())

    def changed(self):
        """{path: new value} for every input that differs from the file (raises ValueError on bad input)."""
        out = {}
        for path, (label, kind) in FIELDS.items():
            try:
                new = parse_value(kind, self.vars[path].get())
            except ValueError:
                raise ValueError(f"'{label}': not a valid {kind}") from None
            if new != BC.get_path(self.sweeps, path):
                out[path] = new
        return out

    def write_sweeps(self, edits, tag_for):
        """Apply {path: value} to the file in place; refuse if it changed on disk since it was loaded."""
        with open(BC.SWEEPS, encoding="utf-8", newline="") as fh:
            disk = fh.read()
        if disk != self.text:
            raise RuntimeError("benchmark/sweeps.yaml changed on disk since it was loaded — Reload first")
        text = disk
        for path, value in edits.items():
            text = BC.set_sweeps_value(text, path, value, tag=tag_for(path))
        with open(BC.SWEEPS, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        self.load_sweeps()
        self.refresh_all()

    def save(self):
        if not self.idle():
            messagebox.showwarning("Busy", "A benchmark is using benchmark/sweeps.yaml right now — save after it ends "
                                   "(run.json must cite the values the run actually used).")
            return False
        try:
            edits = self.changed()
            if edits:
                self.write_sweeps(edits, lambda p: f"set by hand {today()}" if p.startswith("baseline.") else None)
        except (ValueError, RuntimeError, KeyError) as e:
            messagebox.showerror("Not saved", str(e))
            return False
        return True

    def revert(self):
        self.load_sweeps()
        self.refresh_all()

    def ensure_saved(self):
        try:
            edits = self.changed()
        except ValueError as e:
            messagebox.showerror("Invalid input", str(e))
            return False
        if not edits:
            return True
        if messagebox.askyesno("Unsaved changes", "experiment.py reads benchmark/sweeps.yaml.\n\nSave these "
                               f"{len(edits)} change(s) first?\n\n" + "\n".join(f"  {p} = {v}" for p, v in edits.items())):
            return self.save()
        return False

    def update_status(self):
        try:
            n = len(self.changed())
            set_chip(self.st_unsaved, f"{n} unsaved change(s)" if n else "no unsaved changes",
                     "warning" if n else None, "Warn.TLabel" if n else "Hint.TLabel")
        except ValueError as e:
            set_chip(self.st_unsaved, str(e), "x-circle", "Error.TLabel")
        if BC.git_dirty():
            set_chip(self.st_sweeps, "sweeps.yaml has UNCOMMITTED changes — run.json cites its SHA: commit before a "
                     "campaign", "warning", "Warn.TLabel")
        else:
            set_chip(self.st_sweeps, "sweeps.yaml committed", "check-circle", "Saved.TLabel")
        origin = str(BC.ledger_origin())
        set_chip(self.st_ledger, f"ledger holds: {origin}", "backup",
                 "Warn.TLabel" if origin.startswith("benchmark") else "Note.TLabel")
        try:
            rounds = int(self.vars["workload.rounds"].get()) * int(self.vars["workload.events_per_case_per_round"].get())
            floor = int(self.vars["regimes.steady.min_events_per_channel"].get())
            self.floor_hint.set(f"nominal {rounds} write events per case per run (floor {floor}). The seeded trace "
                                "scatters channels around it — Preview shows the real least-loaded channel.")
        except (ValueError, AttributeError):
            pass

    def set_busy(self, busy):
        """Back up / Restore stay disabled while anything runs (drawn with their disabled PNGs)."""
        for text in ("Back up now", "Restore my test data…"):
            self.top_buttons[text].configure(state="disabled" if busy else "normal")

    # ------------------------------------------------------------------ layout
    def build(self):
        top = ttk.Frame(self.root, padding=(8, 6))
        top.pack(fill="x")
        self.st_sweeps, self.st_unsaved, self.st_ledger = (ttk.Label(top, compound="left") for _ in range(3))
        for k, lbl in enumerate((self.st_sweeps, self.st_unsaved, self.st_ledger)):
            if k:
                ttk.Separator(top, orient="vertical").pack(side="left", fill="y", padx=10)
            lbl.pack(side="left")
        self.top_buttons = {}
        for text, name, cmd in (("Restore my test data…", "restore", self.restore),
                                ("Back up now", "backup", self.backup_now),
                                ("Revert (reload file)", "revert", self.revert), ("Save changes", "save", self.save)):
            self.top_buttons[text] = Tip(ibutton(top, text, name, cmd), H.BUTTON_HELP.get(text)).widget
            self.top_buttons[text].pack(side="right", padx=2)

        pane = ttk.PanedWindow(self.root, orient="vertical")
        pane.pack(fill="both", expand=True)
        self.nb = ttk.Notebook(pane)
        pane.add(self.nb, weight=3)
        self.floor_hint = tk.StringVar()
        self.tab_settings()
        self.tab_e0()
        self.tab_e1()
        self.tab_e2()
        self.tab_e3()
        self.tab_custom()
        self.tab_history()
        self.nb.bind("<<NotebookTabChanged>>", lambda _: self.refresh_all())
        pane.add(self.run_panel(pane), weight=2)

    def tab(self, title):
        outer = ttk.Frame(self.nb, padding=8)
        self.nb.add(outer, text=title)
        line, detail = H.TAB_HELP[title]
        head = ttk.Frame(outer)
        head.pack(fill="x", pady=(0, 6))
        ttk.Label(head, text=line, style="Headline.TLabel").pack(side="left")
        help_icon(head, detail).pack(side="left", padx=6)
        ttk.Label(head, text="(hover the ? icons for details)", style="Hint.TLabel").pack(side="left")
        body = ttk.Frame(outer)
        body.pack(fill="both", expand=True)
        return body

    def fields(self, parent, paths, title, row=0, col=0):
        box = ttk.LabelFrame(parent, text=title, padding=6)
        box.grid(row=row, column=col, sticky="nsew", padx=4, pady=4)
        for i, path in enumerate(paths):
            ttk.Label(box, text=FIELDS[path][0]).grid(row=i, column=0, sticky="w")
            ttk.Entry(box, textvariable=self.vars[path], width=26).grid(row=i, column=1, sticky="w", padx=4)
            help_icon(box, H.FIELD_HELP[path]).grid(row=i, column=2, sticky="w")
        return box

    def readonly(self, parent, paths, title, row=0, col=0):
        """Held-fixed values: Baseline blue with a lock — edited only in Settings or via "Use as baseline"."""
        box = ttk.LabelFrame(parent, text=title, padding=6)
        box.grid(row=row, column=col, sticky="nsew", padx=4, pady=4)
        for i, path in enumerate(paths):
            ttk.Label(box, text=FIELDS[path][0]).grid(row=i, column=0, sticky="w")
            ttk.Label(box, image=icon("lock") or "").grid(row=i, column=1, sticky="w", padx=(6, 2))
            ttk.Label(box, textvariable=self.vars[path], style="Baseline.TLabel", font=T.FONT_BOLD).grid(
                row=i, column=2, sticky="w", padx=(0, 4))
            help_icon(box, H.FIELD_HELP[path]).grid(row=i, column=3, sticky="w")
        ttk.Label(box, text="(edit in Settings & Baselines, or via “Use as baseline”)", style="Hint.TLabel").grid(
            row=len(paths), column=0, columnspan=4, sticky="w")
        return box

    def variant_boxes(self, parent, variants, ref=(), title="variants", row=0, col=0):
        """Exact variant names with their markers; reference-line rows add a dashed stroke."""
        box = ttk.LabelFrame(parent, text=title, padding=6)
        box.grid(row=row, column=col, sticky="nw", padx=4, pady=4)
        vs = {}
        for i, v in enumerate(variants):
            vs[v] = tk.BooleanVar(value=True)
            label = T.VARIANT[v]["label"] + (" (reference line)" if v in ref else "")
            ttk.Checkbutton(box, text=f" {label}", variable=vs[v], image=marker(v, v in ref) or "",
                            compound="left").grid(row=i // 2, column=i % 2, sticky="w", padx=(0, 18), pady=1)
        return vs

    def reps_box(self, parent, row, col):
        var = tk.StringVar()
        box = ttk.Frame(parent)
        box.grid(row=row, column=col, sticky="w", padx=4)
        ttk.Label(box, text="repetitions (blank = sweeps.yaml r)").pack(side="left")
        ttk.Entry(box, textvariable=var, width=6).pack(side="left", padx=4)
        return var

    def actions(self, parent, args_fn, row, col=0, note=""):
        box = ttk.Frame(parent)
        box.grid(row=row, column=col, columnspan=3, sticky="w", padx=4, pady=6)
        for text, name, cmd, primary in (("Preview plan", "preview", lambda: self.start_run(args_fn, preview_only=True), False),
                                         ("Run…", "run", lambda: self.start_run(args_fn, resume=False), True),
                                         ("Resume…", "resume", lambda: self.start_run(args_fn, resume=True), False)):
            Tip(ibutton(box, text, name, cmd, primary=primary), H.BUTTON_HELP[text]).widget.pack(side="left", padx=2)
        if note:
            ttk.Label(box, text=note, style="Note.TLabel").pack(side="left", padx=8)

    def suggestion(self, parent, title, cols, row, col=0, variant_col=False):
        """"The app suggests, you decide": a terracotta left bar and a lightbulb in the title; unit-complete
        headers; zebra rows, qualifying rows tinted with a ✓; variant rows carry their marker."""
        head = ttk.Label(parent, text=f" {title}", image=icon("suggestion") or "", compound="left",
                         style="Legend.TLabel")
        box = ttk.LabelFrame(parent, labelwidget=head, padding=6)
        box.grid(row=row, column=col, columnspan=3, sticky="nsew", padx=4, pady=4)
        tk.Frame(box, width=3, background=T.SELECT_BG).pack(side="left", fill="y", padx=(0, 8))
        inner = ttk.Frame(box)
        inner.pack(side="left", fill="both", expand=True)
        tree = self.results_tree(inner, cols, run_col=variant_col)
        tree.configure(height=7)
        tree.tag_configure("qualifies", background="#E8F5EC")
        verdict = tk.StringVar(value="no results yet")
        ttk.Label(inner, textvariable=verdict, wraplength=1250, justify="left").pack(anchor="w", pady=4)
        buttons = ttk.Frame(inner)
        buttons.pack(anchor="w")
        return tree, verdict, buttons

    def tab_settings(self):
        f = self.tab("Settings & Baselines")
        self.fields(f, WORKLOAD, "Controlled workload (identical for every variant)", 0, 0)
        b = self.fields(f, BASELINES, "Baselines — calibrated in E0/E1/E2, held fixed in E3 (never “optimal”)", 0, 1)
        self.prov = {}   # provenance badge per baseline: PLACEHOLDER / set from <exp> / set by hand
        for i, path in enumerate(BASELINES):
            self.prov[path] = ttk.Label(b, compound="left")
            self.prov[path].grid(row=i, column=3, sticky="w", padx=4)
        ttk.Label(f, textvariable=self.floor_hint, style="Note.TLabel", wraplength=900).grid(
            row=1, column=0, columnspan=2, sticky="w", padx=4)
        ttk.Label(f, text="Save writes benchmark/sweeps.yaml in place (comments kept). Hand-edited baselines are "
                  "tagged “set by hand <date>”; suggested ones “set from <exp> <date>”.", style="Note.TLabel").grid(
            row=2, column=0, columnspan=2, sticky="w", padx=4)

    def tab_e0(self):
        f = self.tab("E0 initial test")
        self.e0_mode = tk.StringVar(value="e0")
        m = ttk.LabelFrame(f, text="step", padding=6)
        m.grid(row=0, column=0, sticky="nw", padx=4, pady=4)
        for v, t in (("e0", "smoke test — functional correctness only (label smoke)"),
                     ("ramp", "ramp — short send-rate ramp to locate saturation")):
            Tip(ttk.Radiobutton(m, text=t, value=v, variable=self.e0_mode), H.MODE_HELP[v]).widget.pack(anchor="w")
        self.fields(f, ["regimes.smoke.cases", "regimes.smoke.evidence_per_case", "regimes.smoke.logs_per_case_min",
                        "regimes.smoke.logs_per_case_max", "regimes.smoke.send_rate_tps"], "smoke test", 0, 1)
        self.fields(f, ["ramp.events_per_case_per_round", "send_rates_tps"], "ramp", 0, 2)
        self.e0_vars = self.variant_boxes(f, R.VARIANTS, row=1, col=0)
        self.readonly(f, ["baseline.channels"], "ramp cases (provisional until E2)", 1, 1)
        self.actions(f, lambda: BC.experiment_args(self.e0_mode.get(), variants=self.pick(self.e0_vars)), 2,
                     note="1 repetition by design. Results are labelled smoke / sub-floor, never steady.")
        self.s_e0 = self.suggestion(f, "Suggested baseline send rate (from the ramp)",
                                    [("variant", 170), ("saturation (tx/s)", 130), ("suggested (tx/s)", 130)], 3,
                                    variant_col=True)

    def tab_e1(self):
        f = self.tab("E1 batch size")
        self.fields(f, ["batch_sizes"], "independent variable", 0, 0)
        self.e1_vars = self.variant_boxes(f, ["anchoring", "parallel-anchored", "standard", "parallel"],
                                          ref=("standard", "parallel"), row=0, col=1)
        self.readonly(f, ["baseline.send_rate_tps", "baseline.channels"], "held fixed", 0, 2)
        self.e1_reps = self.reps_box(f, 1, 0)
        self.actions(f, lambda: BC.experiment_args("e1", variants=self.pick(self.e1_vars),
                                                   reps=num(self.e1_reps)), 2)
        self.s_e1 = self.suggestion(f, "Suggested baseline batch size (methodology §4.1)", [
            ("variant", 170), ("batch (events)", 90), ("reps (n)", 60), ("throughput (TPS, mean)", 140),
            ("Δ throughput to next (%)", 150), ("on-chain (B/event)", 115), ("Δ on-chain to next (%)", 140),
            ("audit (s/case)", 90), ("audit ratio (×)", 95), ("qualifies", 70)], 3, variant_col=True)

    def tab_e2(self):
        f = self.tab("E2 channels")
        self.fields(f, ["channel_counts"], "independent variable (Parallel only; cases = channels)", 0, 0)
        self.readonly(f, ["baseline.send_rate_tps"], "held fixed", 0, 1)
        self.e2_reps = self.reps_box(f, 1, 0)
        self.actions(f, lambda: BC.experiment_args("e2", reps=num(self.e2_reps)), 2,
                     note=f"host: {os.cpu_count()} logical cores seen by Windows (WSL figure is in each run.json)")
        self.s_e2 = self.suggestion(f, "Suggested cases/channels (methodology §4.2: median of the healthy range)", [
            ("channels (n)", 85), ("reps (n)", 60), ("throughput (TPS, mean)", 140), ("× previous", 80),
            ("failure (%)", 80), ("CPU (%)", 80), ("CPU budget (%)", 100), ("memory (MB)", 90), ("healthy", 60),
            ("reason", 220)], 3)

    def tab_e3(self):
        f = self.tab("E3 main")
        self.e3_mode = tk.StringVar(value="e3a")
        m = ttk.LabelFrame(f, text="experiment", padding=6)
        m.grid(row=0, column=0, sticky="nw", padx=4, pady=4)
        for v, t in (("e3a", "E3a — scalability vs send rate (one round per send rate)"),
                     ("e3b", "E3b — scalability vs cases (Parallel: one channel per case)"),
                     ("ops", "per-operation breakdown (writes and reads in separate tables)")):
            Tip(ttk.Radiobutton(m, text=t, value=v, variable=self.e3_mode), H.MODE_HELP[v]).widget.pack(anchor="w")
        self.fields(f, ["case_counts"], "E3b grid", 0, 1)
        self.e3_vars = self.variant_boxes(f, R.VARIANTS, row=1, col=0)
        self.readonly(f, BASELINES + ["send_rates_tps"], "held fixed — the baselines from E0/E1/E2", 1, 1)
        self.e3_warn = tk.StringVar()   # banner: warning tint + 3 px left bar, shown only while a baseline is a placeholder
        self.e3_banner = tk.Frame(f, background="#B7791F")
        self.e3_banner.grid(row=2, column=0, columnspan=3, sticky="w", padx=4, pady=2)
        tk.Label(self.e3_banner, textvariable=self.e3_warn, image=icon("warning") or "", compound="left",
                 background=T.SUBFLOOR_BG, foreground=T.WARN, font=T.FONT_UI, justify="left", wraplength=900,
                 padx=8, pady=4).pack(padx=(3, 0))
        self.e3_reps = self.reps_box(f, 3, 0)
        self.actions(f, lambda: BC.experiment_args(self.e3_mode.get(), variants=self.pick(self.e3_vars),
                                                   reps=num(self.e3_reps)), 4,
                     note="Supervisor gate: the variable table + three flowcharts go to D before E3 runs.")

    def tab_custom(self):
        f = self.tab("Custom test")
        ttk.Label(f, text="One ad-hoc cell (experiment.py --exp cell): a probe, not an E1–E3 datapoint — results go "
                  "to results/cell/ and the CSV only. Blank = the sweeps.yaml value.", style="Note.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", padx=4)
        fac = ttk.LabelFrame(f, text="independent variables", padding=6)
        fac.grid(row=1, column=0, sticky="nw", padx=4, pady=4)
        self.c_send, self.c_batch, self.c_cases = tk.StringVar(), tk.StringVar(), tk.StringVar()
        for i, (label, var, key) in enumerate((("send rate(s), tx/s (several → one round each)", self.c_send, "send"),
                                               ("batch size (events, anchored variants)", self.c_batch, "batch"),
                                               ("cases (= channels on Parallel variants)", self.c_cases, "cases"))):
            ttk.Label(fac, text=label).grid(row=i, column=0, sticky="w")
            ttk.Entry(fac, textvariable=var, width=20).grid(row=i, column=1, padx=4)
            help_icon(fac, H.CUSTOM_HELP[key]).grid(row=i, column=2, sticky="w")
        ctl = ttk.LabelFrame(f, text="controlled workload overrides (recorded in run.json; own results dir)", padding=6)
        ctl.grid(row=1, column=1, sticky="nw", padx=4, pady=4)
        self.c_ctl = {}
        for i, (flag, path, _typ, _lo, _hi, hlp) in enumerate(E.CONTROL_FLAGS):
            self.c_ctl[flag] = tk.StringVar()
            ttk.Label(ctl, text=f"{flag}  ({hlp})").grid(row=i, column=0, sticky="w")
            ttk.Entry(ctl, textvariable=self.c_ctl[flag], width=10).grid(row=i, column=1, padx=4)
            help_icon(ctl, H.FIELD_HELP[path]).grid(row=i, column=2, sticky="w")
        self.c_vars = self.variant_boxes(f, R.VARIANTS, row=1, col=2)
        opts = ttk.Frame(f)
        opts.grid(row=2, column=0, sticky="w", padx=4)
        self.c_reuse, self.c_nomon, self.c_noaud = tk.BooleanVar(), tk.BooleanVar(), tk.BooleanVar()
        for text, var, tip in (("reuse the running ledger (ONE run only)", self.c_reuse, H.CUSTOM_HELP["reuse"]),
                               ("no resource monitor", self.c_nomon, "Skip Caliper's CPU/memory sampling (no CPU/memory columns)."),
                               ("no audit reconstruction", self.c_noaud, "Skip the audit-time step after the rounds.")):
            Tip(ttk.Checkbutton(opts, text=text, variable=var), tip).widget.pack(anchor="w")
        self.c_reps = self.reps_box(f, 3, 0)
        self.actions(f, self.custom_args, 4)

    def custom_args(self):
        controls = {}
        for flag, _p, typ, _lo, _hi, _h in E.CONTROL_FLAGS:
            v = num(self.c_ctl[flag], typ)
            if v is not None:
                controls[flag] = v
        rates = parse_value("list", self.c_send.get()) if self.c_send.get().strip() else ()
        return BC.experiment_args("cell", variants=self.pick(self.c_vars), reps=num(self.c_reps),
                                  send_rates=rates, batch_size=num(self.c_batch), cases=num(self.c_cases),
                                  controls=controls, reuse_network=self.c_reuse.get(), no_monitor=self.c_nomon.get(),
                                  no_audit=self.c_noaud.get())

    def tab_history(self):
        f = self.tab("History & results")
        bar = ttk.Frame(f)
        bar.pack(fill="x")
        ttk.Label(bar, text="experiment").pack(side="left")
        self.h_exp = tk.StringVar(value="all")
        cb = ttk.Combobox(bar, textvariable=self.h_exp, values=["all"] + REP.EXPORT_EXPS, width=8, state="readonly")
        cb.pack(side="left", padx=4)
        cb.bind("<<ComboboxSelected>>", lambda _: self.refresh_history())
        ibutton(bar, "Refresh", "refresh", self.refresh_history).pack(side="left")
        self.h_comma = tk.BooleanVar()
        Tip(ttk.Checkbutton(bar, text="decimal comma (; separated — Indonesian Excel)", variable=self.h_comma),
            H.BUTTON_HELP["decimal comma"]).widget.pack(side="left", padx=12)
        for text, name, cmd in (("Export per-round CSV…", "export-csv", self.export_csv),
                                ("Export summary tables…", "export-tables", self.export_tables),
                                ("Generate tables + charts", "generate-charts", self.gen_charts),
                                ("Open results folder", "open-folder", lambda: os.startfile(BC.RESULTS))):
            Tip(ibutton(bar, text, name, cmd), H.BUTTON_HELP.get(text)).widget.pack(side="left", padx=2)
        split = ttk.PanedWindow(f, orient="horizontal")
        split.pack(fill="both", expand=True, pady=4)
        left = ttk.Frame(split)
        split.add(left, weight=2)
        self.h_runs = ttk.Treeview(left, columns=("runId", "status", "regime", "started", "wall"), show="headings")
        for c, w in (("runId", 330), ("status", 70), ("regime", 75), ("started", 150), ("wall", 70)):
            self.h_runs.heading(c, text={"wall": "wall (min)", "started": "started (UTC)"}.get(c, c))
            self.h_runs.column(c, width=w)
        T.tag_tree(self.h_runs)
        self.h_runs.pack(fill="both", expand=True)
        self.h_runs.bind("<<TreeviewSelect>>", lambda _: self.show_run())
        right = ttk.Notebook(split)
        split.add(right, weight=3)
        rf = ttk.Frame(right)
        right.add(rf, text="per-round results")
        self.h_rounds = self.results_tree(rf, LIVE_COLS[1:])
        cf = ttk.Frame(right)
        right.add(cf, text="charts")
        self.h_charts = tk.Listbox(cf, height=6)
        self.h_charts.pack(fill="x")
        self.h_charts.bind("<<ListboxSelect>>", lambda _: self.show_chart())
        self.h_canvas = tk.Label(cf)
        self.h_canvas.pack(fill="both", expand=True)

    def results_tree(self, parent, cols, run_col=False):
        """Per-round results in the supervisor's columns. run_col: the first column is the tree column, so
        each row can carry its variant marker."""
        first, rest = (cols[0], cols[1:]) if run_col else (None, cols)
        tree = ttk.Treeview(parent, columns=[c for c, _ in rest], show="tree headings" if run_col else "headings")
        if run_col:
            tree.heading("#0", text=first[0], anchor="w")
            tree.column("#0", width=first[1], stretch=False)
        for k, (c, w) in enumerate(rest):
            tree.heading(c, text=c)
            tree.column(c, width=w, anchor="e" if c not in ("run", "round") else "w",
                        stretch=not (run_col and k < 2))   # keeps the configured | measured boundary in place
        T.tag_tree(tree)
        tree.pack(fill="both", expand=True)
        heading_tips(tree, H.COLUMN_HELP)
        return tree

    def run_panel(self, parent):
        f = ttk.LabelFrame(parent, text="Run", padding=6)
        row = ttk.Frame(f)
        row.pack(fill="x")
        ttk.Label(row, text="overall", style="Note.TLabel", width=20).pack(side="left")
        self.p_overall = ttk.Progressbar(row, length=360)
        self.p_overall.pack(side="left")
        self.p_text = tk.StringVar(value="idle")
        ttk.Label(row, textvariable=self.p_text).pack(side="left", padx=8)
        self.b_cancel = ibutton(row, "Cancel", "cancel", self.cancel, state="disabled")
        Tip(self.b_cancel, H.BUTTON_HELP["Cancel"])
        self.b_cancel.pack(side="right")
        self.verbose = tk.BooleanVar()
        ttk.Checkbutton(row, text="verbose Caliper output", variable=self.verbose).pack(side="right", padx=8)
        self.awake = ttk.Label(row, text=" keeping this PC awake", image=icon("keep-awake") or "", compound="left",
                               style="Baseline.TLabel")   # packed only while a run holds the PC awake
        row2 = ttk.Frame(f)
        row2.pack(fill="x", pady=2)
        ttk.Label(row2, text="this round (Caliper)", style="Note.TLabel", width=20).pack(side="left")
        self.p_round = ttk.Progressbar(row2, length=360)
        self.p_round.pack(side="left")
        self.p_now = tk.StringVar()
        ttk.Label(row2, textvariable=self.p_now).pack(side="left", padx=8)
        self.p_warn = ttk.Label(f, style="Warn.TLabel", compound="left", wraplength=1350)
        self.p_warn.pack(anchor="w")
        cap = tk.Frame(f, height=18)   # "configured | measured": send rate is the input, the rest is measured
        cap.pack(fill="x")
        x = sum(w for _, w in LIVE_COLS[:3]) + 2
        ttk.Label(cap, text="configured", style="Hint.TLabel").place(x=x - 6, y=0, anchor="ne")
        tk.Frame(cap, width=2, height=18, background=T.NOTE).place(x=x, y=0)
        ttk.Label(cap, text="measured", style="Hint.TLabel").place(x=x + 8, y=0, anchor="nw")
        self.live = self.results_tree(f, LIVE_COLS, run_col=True)
        self.live.configure(height=6)
        logbar = ttk.Frame(f)
        logbar.pack(fill="x")
        self.show_log = tk.BooleanVar()
        ttk.Checkbutton(logbar, text="show raw log", variable=self.show_log, command=self.toggle_log).pack(side="left")
        self.log_path = tk.StringVar()
        ttk.Label(logbar, textvariable=self.log_path, style="Hint.TLabel", font=T.FONT_MONO).pack(side="left", padx=8)
        self.log = scrolledtext.ScrolledText(f, height=10)
        T.style_log(self.log)
        return f

    def toggle_log(self):
        if self.show_log.get():
            self.log.pack(fill="both", expand=True)
        else:
            self.log.pack_forget()

    # ------------------------------------------------------------------ helpers
    def pick(self, vs):
        return [v for v, var in vs.items() if var.get()]

    def on_error(self, *exc):
        messagebox.showerror("GLEIPNIR Bench", f"{exc[0].__name__}: {exc[1]}")

    def refresh_all(self):
        for path in BASELINES:
            try:
                p = BC.baseline_provenance(self.text, path)
            except KeyError:
                continue
            name, style = (("warning", "Warn.TLabel") if p.startswith("PLACEHOLDER") else
                           ("check-circle", "Saved.TLabel") if p.startswith("set from") else
                           ("info-filled", "Baseline.TLabel") if p.startswith("set by hand") else (None, "Hint.TLabel"))
            set_chip(self.prov[path], p, name, style)
        ph = [FIELDS[p][0] for p in BASELINES if BC.baseline_provenance(self.text, p).startswith("PLACEHOLDER")]
        self.e3_warn.set(" still PLACEHOLDER (run E0/E1/E2 and confirm the suggestions first): " + "; ".join(ph)
                         if ph else "")
        if ph:
            self.e3_banner.grid()
        else:
            self.e3_banner.grid_remove()
        self.update_status()
        self.refresh_suggestions()
        self.refresh_history()

    # ------------------------------------------------------------------ suggestions
    def refresh_suggestions(self):
        def fill(tree, rows, ok_col=None, variant_first=False):
            tree.delete(*tree.get_children())
            for i, r in enumerate(rows):
                vals = [fmt(x) for x in r]
                tags = ("qualifies",) if ok_col is not None and r[ok_col] else ("zebra",) if i % 2 else ()
                if variant_first:
                    tree.insert("", "end", text=f" {T.VARIANT.get(r[0], {}).get('label', r[0])}",
                                image=marker(r[0]) or "", values=vals[1:], tags=tags)
                else:
                    tree.insert("", "end", values=vals, tags=tags)

        for *_, buttons in (self.s_e0, self.s_e1, self.s_e2):
            for w in buttons.winfo_children():
                w.destroy()
        # E0 ramp -> baseline.send_rate_tps
        tree, verdict, buttons = self.s_e0
        ms = REP.load_manifests("ramp", BC.RESULTS)
        if ms:
            s = REP.suggest_send_rate(ms, self.sweeps["send_rates_tps"])
            fill(tree, [(v, p["saturation"] or "not reached", p["suggested"]) for v, p in s["perVariant"].items()],
                 variant_first=True)
            verdict.set(f"suggested baseline send rate = {s['suggested']} tx/s (the lowest variant's suggestion, "
                        f"since E1/E2/E3b run every variant at it — confirm with D) · trimmed grid "
                        f"{s['trimmedGrid']}" + ("".join(f" · {n}" for n in s["notes"])))
            if s["suggested"]:
                ibutton(buttons, f"Use {s['suggested']} tx/s as baseline…", "use-baseline",
                        lambda v=s["suggested"]: self.apply({"baseline.send_rate_tps": v}, "ramp"),
                        primary=True).pack(side="left", padx=(0, 6))
            ibutton(buttons, "Use trimmed grid as send-rate grid…", "use-baseline",
                    lambda g=s["trimmedGrid"]: self.apply({"send_rates_tps": g}, "ramp")).pack(side="left")
        # E1 -> baseline.batch_size
        tree, verdict, buttons = self.s_e1
        ms = REP.load_manifests("e1", BC.RESULTS)
        if ms:
            s = REP.suggest_batch_size(REP.aggregate(REP.data_points("e1", ms)))
            fill(tree, [(e["variant"], e["level"], e["reps"], e["throughputTps"], e["throughputChangePct"],
                         e["onChainBytesPerEvent"], e["bytesChangePct"], e["auditSPerCase"], e["auditRatio"],
                         "✓" if e["qualifies"] else "") for e in s["evidence"]], ok_col=9, variant_first=True)
            verdict.set(f"suggested baseline batch size = {s['suggested']} (per variant: {s['perVariant']}"
                        f"{'; the variants DISAGREE — the larger level is taken' if s['disagree'] else ''})"
                        + "".join(f" · {n}" for n in s["notes"]) + " · thresholds: confirm with D")
            if s["suggested"]:
                ibutton(buttons, f"Use {s['suggested']} as baseline batch size…", "use-baseline",
                        lambda v=s["suggested"]: self.apply({"baseline.batch_size": v}, "e1"),
                        primary=True).pack(side="left")
        # E2 -> baseline.channels + channels_max
        tree, verdict, buttons = self.s_e2
        ms = REP.load_manifests("e2", BC.RESULTS)
        if ms:
            s = REP.suggest_channels(REP.aggregate(REP.data_points("e2", ms)), REP.host_cores(ms))
            fill(tree, [(e["level"], e["reps"], e["throughputTps"], e["ratioToPrevious"], e["failureRatePct"],
                         e["cpuPct"], e["cpuBudgetPct"], e["memMb"], "✓" if e["healthy"] else "", e["reason"])
                        for e in s["evidence"]], ok_col=8)
            verdict.set(f"healthy range {s['healthy']} → suggested cases/channels = {s['channels']} (median), "
                        f"max = {s['channelsMax']} (top)" + "".join(f" · {n}" for n in s["notes"])
                        + " · thresholds: confirm with D")
            if s["channels"]:
                ibutton(buttons, f"Use {s['channels']} / max {s['channelsMax']} as baselines…", "use-baseline",
                        lambda a=s["channels"], b=s["channelsMax"]: self.apply(
                            {"baseline.channels": a, "baseline.channels_max": b}, "e2"), primary=True).pack(side="left")

    def apply(self, edits, exp):
        if not self.idle():
            messagebox.showwarning("Busy", "A benchmark is using benchmark/sweeps.yaml right now — apply after it ends.")
            return
        if not self.ensure_saved():
            return
        lines = "\n".join(f"  {p}: {show_value(BC.get_path(self.sweeps, p))}  →  {show_value(v)}" for p, v in edits.items())
        if not messagebox.askyesno("Use as baseline", f"Write into benchmark/sweeps.yaml?\n\n{lines}\n\n"
                                   f"Tagged “set from {exp} {today()}”. This is a baseline, never an optimum; "
                                   "the rule thresholds are still to be confirmed with D."):
            return
        try:
            self.write_sweeps(edits, lambda p: f"set from {exp} {today()}" if p.startswith("baseline.") else None)
        except (ValueError, RuntimeError, KeyError) as e:
            messagebox.showerror("Not written", str(e))

    # ------------------------------------------------------------------ history + export
    def refresh_history(self):
        exp = self.h_exp.get()
        self.h_runs.delete(*self.h_runs.get_children())
        n = 0
        for i, r in enumerate(reversed(E.load_json_lines(E.RUNLOG))):
            if exp != "all" and r.get("exp") != exp:
                continue
            run = E.load_json(os.path.join(BC.RESULTS, *r["runId"].split("/"), "run.json")) or {}
            wall = r.get("wallSeconds")
            status, regime = r.get("status") or "", run.get("regime", "")
            tags = [status] if status in ("failed", "running") else [regime] if regime in ("smoke", "sub-floor") else []
            if not tags and n % 2:
                tags = ["zebra"]
            n += 1
            self.h_runs.insert("", "end", iid=f"{i}|{r.get('startedAt') or ''}|{r['runId']}", tags=tags, values=(
                r["runId"], {"complete": "✓ ", "failed": "✕ ", "running": "… "}.get(status, "") + status,
                ("▿ " if regime == "sub-floor" else "") + regime, (r.get("startedAt") or "")[:19].replace("T", " "),
                fmt(round(wall / 60, 1)) if isinstance(wall, (int, float)) else ""))

    def show_run(self):
        sel = self.h_runs.selection()
        self.h_rounds.delete(*self.h_rounds.get_children())
        if not sel:
            return
        _, started, run_id = sel[0].split("|", 2)
        m = E.load_json(os.path.join(BC.RESULTS, *run_id.split("/"), "manifest.json"))
        if not m or not m.get("rounds") or (started and m.get("startedAt") != started):
            self.h_rounds.insert("", "end", values=["no results for this attempt (failed, cancelled or re-run "
                                                    "since)"] + [""] * len(ROUND_KEYS))
            return
        for i, r in enumerate(m["rounds"]):
            x = REP.round_metrics(m, r)
            self.h_rounds.insert("", "end", values=[r.get("label")] + [fmt(x[k]) for k in ROUND_KEYS],
                                 tags=("zebra",) if i % 2 else ())

    def chosen_exp(self):
        exp = self.h_exp.get()
        if exp == "all":
            messagebox.showinfo("Pick an experiment", "Choose one experiment in the filter first.")
            return None
        return exp

    def export_csv(self):
        exp = self.chosen_exp()
        if not exp:
            return
        path = filedialog.asksaveasfilename(defaultextension=".csv", initialfile=f"{exp}-results.csv",
                                            filetypes=[("CSV (Excel)", "*.csv")])
        if not path:
            return
        try:
            out = REP.export_rounds(exp, BC.RESULTS, path=path, decimal_comma=self.h_comma.get())
        except OSError as e:
            messagebox.showerror("Not exported", f"{e}\n\nIs the file open in Excel?")
            return
        messagebox.showinfo("Exported", f"{out}" if out else f"no complete {exp} runs yet")

    def export_tables(self):
        exp = self.chosen_exp()
        if not exp:
            return
        if exp not in REP.EXPS:
            messagebox.showinfo("CSV only", f"{exp} is not an E1–E3 experiment: use the per-round CSV.")
            return
        d = filedialog.askdirectory(title=f"Folder for the {exp} summary tables")
        if d:
            self.report(exp, d, charts=False)

    def gen_charts(self):
        exp = self.chosen_exp()
        if exp and exp in REP.EXPS:
            out = os.path.join(BC.REPO, "docs", "results", exp)
            self.report(exp, out, charts=True)
            self.h_charts.delete(0, "end")
            for p in sorted(glob.glob(os.path.join(out, f"{exp}-*.png"))):
                self.h_charts.insert("end", p)
        elif exp:
            messagebox.showinfo("CSV only", f"{exp} has no aggregated tables/charts (smoke, ramp and custom tests "
                                "stay out of the paper's tables).")

    def report(self, exp, out_dir, charts):
        try:
            REP.build(exp, BC.RESULTS, out_dir=out_dir, charts_on=charts, decimal_comma=self.h_comma.get(),
                      export=False)
        except ValueError as e:
            messagebox.showinfo("No results", str(e))
            return
        messagebox.showinfo("Written", f"mean ± SD tables{' + charts' if charts else ''} in\n{out_dir}")

    def show_chart(self):
        sel = self.h_charts.curselection()
        if sel:
            img = tk.PhotoImage(file=self.h_charts.get(sel[0]))
            self.h_img = img.subsample(2) if img.width() > 1000 else img
            self.h_canvas.configure(image=self.h_img)

    # ------------------------------------------------------------------ jobs: preview -> confirm -> backup -> run
    def begin(self, tag, script, label):
        os.makedirs(LOG_DIR, exist_ok=True)
        if self.logfh:
            self.logfh.close()
        path = os.path.join(LOG_DIR, f"{datetime.datetime.now():%Y%m%d-%H%M%S}-{label}.log")
        self.logfh = open(path, "w", encoding="utf-8")
        self.log_path.set(f"log: {os.path.relpath(path, BC.REPO)}")
        self.tail = []
        self.runner.start(script, tag)
        self.current_tag = tag
        self.p_text.set(f"{label}: running…")
        self.b_cancel.configure(state="normal" if tag in ("preview", "backup", "exp") else "disabled", text="Cancel",
                                image=button_image("cancel"), style="TButton")
        self.cancel_at = None
        self.set_busy(True)

    def idle(self):
        return not self.runner.busy() and not self.job

    def start_run(self, args_fn, resume=False, preview_only=False):
        if not self.idle():
            messagebox.showwarning("Busy", "A benchmark process is already running.")
            return
        if not self.ensure_saved():
            return
        args = args_fn() + (["--resume"] if resume else []) + (["--verbose"] if self.verbose.get() else [])
        self.job = {"args": args, "exp": args[1], "ts": f"{datetime.datetime.now():%Y%m%d-%H%M%S}",
                    "previewOnly": preview_only}
        self.plan_lines = []
        self.begin("preview", BC.experiment_script(args + ["--dry-run"], wipe=False), "preview")

    def confirm_run(self):
        """Modal: the plan + what gets wiped + backup choice. Returns (ok, skip_backup)."""
        dlg = tk.Toplevel(self.root)
        dlg.title(f"Run {self.job['exp']}?")
        dlg.transient(self.root)
        dlg.grab_set()
        txt = scrolledtext.ScrolledText(dlg, width=130, height=24, font=T.FONT_MONO)
        txt.pack(fill="both", expand=True)
        dst = os.path.join(BC.BACKUPS, self.job["ts"])
        prov = "\n".join(f"  {FIELDS[p][0]} = {show_value(BC.get_path(self.sweeps, p))}   "
                         f"[{BC.baseline_provenance(self.text, p)}]" for p in BASELINES)
        reuse = self.job.get("reuse")
        txt.insert("end", "\n".join(self.plan_lines) + "\n\n" + (
                   "REUSE the running ledger: no reset and no backup. The benchmark's transactions are ADDED to the\n"
                   "current ledger (new evidence ids; existing custody trails are untouched but stay next to them).\n\n"
                   if reuse else "")
                   + ("" if reuse else
                   "EVERY run resets the ledger (orderer/peer ledgers, receipt store, verify metrics). The manual-test\n"
                   "custody trails on the ledger are erased; accounts, cases and evidence files are not touched.\n"
                   f"Before the first run the app backs up ALL gleipnir_* volumes to\n  {dst}\n"
                   "and [Restore my test data] puts them back afterwards.\n\n")
                   + f"Baselines used:\n{prov}\n"
                   + ("\n⚠ benchmark/sweeps.yaml has uncommitted changes — commit it so run.json's SHA is citable.\n"
                      if BC.git_dirty() else ""))
        txt.configure(state="disabled")
        skip = tk.BooleanVar(value=False)
        origin = BC.ledger_origin()
        if origin.startswith("benchmark") and not reuse:
            ttk.Checkbutton(dlg, variable=skip, text=f"skip the backup — the ledger already holds benchmark data "
                            f"({origin}); your test data is in an earlier backup").pack(anchor="w", padx=6)
        res = {"ok": False}
        bar = ttk.Frame(dlg)
        bar.pack(fill="x", pady=6)
        ibutton(bar, "Start", "run", lambda: (res.update(ok=True), dlg.destroy()), primary=True).pack(
            side="right", padx=6)
        ttk.Button(bar, text="Cancel", command=dlg.destroy).pack(side="right")
        self.root.wait_window(dlg)
        return res["ok"], skip.get()

    def after_preview(self, rc):
        job = self.job
        if job.get("cancelled"):
            self.job = None
            self.p_text.set("cancelled")
            return
        if rc != 0:
            self.job = None
            messagebox.showerror("Preview failed", "\n".join(self.tail[-20:]))
            return
        if job.get("previewOnly"):
            self.job = None
            self.plan_dialog()
            return
        todo = next((BC.parse_line(ln)["todo"] for ln in self.plan_lines
                     if (BC.parse_line(ln) or {}).get("kind") == "plan"), None)
        if todo == 0:
            self.job = None
            messagebox.showinfo("Nothing to run", "Every run of this plan is already complete (Resume skips them).")
            return
        job["reuse"] = "--reuse-network" in job["args"]
        ok, skip = self.confirm_run()
        if not ok:
            self.job = None
            self.p_text.set("cancelled before start")
            return
        if skip or job["reuse"]:   # reuse-network never resets the ledger: nothing to back up, stack must stay up
            rc, out = BC.run_quick(BC.BUSY_CHECK + "; echo idle")
            if "@@busy" in out:
                self.job = None
                messagebox.showerror("Busy", "Another experiment.py is running in WSL.")
                return
            self.start_experiment()
            return
        job["backupDir"] = os.path.join(BC.BACKUPS, job["ts"])
        os.makedirs(job["backupDir"], exist_ok=True)
        job["backupOk"] = False
        self.begin("backup", BC.backup_script(job["backupDir"]), f"backup-before-{job['exp']}")

    def plan_dialog(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("Plan preview (nothing was run)")
        txt = scrolledtext.ScrolledText(dlg, width=130, height=26, font=T.FONT_MONO)
        txt.pack(fill="both", expand=True)
        txt.insert("end", "\n".join(self.plan_lines))
        txt.configure(state="disabled")

    def start_experiment(self):
        job = self.job
        if not job.get("reuse"):   # a reuse-network run adds to the live ledger but never resets it
            BC.set_ledger_origin(f"benchmark:{job['exp']}@{job['ts']}")
        self.live.delete(*self.live.get_children())
        self.live_rows = {}
        keep_awake(True)
        self.awake.pack(side="right", padx=8)
        self.begin("exp", BC.experiment_script(job["args"], wipe=True), job["exp"])

    def backup_now(self):
        if not self.idle():
            messagebox.showwarning("Busy", "A benchmark process is already running.")
            return
        ts = f"{datetime.datetime.now():%Y%m%d-%H%M%S}"
        if not messagebox.askyesno("Back up now", "The stack stops for about a minute while every gleipnir_* volume "
                                   f"is copied to backups/{ts}, then starts again. Continue?"):
            return
        self.job = {"backupOnly": True, "ts": ts, "backupDir": os.path.join(BC.BACKUPS, ts), "backupOk": False}
        os.makedirs(self.job["backupDir"], exist_ok=True)
        self.begin("backup", BC.backup_script(self.job["backupDir"]), "backup")

    def after_backup(self, rc):
        job = self.job
        if rc == 0 and job.get("backupOk"):
            reason = "manual backup" if job.get("backupOnly") else f"before {job['exp']}"
            BC.mark_backup(job["backupDir"], reason, job["ts"])
            if job.get("cancelled"):
                self.job = {"stackOnly": True}
                self.p_text.set("cancelled — backup kept, restarting the stack (no run was started)")
                self.begin("stackup", BC.stack_up_script(), "stack-up")
                return
            if job.get("backupOnly"):
                self.begin("stackup", BC.stack_up_script(), "stack-up")
                return
            self.start_experiment()
            return
        busy = any("@@busy" in ln for ln in self.tail)
        self.job = None
        messagebox.showerror("Backup failed — nothing was run", "\n".join(self.tail[-20:]))
        if not busy:   # the stack was stopped for the backup: bring it back
            self.job = {"stackOnly": True}
            self.begin("stackup", BC.stack_up_script(), "stack-up")

    def restore(self):
        if not self.idle():
            messagebox.showwarning("Busy", "A benchmark process is already running.")
            return
        backups = BC.list_backups()
        if not backups:
            messagebox.showinfo("No backups", "No complete backup in backups/ yet.")
            return
        dlg = tk.Toplevel(self.root)
        dlg.title("Restore my test data")
        dlg.transient(self.root)
        dlg.grab_set()
        ttk.Label(dlg, text="Every gleipnir_* volume and network/compose/.env are REPLACED by the backup; the stack "
                  "is stopped and started again (no channels are re-created). Benchmark results on disk are kept.",
                  wraplength=700).pack(anchor="w", padx=6, pady=4)
        lb = tk.Listbox(dlg, width=110, height=10)
        lb.pack(padx=6)
        for b in backups:
            lb.insert("end", f"{os.path.basename(b['dir'])}   {b['reason']}   variant={b['variant']}   "
                             f"ledger held: {b['origin']}   {b['sizeMb']} MB")
        lb.selection_set(next((i for i, b in enumerate(backups) if not str(b["origin"]).startswith("benchmark")), 0))
        res = {}
        bar = ttk.Frame(dlg)
        bar.pack(fill="x", pady=6)
        ibutton(bar, "Restore", "restore", lambda: (res.update(i=lb.curselection()), dlg.destroy()),
                primary=True).pack(side="right", padx=6)
        ttk.Button(bar, text="Cancel", command=dlg.destroy).pack(side="right")
        self.root.wait_window(dlg)
        if not res.get("i"):
            return
        b = backups[res["i"][0]]
        self.job = {"restore": b}
        self.begin("restore", BC.restore_script(b["dir"]), "restore")

    def after_restore(self, rc):
        b = self.job["restore"]
        self.job = None
        if rc == 0 and any("@@restore-ok" in ln for ln in self.tail):
            BC.set_ledger_origin(b["origin"])
            messagebox.showinfo("Restored", f"Restored {os.path.basename(b['dir'])} ({b['reason']}).")
        else:
            messagebox.showerror("Restore failed", "\n".join(self.tail[-20:]))
        self.update_status()

    def cancel(self):
        """During Preview / backup: nothing is started afterwards (a finished backup is kept, the stack
        restarted). During a run: SIGINT to the app's own run's process group (Caliper included;
        experiment.py logs the run as failed and Resume picks it up); a click >= 30 s later = SIGKILL.
        Never available during a restore or stack-up (half-replaced volumes are worse than waiting)."""
        if self.job is not None:
            self.job["cancelled"] = True
        if getattr(self, "current_tag", None) != "exp":
            self.b_cancel.configure(state="disabled")
            self.p_text.set("cancel requested — the current step finishes, nothing further is started")
            return
        first = self.cancel_at is None
        if first:
            self.cancel_at = time.time()
        force = not first and time.time() - self.cancel_at >= 30
        threading.Thread(target=BC.run_quick, args=(BC.cancel_script(force=force),), daemon=True).start()
        self.b_cancel.configure(text="Force stop", image=button_image("force-stop"), style="Danger.TButton")
        self.p_text.set("force-stopping (SIGKILL)…" if force else
                        "cancelling (SIGINT)… if it is still running after 30 s, click Force stop")

    def on_close(self):
        if self.runner.busy() and getattr(self, "current_tag", None) in ("backup", "restore", "stackup"):
            messagebox.showwarning("Please wait", "A backup, restore or stack restart is in progress — closing now "
                                   "could leave the stack stopped. Wait for it to finish.")
            return
        if self.runner.busy():
            if not messagebox.askyesno("Quit", "A benchmark process is running. Cancel it and quit? "
                                       "(Resume it later from the same tab.)"):
                return
            BC.run_quick(BC.cancel_script())
        keep_awake(False)
        self.root.destroy()

    # ------------------------------------------------------------------ the output pump
    def poll(self):
        try:
            for _ in range(500):
                tag, what, val = self.runner.q.get_nowait()
                (self.on_line if what == "line" else self.on_exit)(tag, val)
        except queue.Empty:
            pass
        finally:   # anything else reaches on_error through root.report_callback_exception
            self.root.after(100, self.poll)

    def on_line(self, tag, text):
        if self.logfh:
            self.logfh.write(text + "\n")
        self.tail = (self.tail + [text])[-200:]
        ev = BC.parse_line(text)
        kind = ev["kind"] if ev else None
        ltag = {"error": "err", "warn": "warn", "run": "marker", "runstart": "marker", "done": "ok", "complete": "ok",
                "caliper": "muted", "marker": "muted"}.get(kind)
        self.log.insert("end", text + "\n", (ltag,) if ltag else ())
        if int(self.log.index("end-1c").split(".")[0]) > 5000:
            self.log.delete("1.0", "1000.0")
        self.log.see("end")
        if tag == "preview":
            self.plan_lines.append(text)
            return
        if tag == "backup" and ev and kind == "marker" and ev["name"] == "backup-ok" and self.job:
            self.job["backupOk"] = True
        if not ev or tag != "exp":
            return
        if kind == "plan":
            self.p_overall.configure(maximum=max(ev["todo"], 1), value=0)
        elif kind == "run":
            self.p_overall.configure(maximum=ev["n"], value=ev["i"] - 1)
            self.p_text.set(f"run {ev['i']}/{ev['n']} · {ev['pct']} % done · elapsed {ev['elapsed']} · ETA {ev['eta']}")
        elif kind == "runstart":
            self.current_run = ev
        elif kind == "round":
            run = self.current_run or {}
            self.p_round.configure(maximum=max(ev["tx"], 1), value=0)
            self.p_now.set(f"{run.get('runId', '')} · regime {run.get('regime', '')} · round {ev['j']}/{ev['m']} "
                           f"{ev['label']} @ {fmt(ev['sendRate'])} tx/s")
        elif kind == "caliper":
            self.p_round.configure(value=ev["submitted"])
            self.p_now.set(re.sub(r" · Caliper .*$", "", self.p_now.get()) +
                           f" · Caliper submitted {ev['submitted']} · succ {ev['succ']} · fail {ev['fail']} · "
                           f"unfinished {ev['unfinished']}")
        elif kind == "done" and "succ" in ev:
            run_id = (self.current_run or {}).get("runId", "")
            total = ev["succ"] + ev["fail"]
            self.live_row(run_id, ev["label"], [ev["sendRate"], ev["throughput"], ev["latMin"], ev["latMax"],
                                                ev["latAvg"], ev["p95"], None, None, ev["succ"], ev["fail"],
                                                100.0 * ev["fail"] / total if total else None, None, None])
        elif kind == "csv" and self.current_run:
            # collect.py has finished this run: its manifest adds CPU, memory and bytes/event to the live rows
            run_id = self.current_run["runId"]
            m = E.load_json(os.path.join(BC.RESULTS, *run_id.split("/"), "manifest.json"))
            for r in (m or {}).get("rounds", []):
                x = REP.round_metrics(m, r)
                self.live_row(run_id, r.get("label"), [x[k] for k in ROUND_KEYS])
        elif kind == "warn":
            set_chip(self.p_warn, ev["text"], "warning", "Warn.TLabel")
        elif kind == "complete":
            self.p_overall.configure(value=self.p_overall.cget("maximum"))

    def live_row(self, run_id, label, values):
        vals = [label] + [fmt(v) for v in values]
        key = (run_id, label)
        if key in self.live_rows:
            self.live.item(self.live_rows[key], values=vals)
        else:
            self.live_rows[key] = self.live.insert("", "end", text=f" {run_id}", image=marker(variant_of(run_id)) or "",
                                                   values=vals, tags=("zebra",) if len(self.live_rows) % 2 else ())
            self.live.see(self.live_rows[key])

    def on_exit(self, tag, rc):
        if self.logfh:
            self.logfh.close()
            self.logfh = None
        self.b_cancel.configure(state="disabled", text="Cancel", image=button_image("cancel"), style="TButton")
        self.p_text.set(f"{tag} finished (exit {rc})")
        if tag == "preview" and self.job:
            self.after_preview(rc)
        elif tag == "backup" and self.job:
            self.after_backup(rc)
        elif tag == "restore" and self.job:
            self.after_restore(rc)
        elif tag == "stackup":
            self.job = None
            if rc != 0:
                messagebox.showerror("Stack did not come back up", "\n".join(self.tail[-20:]))
        elif tag == "exp":
            keep_awake(False)
            self.awake.pack_forget()
            exp = (self.job or {}).get("exp", "")
            self.job = None
            self.refresh_all()
            if rc == 0:
                messagebox.showinfo("Finished", f"{exp} complete. Results: History & results tab; per-round CSV "
                                    f"benchmark/results/{exp}/{exp}-results.csv. [Restore my test data] brings "
                                    "your manual-test ledger back.")
            else:
                messagebox.showerror(f"{exp} stopped (exit {rc})", "\n".join(self.tail[-20:]) +
                                     "\n\nFix the cause, then Resume from the same tab.")
        self.update_status()
        self.set_busy(not self.idle())


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except tk.TclError:
        pass
    T.apply(root)
    style = ttk.Style(root)
    style.configure("Legend.TLabel", font=T.FONT_BOLD, foreground=T.NOTE)          # suggestion-panel titles
    style.configure("Danger.TButton", font=T.FONT_BOLD, foreground=T.ERROR)        # Force stop
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
