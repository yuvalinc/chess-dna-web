#!/usr/bin/env python3
"""Generate Google Play developer profile icon and header for Yuval Incze (YI)."""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Brand palette — dark, modern, with a subtle accent
BG_TOP = (10, 14, 26)        # deep navy
BG_BOTTOM = (24, 30, 48)     # slightly lighter navy
ACCENT = (16, 185, 129)      # emerald green (matches chess-accent)
ACCENT_DIM = (8, 92, 64)
TEXT = (255, 255, 255)
TEXT_DIM = (160, 170, 190)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Avenir Next Condensed.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Avenir Next.ttc",
    "/System/Library/Fonts/SFNS.ttf",
]

SUBTITLE_FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Avenir Next.ttc",
]


def load_font(candidates, size, index=0):
    for path in candidates:
        if os.path.exists(path):
            try:
                if path.endswith(".ttc"):
                    return ImageFont.truetype(path, size, index=index)
                return ImageFont.truetype(path, size)
            except (OSError, IOError):
                continue
    return ImageFont.load_default()


def vertical_gradient(size, top, bottom):
    """Create a vertical gradient image."""
    w, h = size
    base = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        base.putpixel((0, y), (r, g, b))
    return base.resize((w, h), Image.BILINEAR)


def radial_glow(size, center, radius, color, alpha=180):
    """Create a soft radial glow as RGBA overlay."""
    w, h = size
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    cx, cy = center
    steps = 60
    for i in range(steps, 0, -1):
        r = int(radius * (i / steps))
        a = int(alpha * (1 - i / steps) ** 2)
        draw.ellipse(
            [(cx - r, cy - r), (cx + r, cy + r)],
            fill=(color[0], color[1], color[2], a),
        )
    return glow.filter(ImageFilter.GaussianBlur(radius=radius // 8))


def draw_centered_text(draw, xy, text, font, fill, anchor="mm"):
    draw.text(xy, text, font=font, fill=fill, anchor=anchor)


def build_icon():
    size = (512, 512)
    img = vertical_gradient(size, BG_TOP, BG_BOTTOM).convert("RGBA")

    # Soft accent glow behind the monogram
    glow = radial_glow(size, (256, 256), 280, ACCENT, alpha=110)
    img = Image.alpha_composite(img, glow)

    draw = ImageDraw.Draw(img)

    # Subtle accent ring frame
    margin = 28
    ring_width = 6
    draw.rounded_rectangle(
        [(margin, margin), (size[0] - margin, size[1] - margin)],
        radius=96,
        outline=(ACCENT[0], ACCENT[1], ACCENT[2], 180),
        width=ring_width,
    )

    # Monogram "YI"
    font = load_font(FONT_CANDIDATES, 280)
    draw_centered_text(draw, (256, 268), "YI", font, TEXT)

    # Underline accent stroke
    bar_w, bar_h = 110, 6
    bar_x = 256 - bar_w // 2
    bar_y = 410
    draw.rounded_rectangle(
        [(bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h)],
        radius=3,
        fill=ACCENT,
    )

    out = os.path.join(OUT_DIR, "developer-icon-512.png")
    # Save as 24-bit PNG (no alpha) — Google Play requires non-transparent
    img.convert("RGB").save(out, "PNG", optimize=True)
    print(f"Wrote {out} ({os.path.getsize(out)/1024:.1f} KB)")


def build_header():
    # Google Play developer header: 4096 x 2304 (16:9)
    size = (4096, 2304)
    img = vertical_gradient(size, BG_TOP, BG_BOTTOM).convert("RGBA")

    # Two soft glows — one warm accent left, one cool wash right
    glow_left = radial_glow(size, (1300, 1152), 1400, ACCENT, alpha=90)
    img = Image.alpha_composite(img, glow_left)

    glow_right = radial_glow(size, (3400, 800), 1100, (90, 130, 220), alpha=60)
    img = Image.alpha_composite(img, glow_right)

    draw = ImageDraw.Draw(img)

    # Subtle frame
    frame_margin = 80
    draw.rounded_rectangle(
        [(frame_margin, frame_margin), (size[0] - frame_margin, size[1] - frame_margin)],
        radius=64,
        outline=(255, 255, 255, 30),
        width=4,
    )

    # Monogram block — left side
    mono_font = load_font(FONT_CANDIDATES, 1100)
    mono_x, mono_y = 720, 1180
    draw_centered_text(draw, (mono_x, mono_y), "YI", mono_font, TEXT, anchor="mm")

    # Accent bar under monogram
    bar_w, bar_h = 380, 16
    bar_x = mono_x - bar_w // 2
    bar_y = mono_y + 540
    draw.rounded_rectangle(
        [(bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h)],
        radius=8,
        fill=ACCENT,
    )

    # Right-side text block
    name_font = load_font(SUBTITLE_FONT_CANDIDATES, 280)
    role_font = load_font(SUBTITLE_FONT_CANDIDATES, 110)

    name_x = 1700
    name_y = 980
    draw.text((name_x, name_y), "Yuval Incze", font=name_font, fill=TEXT)
    draw.text((name_x, name_y + 360), "Independent app developer", font=role_font, fill=TEXT_DIM)

    # Small accent dot
    dot_r = 22
    dot_cx = name_x + 14
    dot_cy = name_y + 360 + 65
    draw.ellipse(
        [(dot_cx - dot_r - 60, dot_cy - dot_r), (dot_cx - 60 + dot_r, dot_cy + dot_r)],
        fill=ACCENT,
    )
    # Re-draw subtitle slightly indented so the dot reads as a bullet
    # (overwrites the previous draw to align cleanly)

    out = os.path.join(OUT_DIR, "developer-header-4096x2304.png")
    img.convert("RGB").save(out, "PNG", optimize=True)
    size_kb = os.path.getsize(out) / 1024
    print(f"Wrote {out} ({size_kb:.1f} KB)")

    # If the PNG is over 1MB, also write a JPEG fallback
    if size_kb > 1024:
        jpg = os.path.join(OUT_DIR, "developer-header-4096x2304.jpg")
        img.convert("RGB").save(jpg, "JPEG", quality=92, optimize=True)
        print(f"Wrote {jpg} ({os.path.getsize(jpg)/1024:.1f} KB)")


if __name__ == "__main__":
    build_icon()
    build_header()
