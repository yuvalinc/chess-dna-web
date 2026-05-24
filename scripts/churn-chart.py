#!/usr/bin/env python3
"""Render the beta-cohort churn chart from .churn-chart-data.json.

Single panel with dual Y-axes:
  - Left axis  = # of users (0 → cohort size)
  - Right axis = % of cohort (0 → 100%)
  - Grey background bars = ever-activated (cumulative)
  - Green line  = still engaged
  - Amber line  = churned
  - Blue line   = Daily Active Users
"""

import json
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".churn-chart-data.json")
OUT_PNG = os.path.join(ROOT, "Beta-Churn-Chart.png")
OUT_PDF = os.path.join(ROOT, "Beta-Churn-Chart.pdf")

with open(DATA_PATH) as f:
    data = json.load(f)

# Drop the trailing partial day (today) — it's not a fair comparison point.
days     = data["days"][:-1]
dau      = data["dau"][:-1]
ever     = data["everActivated"][:-1]
engaged  = data["stillEngaged"][:-1]
churned  = data["churned"][:-1]
cohort   = data["cohortSize"]
never    = data["neverActivated"]

# --- Canvas ---
W, H = 1900, 2320   # roomier for larger number fonts + stacked-cell table
M = 110

# Palette
BG_TOP    = (8, 12, 24)
BG_BOT    = (20, 26, 44)
GREEN     = (16, 185, 129)
BLUE      = (96, 156, 240)
AMBER     = (245, 158, 11)
GRAY      = (75, 85, 105)
GRAY_BAR  = (60, 70, 92)
TEXT      = (255, 255, 255)
TEXT_DIM  = (180, 190, 210)
TEXT_MUTED = (115, 125, 145)
GRID      = (45, 55, 80)


def F(weight, size):
    paths_indices = {
        "regular": [("/System/Library/Fonts/HelveticaNeue.ttc", 6),
                    ("/System/Library/Fonts/Helvetica.ttc", 0)],
        "medium":  [("/System/Library/Fonts/HelveticaNeue.ttc", 8),
                    ("/System/Library/Fonts/Helvetica.ttc", 1)],
        "heavy":   [("/System/Library/Fonts/HelveticaNeue.ttc", 10),
                    ("/System/Library/Fonts/Helvetica.ttc", 1)],
    }
    for path, idx in paths_indices.get(weight, paths_indices["regular"]):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=idx)
            except Exception:
                continue
    return ImageFont.load_default()


def vert_gradient(size, top, bot):
    w, h = size
    base = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        base.putpixel((0, y), (r, g, b))
    return base.resize((w, h), Image.BILINEAR)


