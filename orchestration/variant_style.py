"""VARIANT_STYLE for report.py — look up by variant slug, never by colour-cycle order.

    for v in variants:
        st = VARIANT_STYLE[v]
        ax.errorbar(x, mean[v], yerr=sd[v], label=st["label"], color=st["color"], mfc=st["mfc"],
                    mec=st["mec"], marker=st["marker"], ms=st["ms"], mew=1.5, ls=st["ls"], elinewidth=1)
"""

VARIANT_STYLE = {
    "standard":          dict(label="Standard",          color="#0072B2", mfc="#0072B2", mec="#0072B2", marker="o", ms=6.0, ls="-"),
    "anchoring":         dict(label="Anchoring",         color="#B07A00", mfc="white",   mec="#B07A00", marker="s", ms=6.0, ls=(0, (6, 3))),
    "parallel":          dict(label="Parallel",          color="#009E73", mfc="#009E73", mec="#009E73", marker="^", ms=6.0, ls=(0, (1.5, 1.5))),
    "parallel-anchored": dict(label="Parallel-Anchored", color="#B35C8E", mfc="white",   mec="#B35C8E", marker="D", ms=5.5, ls=(0, (6, 2, 1.5, 2))),
}

REFERENCE_LINE = dict(color="#82796A", ls=(0, (1, 2)), lw=1.0, label="y = x (send rate)")   # E3a diagonal


def saturation_line(ax, x, v):
    """Saturation: successful throughput < 0.9 x configured send rate. Dotted, variant strong colour."""
    st = VARIANT_STYLE[v]
    ax.axvline(x, color=st["color"], ls=(0, (1, 2)), lw=1.0)
    ax.annotate("sat.", (x, 1), xycoords=("data", "axes fraction"), xytext=(2, -10),
                textcoords="offset points", fontsize=7, color=st["color"])


def e1_reference(ax, y, v):
    """E1 '(reference)' lines for Standard and Parallel: long dash, 1pt."""
    st = VARIANT_STYLE[v]
    ax.axhline(y, color=st["color"], ls=(0, (8, 4)), lw=1.0, label=f'{st["label"]} (reference)')
