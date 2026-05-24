#!/usr/bin/env python3
"""Chess DNA closed-beta weekly one-pager — Hebrew RTL edition."""

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from bidi.algorithm import get_display

ROOT = "/Users/yuval/Chess-dna"
SHOTS = "/tmp/chessdna-shots"
OUT_PDF = os.path.join(ROOT, "Beta-Weekly-2026-05-17-HE.pdf")
OUT_PNG = os.path.join(ROOT, "Beta-Weekly-2026-05-17-HE.png")

# US Letter @ 200 DPI
W, H = 1700, 2200
M = 90  # margin

# Palette
BG_TOP = (8, 12, 24)
BG_BOT = (20, 26, 44)
ACCENT = (16, 185, 129)        # emerald
ACCENT_2 = (96, 156, 240)      # cool blue
ACCENT_3 = (255, 170, 80)      # amber (fixes)
TEXT = (255, 255, 255)
TEXT_DIM = (180, 190, 210)
TEXT_MUTED = (115, 125, 145)
CARD_BG = (24, 30, 48)
CARD_BORDER = (50, 60, 84)
HERO_BORDER = (16, 185, 129)


# ─────────────────────────────────────────────────────────────────────
# Fonts — Arial Hebrew (Regular 0, Bold 1, Light 2)
# ─────────────────────────────────────────────────────────────────────
def F(weight, size):
    path = "/System/Library/Fonts/ArialHB.ttc"
    idx = {"light": 2, "regular": 0, "medium": 0, "bold": 1, "heavy": 1}.get(weight, 0)
    try:
        return ImageFont.truetype(path, size, index=idx)
    except Exception:
        return ImageFont.load_default()


def heb(text):
    """Convert logical Hebrew text to visual order for PIL."""
    return get_display(text)


