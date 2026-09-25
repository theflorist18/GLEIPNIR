"""GLEIPNIR Bench theme — named ttk styles replacing the literals in benchapp.pyw.

Call benchtheme.apply(root) in main() right after ttk.Style().theme_use("vista").
Hex values come from gleipnir-design/tokens.json (hybrid: Organic neutrals + brief data colours).
Under vista, Windows draws buttons, checkbuttons, progress bars, notebook tabs and Treeview
headings natively — only Label foregrounds, tk.* widget colours, Treeview tags and images apply.
"""
import tkinter as tk
from tkinter import ttk, font as tkfont

DESK = "#F0F0F0"          # native vista ground — never recoloured
TEXT = "#201E1D"          # text.primary        17.0:1 on desk
NOTE = "#474238"          # text.secondary      9.4:1  (replaces #555)
HINT = "#645C50"          # text.muted          6.0:1  (replaces #777, which failed at 3.9:1)
DISABLED = "#A19786"      # text.disabled       exempt
BASELINE = "#2F3E9E"      # info                8.0:1  (replaces #036)
ERROR = "#B42318"         # error               5.8:1  (replaces #b00)
SAVED = "#1B7339"         # success             5.2:1  (replaces #060)
WARN = "#8A5A00"          # warning             5.2:1  (replaces #a60)
SELECT_BG, SELECT_FG = "#8C491A", "#FFFFFF"   # brand.primary, 6.9:1
TIP_BG, TIP_BORDER = "#FFFFE8", "#201E1D"
LOG_BG, LOG_MARKER = "#FFFFFF", "#8C491A"
STEADY_BG, STEADY_FG = "#2E2B25", "#F9F4ED"
SUBFLOOR_BG, SUBFLOOR_FG = "#FFF4DB", "#8A5A00"
SMOKE_FG = "#645C50"
ZEBRA = "#F7F5F1"

VARIANT = {  # exact display names; marker PNGs in gleipnir-design/desktop/icons/
    "standard": dict(label="Standard", color="#0072B2", ink="#0072B2", marker="viz-variant-marker-standard"),
    "anchoring": dict(label="Anchoring", color="#B07A00", ink="#8A5E00", marker="viz-variant-marker-anchoring"),
    "parallel": dict(label="Parallel", color="#009E73", ink="#00785A", marker="viz-variant-marker-parallel"),
    "parallel-anchored": dict(label="Parallel-Anchored", color="#B35C8E", ink="#9E4A7B", marker="viz-variant-marker-parallel-anchored"),
}

FONT_UI = ("Segoe UI", 9)
FONT_BOLD = ("Segoe UI", 9, "bold")
FONT_HEADLINE = ("Segoe UI", 10, "bold")
FONT_TITLE = ("Segoe UI Semibold", 12)
FONT_MONO = ("Consolas", 9)
FONT_HELP = ("Segoe UI", 8, "bold")


def scale(root) -> float:
    """1.0 at 96 dpi, 1.25 / 1.5 / 2.0 at Windows scaling. Pick icon size: 16 * scale -> 16/24/32 set."""
    return root.winfo_fpixels("1i") / 96.0


def icon_size(root) -> int:
    s = scale(root)
    return 32 if s >= 1.75 else 24 if s >= 1.25 else 16


def apply(root):
    s = ttk.Style(root)
    for name, spec in (("TkDefaultFont", FONT_UI), ("TkHeadingFont", FONT_BOLD), ("TkFixedFont", FONT_MONO)):
        try:
            tkfont.nametofont(name).configure(family=spec[0], size=spec[1])
        except tk.TclError:
            pass
    s.configure(".", font=FONT_UI, foreground=TEXT)
    s.configure("Headline.TLabel", font=FONT_HEADLINE)
    s.configure("Title.TLabel", font=FONT_TITLE)
    s.configure("Hint.TLabel", foreground=HINT)
    s.configure("Note.TLabel", foreground=NOTE)
    s.configure("Baseline.TLabel", foreground=BASELINE)
    s.configure("Error.TLabel", foreground=ERROR)
    s.configure("Saved.TLabel", foreground=SAVED)
    s.configure("Warn.TLabel", foreground=WARN)
    s.configure("Regime.Steady.TLabel", background=STEADY_BG, foreground=STEADY_FG, padding=(6, 1))
    s.configure("Regime.SubFloor.TLabel", background=SUBFLOOR_BG, foreground=SUBFLOOR_FG, padding=(6, 1))
    s.configure("Regime.Smoke.TLabel", foreground=SMOKE_FG, padding=(6, 1))
    s.configure("TLabelframe", padding=8)
    s.configure("TLabelframe.Label", font=FONT_BOLD, foreground=NOTE)
    rh = int(22 * scale(root))
    s.configure("Treeview", font=FONT_UI, rowheight=rh)
    s.map("Treeview", background=[("selected", SELECT_BG)], foreground=[("selected", SELECT_FG)])
    s.configure("Treeview.Heading", font=FONT_BOLD)
    s.map("TButton", foreground=[("disabled", DISABLED)])
    s.configure("Primary.TButton", font=FONT_BOLD)   # vista ignores background: emphasis = weight + icon + default ring
    s.configure("TNotebook.Tab", padding=[12, 4])


def tag_tree(tree: ttk.Treeview):
    """Row tags for History & results and the live Run table."""
    tree.tag_configure("complete", foreground=SAVED)
    tree.tag_configure("failed", foreground=ERROR, background="#FDECEA")
    tree.tag_configure("running", foreground=BASELINE)
    tree.tag_configure("smoke", foreground=SMOKE_FG)
    tree.tag_configure("sub-floor", foreground=WARN)
    tree.tag_configure("zebra", background=ZEBRA)
    tree.tag_configure("unhealthy", background="#FFF4DB")


def style_log(text: tk.Text):
    text.configure(font=FONT_MONO, background=LOG_BG, foreground=TEXT, insertbackground=TEXT)
    text.tag_configure("err", foreground=ERROR)
    text.tag_configure("warn", foreground=WARN)
    text.tag_configure("ok", foreground=SAVED)
    text.tag_configure("muted", foreground=HINT)
    text.tag_configure("marker", foreground=LOG_MARKER, font=(FONT_MONO[0], FONT_MONO[1], "bold"))


def tooltip_label(parent, text) -> tk.Label:
    return tk.Label(parent, text=text, justify="left", background=TIP_BG, foreground=TEXT,
                    relief="solid", borderwidth=1, font=FONT_UI, padx=8, pady=6, wraplength=420)


def draw_help_icon(canvas: tk.Canvas, size: int, hover: bool = False):
    """Canvas spec for the circled '?': 1px ring inset 1px (1.25px at 20px); hover/focus = filled disc, light glyph."""
    canvas.delete("all")
    w = 1 if size < 20 else 1.25
    if hover:
        canvas.create_oval(1, 1, size - 1, size - 1, outline=TEXT, fill=TEXT, width=w)
        canvas.create_text(size / 2, size / 2 - 0.5, text="?", fill="#FFFFFF", font=FONT_HELP)
    else:
        canvas.create_oval(1, 1, size - 1, size - 1, outline=TEXT, width=w)
        canvas.create_text(size / 2, size / 2 - 0.5, text="?", fill=TEXT, font=FONT_HELP)