def radial_glow(size, center, radius, color, alpha=80):
    w, h = size
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    d_ = ImageDraw.Draw(glow)
    cx, cy = center
    steps = 50
    for i in range(steps, 0, -1):
        r = int(radius * (i / steps))
        a = int(alpha * (1 - i / steps) ** 2)
        d_.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=(*color, a))
    return glow.filter(ImageFilter.GaussianBlur(radius=radius // 8))


canvas = vert_gradient((W, H), BG_TOP, BG_BOT).convert("RGBA")
canvas = Image.alpha_composite(canvas, radial_glow((W, H), (260, 200), 720, GREEN, alpha=55))
canvas = Image.alpha_composite(canvas, radial_glow((W, H), (W - 220, H - 220), 700, BLUE, alpha=35))
d = ImageDraw.Draw(canvas)

# --- Header ---
hy = 70
d.ellipse([(M, hy), (M + 22, hy + 22)], fill=GREEN)
d.text((M + 36, hy - 4), "CHESS DNA  ·  CHURN ANALYSIS", font=F("heavy", 22), fill=TEXT)
right = "BETA COHORT  ·  GENERATED " + data["generatedAt"][:10]
rb = d.textbbox((0, 0), right, font=F("medium", 18))
d.text((W - M - (rb[2] - rb[0]), hy + 1), right, font=F("medium", 18), fill=TEXT_DIM)
d.line([(M, hy + 50), (W - M, hy + 50)], fill=(54, 64, 88), width=2)

# --- Title ---
ty = 160
d.text((M, ty), f"{cohort - never} of {cohort} ever opened the app —",
       font=F("heavy", 56), fill=TEXT)
d.text((M, ty + 72), f"{churned[-1]} have already gone dark.",
       font=F("heavy", 56), fill=AMBER)

# --- Stat strip ---
sy = 330
last_iso = days[-1]
stats = [
    (str(cohort),           "cohort size",                    TEXT),
    (str(cohort - never),   "ever activated",                 GREEN),
    (str(dau[-1]),          f"active on {last_iso}",          BLUE),
    (str(churned[-1]),      f"churned (silent by {last_iso})", AMBER),
    (str(never),            "never opened",                   GRAY),
]
col_w = (W - 2 * M) // len(stats)
for i, (num, lbl, color) in enumerate(stats):
    cx = M + col_w * i
    d.text((cx, sy), num, font=F("heavy", 80), fill=color)
    d.text((cx, sy + 100), lbl.upper(), font=F("medium", 22), fill=TEXT_DIM)
d.line([(M, sy + 160), (W - M, sy + 160)], fill=(54, 64, 88), width=1)

# --- Single chart with dual Y axes ---
chart_x0 = M + 100  # extra room for left labels (# axis)
chart_y0 = 620
chart_x1 = W - M - 110  # extra room for right labels (% axis)
chart_y1 = chart_y0 + 620
chart_w = chart_x1 - chart_x0
chart_h = chart_y1 - chart_y0

# Y-axis: counts on left, % on right. Both are linear with the same data
# (ratio is cohort / 100) so a single y-projection works for both.
y_max = cohort

def yv(v):
    return int(chart_y1 - (v / y_max) * chart_h)

# Grid + dual labels (left: #, right: %)
left_steps = list(range(0, y_max + 1, max(1, y_max // 6)))
for v in left_steps:
    y = yv(v)
    d.line([(chart_x0, y), (chart_x1, y)], fill=GRID, width=1)
    # Left label: count
    lbl_l = str(v)
    lb = d.textbbox((0, 0), lbl_l, font=F("heavy", 26))
    d.text((chart_x0 - 18 - (lb[2] - lb[0]), y - 16),
           lbl_l, font=F("heavy", 26), fill=TEXT)
    # Right label: %
    pct = round(v / cohort * 100)
    lbl_r = f"{pct}%"
    d.text((chart_x1 + 18, y - 16), lbl_r, font=F("heavy", 26), fill=TEXT)

# Axis captions
d.text((chart_x0 - 90, chart_y0 - 44), "# users",
       font=F("heavy", 22), fill=TEXT_DIM)
right_cap = "% of cohort"
d.text((chart_x1 + 18, chart_y0 - 44), right_cap,
       font=F("heavy", 22), fill=TEXT_DIM)

# Top reference line (cohort = 100%)
yc = yv(cohort)
d.line([(chart_x0, yc), (chart_x1, yc)], fill=GRAY, width=1)

# X-axis: one slot per day
n = len(days)
slot = chart_w / n
bar_w = int(slot * 0.62)
centers = [int(chart_x0 + slot * (i + 0.5)) for i in range(n)]

# Grey background bars: ever-activated
for i, val in enumerate(ever):
    cx = centers[i]
    h = int((val / y_max) * chart_h)
    d.rectangle([(cx - bar_w // 2, chart_y1 - h),
                 (cx + bar_w // 2, chart_y1)], fill=GRAY_BAR)
    # Top-of-bar label: count and %
    pct = round(val / cohort * 100)
    lbl = f"{val}  ·  {pct}%"
    bb = d.textbbox((0, 0), lbl, font=F("heavy", 28))
    d.text((cx - (bb[2] - bb[0]) // 2, chart_y1 - h - 42),
           lbl, font=F("heavy", 28), fill=TEXT)

# X day labels
for i, dlabel in enumerate(days):
    cx = centers[i]
    xlbl = f"Day {i}"
    xlb = d.textbbox((0, 0), xlbl, font=F("heavy", 30))
    d.text((cx - (xlb[2] - xlb[0]) // 2, chart_y1 + 22),
           xlbl, font=F("heavy", 30), fill=TEXT)
    iso = dlabel[5:]
    ib = d.textbbox((0, 0), iso, font=F("medium", 22))
    d.text((cx - (ib[2] - ib[0]) // 2, chart_y1 + 64),
           iso, font=F("medium", 22), fill=TEXT_DIM)

# Lines on top
line_series = [
    ("Still engaged", GREEN, engaged),
    ("Churned",       AMBER, churned),
    ("DAU",           BLUE,  dau),
]


# Lines + dots only — per-dot value labels removed (read from the table below).
for (name, color, values) in line_series:
    pts = [(centers[i], yv(values[i])) for i in range(n)]
    for i in range(1, len(pts)):
        d.line([pts[i - 1], pts[i]], fill=color, width=6)
    for (cx, cy) in pts:
        d.ellipse([(cx - 11, cy - 11), (cx + 11, cy + 11)], fill=color)
        d.ellipse([(cx - 6, cy - 6), (cx + 6, cy + 6)], fill=BG_TOP)

# --- Legend (right under the chart) ---
ly = chart_y1 + 130
items = [
    (GRAY_BAR, "Ever activated (cumulative, grey bars)"),
    (GREEN,    "Still engaged (last event ≥ this day)"),
    (AMBER,    "Churned (activated but went silent)"),
    (BLUE,     "Daily Active Users"),
]
lx = M
for (col, lbl) in items:
    d.rectangle([(lx, ly + 8), (lx + 30, ly + 32)], fill=col)
    d.text((lx + 42, ly + 4), lbl, font=F("medium", 22), fill=TEXT_DIM)
    lb = d.textbbox((0, 0), lbl, font=F("medium", 22))
    lx += 42 + (lb[2] - lb[0]) + 40

# --- Data table (same data as the chart) ---
def fmt_cell(v, pct=False):
    if pct:
        return f"{round(v / cohort * 100)}%"
    return str(v)

table_y0 = ly + 90
header_h = 70
col_label_w = 400
data_col_w = (W - 2 * M - col_label_w) // len(days)

# Table header strip
d.rectangle([(M, table_y0), (W - M, table_y0 + header_h)], fill=(30, 38, 58))
d.text((M + 24, table_y0 + 22), "Metric", font=F("heavy", 24), fill=TEXT)
for i, day_iso in enumerate(days):
    cx = M + col_label_w + data_col_w * i + data_col_w // 2
    head = f"Day {i}"
    sub  = day_iso[5:]
    hb = d.textbbox((0, 0), head, font=F("heavy", 26))
    d.text((cx - (hb[2] - hb[0]) // 2, table_y0 + 8),
           head, font=F("heavy", 26), fill=TEXT)
    sb = d.textbbox((0, 0), sub, font=F("medium", 18))
    d.text((cx - (sb[2] - sb[0]) // 2, table_y0 + 42),
           sub, font=F("medium", 18), fill=TEXT_DIM)

# Table rows — each cell shows count on top, % stacked underneath
row_h = 96  # taller to fit two stacked lines comfortably
rows = [
    ("Ever activated",     GRAY_BAR, ever),
    ("Still engaged",      GREEN,    engaged),
    ("Churned",            AMBER,    churned),
    ("Daily Active Users", BLUE,     dau),
]
for ri, (label, color, values) in enumerate(rows):
    ry = table_y0 + header_h + ri * row_h
    # Alt-row stripe
    if ri % 2 == 0:
        d.rectangle([(M, ry), (W - M, ry + row_h)], fill=(22, 28, 44))
    # Color swatch + label (vertically centered)
    d.rectangle([(M + 18, ry + 30), (M + 42, ry + row_h - 30)], fill=color)
    d.text((M + 58, ry + 30), label, font=F("heavy", 26), fill=TEXT)
    # Per-day cells: count on top, % below
    for i in range(len(days)):
        cx = M + col_label_w + data_col_w * i + data_col_w // 2
        count_lbl = str(values[i])
        pct_lbl = f"{round(values[i] / cohort * 100)}%"
        cb = d.textbbox((0, 0), count_lbl, font=F("heavy", 32))
        pb = d.textbbox((0, 0), pct_lbl, font=F("medium", 22))
        d.text((cx - (cb[2] - cb[0]) // 2, ry + 10),
               count_lbl, font=F("heavy", 32), fill=TEXT)
        d.text((cx - (pb[2] - pb[0]) // 2, ry + 56),
               pct_lbl, font=F("medium", 22), fill=TEXT_DIM)

# Table border
table_y1 = table_y0 + header_h + row_h * len(rows)
d.rectangle([(M, table_y0), (W - M, table_y1)],
            outline=(54, 64, 88), width=2)
# Vertical separators
for i in range(len(days) + 1):
    x = M + col_label_w + data_col_w * i
    d.line([(x, table_y0), (x, table_y1)], fill=(54, 64, 88), width=1)
d.line([(M + col_label_w, table_y0), (M + col_label_w, table_y1)],
       fill=(54, 64, 88), width=2)

# Footer
fy = H - 60
note = (
    f"Cohort = 26 BetaTester rows minus yuval.inc@gmail.com & capsule.stands@gmail.com  ·  "
    f"\"Day D\" = UTC date.  Today ({data['todayIso']}) excluded — partial day."
)
d.text((M, fy), note, font=F("regular", 18), fill=TEXT_MUTED)

# --- Save (PNG + PDF for zoomable viewing) ---
out_rgb = canvas.convert("RGB")
out_rgb.save(OUT_PNG, "PNG", optimize=True)
out_rgb.save(OUT_PDF, "PDF", resolution=200.0)
print(f"Wrote {OUT_PNG} ({os.path.getsize(OUT_PNG) / 1024:.1f} KB)")
print(f"Wrote {OUT_PDF} ({os.path.getsize(OUT_PDF) / 1024:.1f} KB)")
