"""GLEIPNIR Bench theme — named ttk styles replacing the literals in benchapp.pyw.

Call benchtheme.apply(root) in main() right after ttk.Style().theme_use("vista").
Hex values come from gleipnir-design/tokens.json (hybrid: Organic neutrals + brief data colours).
Under vista, Windows draws buttons, checkbuttons, progress bars, notebook tabs and Treeview
headings natively — only Label foregrounds, tk.* widget colours, Treeview tags and images apply.
"""
import tkinter as tk
from tkinter import ttk, font as tkfont

from variant_style import VARIANT_STYLE as VARIANT

TEXT = "#201E1D"          # text.primary        17.0:1 on desk
NOTE = "#474238"          # text.secondary      9.4:1  (replaces #555)
HINT = "#645C50"          # text.muted          6.0:1  (replaces #777, which failed at 3.9:1)
DISABLED = "#A19786"      # text.disabled       exempt
BASELINE = "#2F3E9E"      # info                8.0:1  (replaces #036)
ERROR = "#B42318"         # error               5.8:1  (replaces #b00)
SAVED = "#1B7339"         # success             5.2:1  (replaces #060)
WARN = "#8A5A00"          # warning             5.2:1  (replaces #a60)
SELECT_BG, SELECT_FG = "#8C491A", "#FFFFFF"   # brand.primary, 6.9:1
TIP_BG = "#FFFFE8"
LOG_BG, LOG_MARKER = "#FFFFFF", "#8C491A"
SUBFLOOR_BG = "#FFF4DB"
SMOKE_FG = "#645C50"
ZEBRA = "#F7F5F1"

FONT_UI = ("Segoe UI", 9)
FONT_BOLD = ("Segoe UI", 9, "bold")
FONT_HEADLINE = ("Segoe UI", 10, "bold")
FONT_MONO = ("Consolas", 9)
FONT_HELP = ("Segoe UI", 8, "bold")


def apply(root):
    s = ttk.Style(root)
    for name, spec in (("TkDefaultFont", FONT_UI), ("TkHeadingFont", FONT_BOLD), ("TkFixedFont", FONT_MONO)):
        tkfont.nametofont(name).configure(family=spec[0], size=spec[1])
    s.configure(".", font=FONT_UI, foreground=TEXT)
    s.configure("Headline.TLabel", font=FONT_HEADLINE)
    s.configure("Hint.TLabel", foreground=HINT)
    s.configure("Note.TLabel", foreground=NOTE)
    s.configure("Baseline.TLabel", foreground=BASELINE)
    s.configure("Error.TLabel", foreground=ERROR)
    s.configure("Saved.TLabel", foreground=SAVED)
    s.configure("Warn.TLabel", foreground=WARN)
    s.configure("TLabelframe", padding=8)
    s.configure("TLabelframe.Label", font=FONT_BOLD, foreground=NOTE)
    rh = int(22 * root.winfo_fpixels("1i") / 96)   # 22 px at 96 dpi, scaled with Windows scaling
    s.configure("Treeview", font=FONT_UI, rowheight=rh)
    s.map("Treeview", background=[("selected", SELECT_BG)], foreground=[("selected", SELECT_FG)])
    s.configure("Treeview.Heading", font=FONT_BOLD)
    s.map("TButton", foreground=[("disabled", DISABLED)])
    s.configure("Primary.TButton", font=FONT_BOLD)   # vista ignores background: emphasis = weight + icon + default ring
    s.configure("TNotebook.Tab", padding=[12, 4])


def tag_tree(tree: ttk.Treeview):
    """Row tags for History & results and the live Run table."""
    tree.tag_configure("failed", foreground=ERROR, background="#FDECEA")
    tree.tag_configure("running", foreground=BASELINE)
    tree.tag_configure("smoke", foreground=SMOKE_FG)
    tree.tag_configure("sub-floor", foreground=WARN)
    tree.tag_configure("zebra", background=ZEBRA)


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
    """Canvas spec for the circled '?': 1px ring inset 1px; hover/focus = filled disc, light glyph."""
    canvas.delete("all")
    fill, glyph = (TEXT, "#FFFFFF") if hover else ("", TEXT)
    canvas.create_oval(1, 1, size - 1, size - 1, outline=TEXT, fill=fill, width=1)
    canvas.create_text(size / 2, size / 2 - 0.5, text="?", fill=glyph, font=FONT_HELP)
