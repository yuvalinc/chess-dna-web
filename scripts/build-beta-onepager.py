#!/usr/bin/env python3
"""Build the Chess DNA closed-beta one-pager (PDF + PNG)."""

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = "/Users/yuval/Chess-dna"
SHOTS = os.path.join(ROOT, "play-store-assets")
OUT_PDF = os.path.join(ROOT, "Beta-Weekly-2026-05-17.pdf")
OUT_PNG = os.path.join(ROOT, "Beta-Weekly-2026-05-17.png")

# --- US Letter @ 200 DPI ---
W, H = 1700, 2200
M = 90  # margin

# --- Palette ---
BG_TOP = (8, 12, 24)
BG_BOT = (20, 26, 44)
ACCENT = (16, 185, 129)       # emerald
ACCENT_2 = (96, 156, 240)     # cool blue (for "refreshed" badges)
TEXT = (255, 255, 255)
TEXT_DIM = (180, 190, 210)
TEXT_MUTED = (115, 125, 145)
CARD_BG = (24, 30, 48)
CARD_BORDER = (50, 60, 84)
HERO_BORDER = (16, 185, 129)

# --- Fonts ---
def F(weight, size):
    paths_indices = {
        "regular": [("/System/Library/Fonts/HelveticaNeue.ttc", 6),
                    ("/System/Library/Fonts/Helvetica.ttc", 0)],
        "medium":  [("/System/Library/Fonts/HelveticaNeue.ttc", 8),
                    ("/System/Library/Fonts/Helvetica.ttc", 1)],
        "bold":    [("/System/Library/Fonts/HelveticaNeue.ttc", 10),
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


# --- Helpers ---
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


def radial_glow(size, center, radius, color, alpha=140):
    w, h = size
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    cx, cy = center
    steps = 50
    for i in range(steps, 0, -1):
        r = int(radius * (i / steps))
        a = int(alpha * (1 - i / steps) ** 2)
        d.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=(*color, a))
    return glow.filter(ImageFilter.GaussianBlur(radius=radius // 8))


def load_shot(name, w, h, top_crop_pct=0.20, bottom_crop_pct=0.04):
    """Load a screenshot, trim the headline/tagline, then fit to w×h via center-crop."""
    img = Image.open(os.path.join(SHOTS, name)).convert("RGB")
    iw, ih = img.size
    img = img.crop((0, int(ih * top_crop_pct), iw, int(ih * (1 - bottom_crop_pct))))
    scale = w / img.width
    new_h = int(img.height * scale)
    img = img.resize((w, new_h), Image.LANCZOS)
    if new_h > h:
        top = (new_h - h) // 2
        img = img.crop((0, top, w, top + h))
    elif new_h < h:
        pad = (h - new_h) // 2
        bg = Image.new("RGB", (w, h), BG_TOP)
        bg.paste(img, (0, pad))
        img = bg
    return img


def rounded_card(size, fill, radius=24, border=None, border_width=2):
    w, h = size
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=radius, fill=fill)
    if border:
        d.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=radius,
                            outline=border, width=border_width)
    return card


def draw_pill(canvas, xy, text, fg=TEXT, bg=ACCENT, padx=14, pady=7, font=None):
    if font is None:
        font = F("heavy", 18)
    d = ImageDraw.Draw(canvas)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = xy
    pill_w, pill_h = tw + 2 * padx, th + 2 * pady
    pill = Image.new("RGBA", (pill_w + 2, pill_h + 2), (0, 0, 0, 0))
    od = ImageDraw.Draw(pill)
    od.rounded_rectangle([(0, 0), (pill_w, pill_h)],
                         radius=pill_h // 2, fill=bg)
    canvas.paste(pill, (x, y), pill)
    d = ImageDraw.Draw(canvas)
    d.text((x + padx - bbox[0], y + pady - bbox[1]), text, font=font, fill=fg)
    return x + pill_w, y + pill_h


def wrap_text(text, font, max_width, draw):
    words = text.split()
    lines = []
    current = ""
    for w in words:
        trial = (current + " " + w).strip()
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines


def draw_wrapped(canvas, xy, text, font, fill, max_w, line_h=None):
    d = ImageDraw.Draw(canvas)
    lines = wrap_text(text, font, max_w, d)
    if line_h is None:
        bbox = d.textbbox((0, 0), "Ay", font=font)
        line_h = int((bbox[3] - bbox[1]) * 1.35)
    for i, ln in enumerate(lines):
        d.text((xy[0], xy[1] + i * line_h), ln, font=font, fill=fill)
    return xy[1] + len(lines) * line_h


# --- Canvas ---
canvas = vert_gradient((W, H), BG_TOP, BG_BOT).convert("RGBA")
canvas = Image.alpha_composite(canvas, radial_glow((W, H), (260, 240), 720, ACCENT, alpha=70))
canvas = Image.alpha_composite(canvas, radial_glow((W, H), (W - 220, H - 260), 700, ACCENT_2, alpha=45))

d = ImageDraw.Draw(canvas)

# ====================================================================
# Header bar
# ====================================================================
hy = 90
d.ellipse([(M, hy), (M + 22, hy + 22)], fill=ACCENT)
d.text((M + 36, hy - 4), "CHESS DNA", font=F("heavy", 24), fill=TEXT)

right_txt = "CLOSED BETA  ·  WEEK OF MAY 17, 2026"
rfont = F("medium", 18)
rb = d.textbbox((0, 0), right_txt, font=rfont)
d.text((W - M - (rb[2] - rb[0]), hy + 1), right_txt, font=rfont, fill=TEXT_DIM)

d.line([(M, hy + 56), (W - M, hy + 56)], fill=(54, 64, 88), width=2)

# ====================================================================
# Title
# ====================================================================
ty = 200
d.text((M, ty), "Five drops", font=F("heavy", 110), fill=TEXT)
d.text((M, ty + 124), "for the 26.", font=F("heavy", 110), fill=ACCENT)

# Sub
sub = ("You're our closed beta. Here's everything we shipped May 10–17 —")
sub2 = ("go break it, then tell us what to fix.")
d.text((M, ty + 286), sub, font=F("medium", 28), fill=TEXT_DIM)
d.text((M, ty + 326), sub2, font=F("medium", 28), fill=TEXT_DIM)

# ====================================================================
# Stats strip
# ====================================================================
sy = 600
stats = [
    ("26", "beta testers"),
    ("2,837", "games imported"),
    ("4,489", "deep analyses"),
    ("5", "fresh drops"),
]
col_w = (W - 2 * M) // len(stats)
for i, (num, lbl) in enumerate(stats):
    cx = M + col_w * i
    d.text((cx, sy), num, font=F("heavy", 64), fill=ACCENT)
    d.text((cx, sy + 86), lbl.upper(), font=F("medium", 22), fill=TEXT_DIM)

d.line([(M, sy + 140), (W - M, sy + 140)], fill=(54, 64, 88), width=1)

# ====================================================================
# Hero feature (Replays)
# ====================================================================
hero_y = 780
hero_h = 560
hero_w = W - 2 * M

hero_card = rounded_card((hero_w, hero_h), (*CARD_BG, 240),
                         radius=32, border=HERO_BORDER, border_width=3)
canvas.paste(hero_card, (M, hero_y), hero_card)

# Soft inner glow
inner_glow = radial_glow((hero_w, hero_h), (200, hero_h // 2), 480, ACCENT, alpha=40)
canvas.paste(inner_glow, (M, hero_y), inner_glow)

# Screenshot
shot_w, shot_h = 380, hero_h - 60
shot = load_shot("screenshot-3-replay.png", shot_w, shot_h)
shot_x, shot_y = M + 30, hero_y + 30
# Wrap shot in a soft rounded mask
mask = Image.new("L", (shot_w, shot_h), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([(0, 0), (shot_w - 1, shot_h - 1)], radius=20, fill=255)
canvas.paste(shot, (shot_x, shot_y), mask)

# Right column
rx = shot_x + shot_w + 60
ry = hero_y + 50

draw_pill(canvas, (rx, ry), "NEW  ·  FLAGSHIP",
          bg=ACCENT, font=F("heavy", 20))
ry += 62

d = ImageDraw.Draw(canvas)
d.text((rx, ry), "Replays — replay your mistakes.",
       font=F("heavy", 52), fill=TEXT)
ry += 84

lead = ('"You\'ve lost ~116 rating points to missed tactics across 16 games."')
d.text((rx, ry), lead, font=F("medium", 26), fill=ACCENT)
ry += 44

lead2 = "We surface your worst leak, then drop you straight into the positions you blew."
ry = draw_wrapped(canvas, (rx, ry), lead2,
                  F("regular", 24), TEXT_DIM,
                  hero_w - shot_w - 130, line_h=34)
ry += 28

bullets = [
    "Two replay modes — Stockfish at full strength, or a bot that plays your opponent's moves.",
    "Opening-trap detector — 11 named traps (Wayward Queen, Fried Liver, Englund, Halloween…).",
    "Per-pattern impact ranking with Getting-worse / Improving trend arrows.",
]
for b in bullets:
    d.ellipse([(rx, ry + 12), (rx + 14, ry + 26)], fill=ACCENT)
    ry_after = draw_wrapped(canvas, (rx + 30, ry), b,
                            F("medium", 22), TEXT,
                            hero_w - shot_w - 160, line_h=30)
    ry = max(ry_after, ry + 36) + 10

# ====================================================================
# "More this week" divider
# ====================================================================
my = hero_y + hero_h + 40
d = ImageDraw.Draw(canvas)
d.text((M, my), "MORE THIS WEEK", font=F("heavy", 26), fill=ACCENT)
mb = d.textbbox((0, 0), "MORE THIS WEEK", font=F("heavy", 26))
d.line([(M + (mb[2] - mb[0]) + 30, my + 16), (W - M, my + 16)],
       fill=(54, 64, 88), width=2)

# ====================================================================
# 2×2 Grid
# ====================================================================
gy = my + 52
g_gap = 32
g_w = (W - 2 * M - g_gap) // 2
g_h = 280

grid_items = [
    {
        "badge": "REFRESHED",
        "badge_bg": ACCENT_2,
        "title": "8-D Skill Radar",
        "shot": "screenshot-5-radar.png",
        "desc": "Now leads the home screen. Switch between Last Week, Last Month, and All Time — and watch your shape evolve.",
    },
    {
        "badge": "REFRESHED",
        "badge_bg": ACCENT_2,
        "title": "Patterns, ranked",
        "shot": "screenshot-2-patterns.png",
        "desc": "Each weakness now shows an impact bar and a trend arrow. Tap any pattern to drill into the fix plan.",
    },
    {
        "badge": "ENHANCED",
        "badge_bg": ACCENT_2,
        "title": "Sharper game analysis",
        "shot": "screenshot-4-analyze.png",
        "desc": "Better motif detection — opening traps, back-rank mate, mate-in-N, smothered mate, double check.",
    },
    {
        "badge": "NEW",
        "badge_bg": ACCENT,
        "title": "Share your DNA",
        "shot": "screenshot-1-hero.png",
        "desc": "Viral player card · Achievement carousel of personal bests · Tactical-sequence MP4 export for Reels and TikTok.",
    },
]

for i, item in enumerate(grid_items):
    col, row = i % 2, i // 2
    cx_ = M + col * (g_w + g_gap)
    cy_ = gy + row * (g_h + g_gap)

    card = rounded_card((g_w, g_h), (*CARD_BG, 230),
                        radius=24, border=CARD_BORDER, border_width=2)
    canvas.paste(card, (cx_, cy_), card)

    # Screenshot
    s_w, s_h = 220, g_h - 40
    shot = load_shot(item["shot"], s_w, s_h)
    s_mask = Image.new("L", (s_w, s_h), 0)
    smd = ImageDraw.Draw(s_mask)
    smd.rounded_rectangle([(0, 0), (s_w - 1, s_h - 1)], radius=14, fill=255)
    canvas.paste(shot, (cx_ + 20, cy_ + 20), s_mask)

    # Right column
    rcx = cx_ + 20 + s_w + 28
    rcy = cy_ + 32
    draw_pill(canvas, (rcx, rcy), item["badge"],
              bg=item["badge_bg"], padx=12, pady=5, font=F("heavy", 15))
    rcy += 46
    d = ImageDraw.Draw(canvas)
    d.text((rcx, rcy), item["title"], font=F("heavy", 34), fill=TEXT)
    rcy += 58
    draw_wrapped(canvas, (rcx, rcy), item["desc"],
                 F("medium", 21), TEXT_DIM,
                 g_w - s_w - 80, line_h=29)

# ====================================================================
# Footer
# ====================================================================
fy = H - 130
d = ImageDraw.Draw(canvas)
d.line([(M, fy), (W - M, fy)], fill=(54, 64, 88), width=1)
d.text((M, fy + 24),
       "Thanks for being one of our 26. Every bug you file becomes the next build.",
       font=F("medium", 22), fill=TEXT_DIM)
d.text((M, fy + 60),
       "Send feedback in-app (floating green button) — or DM Yuval directly.",
       font=F("regular", 20), fill=TEXT_MUTED)

# Right: URL
url = "chess-dna-fdd5fbde.base44.app"
ub = d.textbbox((0, 0), url, font=F("heavy", 20))
d.text((W - M - (ub[2] - ub[0]), fy + 36), url,
       font=F("heavy", 20), fill=ACCENT)

# ====================================================================
# Save
# ====================================================================
out_rgb = canvas.convert("RGB")
out_rgb.save(OUT_PNG, "PNG", optimize=True)
out_rgb.save(OUT_PDF, "PDF", resolution=200.0)
print(f"Wrote {OUT_PNG} ({os.path.getsize(OUT_PNG) / 1024:.1f} KB)")
print(f"Wrote {OUT_PDF} ({os.path.getsize(OUT_PDF) / 1024:.1f} KB)")