# ─────────────────────────────────────────────────────────────────────
# Drawing helpers
# ─────────────────────────────────────────────────────────────────────
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
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    cx, cy = center
    steps = 50
    for i in range(steps, 0, -1):
        r = int(radius * (i / steps))
        a = int(alpha * (1 - i / steps) ** 2)
        d.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=(*color, a))
    return glow.filter(ImageFilter.GaussianBlur(radius=radius // 8))


def load_shot(path, target_w, target_h, top_crop=0.0, bottom_crop=0.0):
    """Load a real-app screenshot. Optionally crop top/bottom, then fit w×h center-cropped."""
    img = Image.open(path).convert("RGB")
    iw, ih = img.size
    if top_crop or bottom_crop:
        img = img.crop((0, int(ih * top_crop), iw, int(ih * (1 - bottom_crop))))
    scale = target_w / img.width
    new_h = int(img.height * scale)
    img = img.resize((target_w, new_h), Image.LANCZOS)
    if new_h > target_h:
        top = (new_h - target_h) // 2
        img = img.crop((0, top, target_w, top + target_h))
    elif new_h < target_h:
        pad = (target_h - new_h) // 2
        bg = Image.new("RGB", (target_w, target_h), BG_TOP)
        bg.paste(img, (0, pad))
        img = bg
    return img


def rounded_card(size, fill, radius=24, border=None, border_width=2):
    w, h = size
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=radius, fill=fill)
    if border:
        d.rounded_rectangle([(0, 0), (w - 1, h - 1)],
                            radius=radius, outline=border, width=border_width)
    return card


def measure(draw, text, font):
    """Return (width, height) of rendered text."""
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def text_right(canvas, right_x, y, text, font, fill, is_hebrew=True):
    """Draw text right-anchored at right_x. Returns rendered width."""
    d = ImageDraw.Draw(canvas)
    s = heb(text) if is_hebrew else text
    tw, _ = measure(d, s, font)
    d.text((right_x - tw, y), s, font=font, fill=fill)
    return tw


def text_left(canvas, left_x, y, text, font, fill, is_hebrew=False):
    d = ImageDraw.Draw(canvas)
    s = heb(text) if is_hebrew else text
    d.text((left_x, y), s, font=font, fill=fill)


def text_center(canvas, cx, y, text, font, fill, is_hebrew=True):
    d = ImageDraw.Draw(canvas)
    s = heb(text) if is_hebrew else text
    tw, _ = measure(d, s, font)
    d.text((cx - tw // 2, y), s, font=font, fill=fill)


def pill_right(canvas, right_x, y, text, fg=TEXT, bg=ACCENT,
               padx=14, pady=7, font=None, is_hebrew=True):
    """Draw a pill badge with text, right-anchored."""
    if font is None:
        font = F("bold", 18)
    d = ImageDraw.Draw(canvas)
    s = heb(text) if is_hebrew else text
    tw, th = measure(d, s, font)
    pill_w, pill_h = tw + 2 * padx, th + 2 * pady
    pill = Image.new("RGBA", (pill_w + 2, pill_h + 2), (0, 0, 0, 0))
    od = ImageDraw.Draw(pill)
    od.rounded_rectangle([(0, 0), (pill_w, pill_h)],
                         radius=pill_h // 2, fill=bg)
    px = right_x - pill_w
    canvas.paste(pill, (px, y), pill)
    d = ImageDraw.Draw(canvas)
    bbox = d.textbbox((0, 0), s, font=font)
    d.text((px + padx - bbox[0], y + pady - bbox[1]), s, font=font, fill=fg)


def wrap_logical(text, font, max_width, draw):
    """Word-wrap logical Hebrew text. Returns list of logical-order lines."""
    words = text.split()
    lines = []
    current = ""
    for w in words:
        trial = (current + " " + w).strip()
        bbox = draw.textbbox((0, 0), heb(trial), font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines


def draw_wrapped_right(canvas, right_x, y, text, font, fill, max_w, line_h=None):
    d = ImageDraw.Draw(canvas)
    lines = wrap_logical(text, font, max_w, d)
    if line_h is None:
        _, lh = measure(d, "אבגה", font)
        line_h = int(lh * 1.55)
    for i, ln in enumerate(lines):
        text_right(canvas, right_x, y + i * line_h, ln, font, fill)
    return y + len(lines) * line_h


# ─────────────────────────────────────────────────────────────────────
# Canvas
# ─────────────────────────────────────────────────────────────────────
canvas = vert_gradient((W, H), BG_TOP, BG_BOT).convert("RGBA")
canvas = Image.alpha_composite(canvas, radial_glow((W, H), (W - 260, 240), 760, ACCENT, alpha=70))
canvas = Image.alpha_composite(canvas, radial_glow((W, H), (220, H - 280), 700, ACCENT_2, alpha=45))


# ─────────────────────────────────────────────────────────────────────
# Header bar  (brand RIGHT, date LEFT — RTL mirror)
# ─────────────────────────────────────────────────────────────────────
d = ImageDraw.Draw(canvas)
hy = 90
# Brand on the RIGHT
d.ellipse([(W - M - 22, hy), (W - M, hy + 22)], fill=ACCENT)
text_right(canvas, W - M - 36, hy - 4, "CHESS DNA", F("bold", 24), TEXT, is_hebrew=False)
# Closed-beta tag on the LEFT
text_left(canvas, M, hy + 1, "CLOSED BETA  ·  17 MAY 2026", F("regular", 18), TEXT_DIM, is_hebrew=False)
# Divider
d.line([(M, hy + 56), (W - M, hy + 56)], fill=(54, 64, 88), width=2)


# ─────────────────────────────────────────────────────────────────────
# Title  (right-aligned to the right margin)
# ─────────────────────────────────────────────────────────────────────
ty = 200
text_right(canvas, W - M, ty, "חמש בשורות", F("heavy", 110), TEXT)
text_right(canvas, W - M, ty + 124, "ל-26 הביטא שלנו.", F("heavy", 110), ACCENT)

sub_y = ty + 280
text_right(canvas, W - M, sub_y,
           "אתם הביטא הסגורה. כל מה שדרופנו השבוע —",
           F("medium", 28), TEXT_DIM)
text_right(canvas, W - M, sub_y + 42,
           "תשחקו, תשברו, ותגידו לנו מה חסר.",
           F("medium", 28), TEXT_DIM)


# ─────────────────────────────────────────────────────────────────────
# 1️⃣  Beta in numbers  (small heading + 4 stat columns)
# ─────────────────────────────────────────────────────────────────────
text_right(canvas, W - M, 580, "1.  הביטא במספרים", F("heavy", 32), ACCENT)
d = ImageDraw.Draw(canvas)
d.line([(M, 624), (W - M - 360, 624)], fill=(54, 64, 88), width=1)

sy = 660
# Order columns RIGHT → LEFT so the first stat sits on the right (the "leading" side)
stats = [
    ("26",    "בודקי ביטא"),
    ("2,837", "משחקים יובאו"),
    ("4,489", "ניתוחים עמוקים"),
    ("5",     "חידושים השבוע"),
]
content_w = W - 2 * M
col_w = content_w / len(stats)
for i, (num, lbl) in enumerate(stats):
    # i=0 → rightmost column
    col_right = (W - M) - i * col_w
    col_center = col_right - col_w / 2
    text_center(canvas, col_center, sy, num, F("heavy", 64), ACCENT, is_hebrew=False)
    text_center(canvas, col_center, sy + 88, lbl, F("medium", 22), TEXT_DIM)


# ─────────────────────────────────────────────────────────────────────
# 2️⃣  HERO — Replay & analysis vs engine OR opponent-bot
# ─────────────────────────────────────────────────────────────────────
hero_y = 830
hero_h = 580
hero_w = W - 2 * M

card = rounded_card((hero_w, hero_h), (*CARD_BG, 240),
                    radius=32, border=HERO_BORDER, border_width=3)
canvas.paste(card, (M, hero_y), card)
# Soft inner glow on right (where the screenshot will sit)
g = radial_glow((hero_w, hero_h), (hero_w - 220, hero_h // 2), 520, ACCENT, alpha=42)
canvas.paste(g, (M, hero_y), g)

# Screenshot on the RIGHT (RTL leading side)
shot_w, shot_h = 380, hero_h - 60
shot = load_shot(os.path.join(SHOTS, "p4-replays-0.png"),
                 shot_w, shot_h, top_crop=0.0, bottom_crop=0.04)
shot_x = M + hero_w - 30 - shot_w
shot_y = hero_y + 30
mask = Image.new("L", (shot_w, shot_h), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    [(0, 0), (shot_w - 1, shot_h - 1)], radius=20, fill=255)
canvas.paste(shot, (shot_x, shot_y), mask)

# Right column for content = the LEFT half of the hero card
content_right = shot_x - 50
content_left = M + 30
content_top = hero_y + 50

# Badge "חדש · דגל" right-anchored
pill_right(canvas, content_right, content_top, "חדש  ·  פיצ׳ר דגל",
           bg=ACCENT, font=F("bold", 20))

ry = content_top + 64
text_right(canvas, content_right, ry, "2.  ריפליי + אימון",
           F("heavy", 26), TEXT_MUTED)
ry += 44

# Title (two lines)
text_right(canvas, content_right, ry, "ריפליי מול מנוע —", F("heavy", 56), TEXT)
text_right(canvas, content_right, ry + 70, "או יריב ברמתך.", F("heavy", 56), TEXT)
ry += 162

# Lead quote
lead = '"הפסדת ~116 נקודות דירוג להחמצות טקטיות ב-16 משחקים."'
text_right(canvas, content_right, ry, lead, F("bold", 24), ACCENT)
ry += 50

# Bullets (Hebrew)
bullets = [
    "שני מצבי משחק: מנוע (Stockfish במלוא העוצמה) או יריב — בוט שמשחק את המהלכים של היריב המקורי.",
    "ברגע שאתם יוצאים מהקווים, הבוט יורד לרמת הרייטינג של היריב — לא להביס אתכם, לאתגר אתכם.",
    "החזרת ההלכים מתחילה מהדפוס הכי יקר שלכם — תקנו את הדליפה הכבדה קודם, לא את הזעירה.",
]
content_w_text = content_right - content_left
for b in bullets:
    # Dot bullet on the RIGHT side (RTL marker)
    d = ImageDraw.Draw(canvas)
    d.ellipse([(content_right - 12, ry + 14), (content_right, ry + 26)], fill=ACCENT)
    # Wrap and right-align text, but leave room for the dot
    end_y = draw_wrapped_right(canvas, content_right - 26, ry, b,
                               F("medium", 22), TEXT,
                               content_w_text - 30, line_h=32)
    ry = max(end_y, ry + 36) + 8


# ─────────────────────────────────────────────────────────────────────
# "More this week" section header  →  "עוד מהשבוע"
# ─────────────────────────────────────────────────────────────────────
sec_y = hero_y + hero_h + 40
text_right(canvas, W - M, sec_y, "עוד מהשבוע", F("heavy", 28), ACCENT)
d = ImageDraw.Draw(canvas)
d.line([(M, sec_y + 16), (W - M - 220, sec_y + 16)], fill=(54, 64, 88), width=2)


# ─────────────────────────────────────────────────────────────────────
# 3-card row  (#3 traps, #4 share cards, #5 fixes)
# Order: cards flow RIGHT-TO-LEFT (first card on right)
# ─────────────────────────────────────────────────────────────────────
gy = sec_y + 60
g_gap = 30
g_w = (content_w - 2 * g_gap) // 3
g_h = 540

# Grid items in display order (right-to-left)
grid_items = [
    {
        "num": "3",
        "badge": "חדש",
        "badge_bg": ACCENT,
        "title_l1": "מלכודות פתיחה",
        "title_l2": "— כדפוסים.",
        "shot": "p8-patterns-0.png",
        "top_crop": 0.02,
        "desc": ("11 מלכודות מזוהות אוטומטית (Wayward Queen, Fried Liver, "
                 "Englund, Halloween…). נכנסות לרשימת הדפוסים שלכם עם דירוג "
                 "השפעה ומגמה — תרגלו יציאה ממה שאתם נופלים אליו."),
    },
    {
        "num": "4",
        "badge": "חדש",
        "badge_bg": ACCENT,
        "title_l1": "כרטיסי הילייטס",
        "title_l2": "לשיתוף.",
        "shot": "p6-achievement-carousel-0.png",
        "top_crop": 0.04,
        "desc": ("האפליקציה מזהה אוטומטית שיא אישי — דיוק מקסימלי, "
                 "ניצחון מול היריב הכי חזק, הכי הרבה מבריקים, ניצחון הכי קצר — "
                 "והופכת אותו לכרטיס Instagram Story מוכן בלחיצה."),
    },
    {
        "num": "5",
        "badge": "תיקונים",
        "badge_bg": ACCENT_3,
        "title_l1": "באגים שיצאו",
        "title_l2": "מהשבוע.",
        "shot": "p7-skill-radar-0.png",
        "top_crop": 0.0,
        "desc": ("הסברי AI שנחתכו באמצע — מוצגים שלמים. "
                 "טעינת משחקים מהירה יותר. "
                 "תיקוני RTL נרחבים בעברית — מונחים, יישור, ולוח שמתנהג נכון."),
    },
]

# Place cards right-to-left
for i, item in enumerate(grid_items):
    cx_right = (W - M) - i * (g_w + g_gap)
    cx_left = cx_right - g_w
    cy = gy

    card = rounded_card((g_w, g_h), (*CARD_BG, 232),
                        radius=24, border=CARD_BORDER, border_width=2)
    canvas.paste(card, (cx_left, cy), card)

    # Screenshot — top half of card
    s_w = g_w - 40
    s_h = 320
    shot = load_shot(os.path.join(SHOTS, item["shot"]),
                     s_w, s_h, top_crop=item["top_crop"])
    s_mask = Image.new("L", (s_w, s_h), 0)
    ImageDraw.Draw(s_mask).rounded_rectangle(
        [(0, 0), (s_w - 1, s_h - 1)], radius=14, fill=255)
    canvas.paste(shot, (cx_left + 20, cy + 20), s_mask)

    # Bottom: badge + numbered title
    bx = cx_right - 20
    by = cy + 360
    pill_right(canvas, bx, by, item["badge"],
               bg=item["badge_bg"], padx=12, pady=5, font=F("bold", 16))

    by += 44
    # Number prefix (small, dim)
    text_right(canvas, bx, by, f'{item["num"]}.', F("heavy", 22), TEXT_MUTED, is_hebrew=False)
    # Title two lines
    text_right(canvas, bx, by + 30, item["title_l1"], F("heavy", 32), TEXT)
    text_right(canvas, bx, by + 70, item["title_l2"], F("heavy", 32), TEXT)

    # Description (wrapped, right-aligned)
    desc_y = by + 122
    draw_wrapped_right(canvas, bx, desc_y, item["desc"],
                       F("medium", 19), TEXT_DIM,
                       g_w - 40, line_h=28)


# ─────────────────────────────────────────────────────────────────────
# Footer
# ─────────────────────────────────────────────────────────────────────
fy = H - 120
d = ImageDraw.Draw(canvas)
d.line([(M, fy), (W - M, fy)], fill=(54, 64, 88), width=1)

# Right: thank-you
text_right(canvas, W - M, fy + 22,
           "תודה שאתם אחד מ-26. כל באג שאתם שולחים = הבילד הבא.",
           F("medium", 22), TEXT_DIM)
text_right(canvas, W - M, fy + 60,
           "פידבק — כפתור ירוק צף בתוך האפליקציה, או הודעה ליובל.",
           F("regular", 20), TEXT_MUTED)

# Left: URL
text_left(canvas, M, fy + 36, "chess-dna-fdd5fbde.base44.app",
          F("bold", 20), ACCENT, is_hebrew=False)


# ─────────────────────────────────────────────────────────────────────
# Save
# ─────────────────────────────────────────────────────────────────────
out = canvas.convert("RGB")
out.save(OUT_PNG, "PNG", optimize=True)
out.save(OUT_PDF, "PDF", resolution=200.0)
print(f"Wrote {OUT_PNG} ({os.path.getsize(OUT_PNG) / 1024:.1f} KB)")
print(f"Wrote {OUT_PDF} ({os.path.getsize(OUT_PDF) / 1024:.1f} KB)")
