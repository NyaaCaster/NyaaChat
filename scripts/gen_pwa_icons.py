#!/usr/bin/env python3
"""Generate the NyaaChat PWA launcher icons (192x192 / 512x512, maskable).

Chrome's installability minimum requires icons at BOTH 192x192 and 512x512
(https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest).
Android masks the launcher icon to an OEM-chosen shape, so the artwork is kept
inside the central 80% "safe zone" of a full-bleed background — that is what
`purpose: "maskable"` promises. See
https://web.dev/articles/maskable-icon for the safe-zone rule.

Visual identity mirrors the in-app brand mark: the ChatHeader logo chip is
`bg-gradient-to-tr from-blue-600 to-indigo-500` (Tailwind v4 defaults:
blue-600 #2563EB -> indigo-500 #6366F1) with a paw glyph, matching the site
favicon's 🐾.

Usage (from the repo root):
    python scripts/gen_pwa_icons.py

Outputs:
    public/icons/pwa-192.png
    public/icons/pwa-512.png

The paw is drawn from vector-ish primitives (ellipses + a rounded pad) rather
than an emoji glyph, because emoji rendering depends on a colour-emoji font
being installed and would be non-deterministic across machines and CI.
"""

from __future__ import annotations

import os
from PIL import Image, ImageDraw

# Tailwind v4 palette values used by the app's brand chip.
BLUE_600 = (37, 99, 235)
INDIGO_500 = (99, 102, 241)

# Android maskable safe zone: artwork must fit in the central 80% circle.
SAFE_ZONE = 0.80

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "icons")


def _lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient_square(size: int) -> Image.Image:
    """Diagonal (bottom-left -> top-right) blue-600 -> indigo-500 gradient.

    A linear gradient with a diagonal axis is built by projecting each pixel
    onto the unit diagonal, which reproduces `bg-gradient-to-tr` closely enough
    for a launcher icon without pulling in a rendering dependency.

    Drawn at 4x and downsampled with LANCZOS so the gradient stays band-free
    (a per-pixel loop at final size would visibly band on the 512 icon).
    """
    ss = 4
    n = size * ss
    img = Image.new("RGB", (n, n))
    px = img.load()
    # Projection onto the diagonal: t goes 0 at bottom-left to 1 at top-right.
    denom = 2.0 * (n - 1)
    for y in range(n):
        for x in range(n):
            t = (x + (n - 1 - y)) / denom
            px[x, y] = (
                _lerp(BLUE_600[0], INDIGO_500[0], t),
                _lerp(BLUE_600[1], INDIGO_500[1], t),
                _lerp(BLUE_600[2], INDIGO_500[2], t),
            )
    return img.resize((size, size), Image.LANCZOS)


def draw_paw(draw: ImageDraw.ImageDraw, size: int, color=(255, 255, 255, 255)) -> None:
    """Draw a centred paw print: four toes + one pad.

    Geometry is expressed as fractions of `size` so the 192 and 512 icons are
    the same artwork at two resolutions.
    """
    cx = size / 2.0
    # Vertical centre of the whole paw, slightly below middle because the toes
    # sit above the pad and the pad is visually heavier.
    cy = size * 0.57

    # Main pad: a wide, rounded blob.
    pad_w = size * 0.34
    pad_h = size * 0.27
    draw.ellipse(
        [cx - pad_w / 2, cy - pad_h * 0.30, cx + pad_w / 2, cy + pad_h * 0.70],
        fill=color,
    )

    # Toes: four ellipses on an arc above the pad. Outer toes are smaller and
    # lower, inner toes larger and higher — the arrangement that reads as a
    # paw rather than four identical dots.
    #
    # The radii and the horizontal spacing are coupled: the sum of two adjacent
    # radii must stay *below* their centre distance or the toes merge into one
    # blob (verified by rendering the icon as ASCII and eyeballing the gap).
    # With centres at 0.30 / 0.11 (half-spacing 0.19) and radii 0.11 / 0.085,
    # the widest gap is 0.19 - 0.085 - 0.11 = -0.005 -> still touching, so the
    # spread is pushed out and the radii pulled in until a real gap exists.
    toe_r_outer = size * 0.072
    toe_r_inner = size * 0.088
    toe_cy = cy - size * 0.235
    spread = size * 0.135
    dz = size * 0.050  # how much lower the outer toes sit

    toes = [
        (cx - spread * 1.00, toe_cy + dz, toe_r_outer),
        (cx - spread * 0.36, toe_cy, toe_r_inner),
        (cx + spread * 0.36, toe_cy, toe_r_inner),
        (cx + spread * 1.00, toe_cy + dz, toe_r_outer),
    ]
    for tx, ty, tr in toes:
        draw.ellipse([tx - tr, ty - tr, tx + tr, ty + tr], fill=color)


def make_icon(size: int) -> Image.Image:
    """Full-bleed brand background + centred paw scaled into the safe zone."""
    base = gradient_square(size).convert("RGBA")

    # Render the paw on its own transparent layer sized to the safe zone, then
    # paste it centred. Keeping the background full-bleed is required: maskable
    # icons must fill the whole canvas or the OEM mask reveals bare edges.
    safe = int(size * SAFE_ZONE)
    layer = Image.new("RGBA", (safe, safe), (0, 0, 0, 0))
    draw_paw(ImageDraw.Draw(layer), safe)

    off = (size - safe) // 2
    base.alpha_composite(layer, (off, off))
    return base


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        path = os.path.join(OUT_DIR, f"pwa-{size}.png")
        icon = make_icon(size)
        # Save as RGBA PNG; no palette reduction so the gradient keeps depth.
        icon.save(path, "PNG", optimize=True)
        print(f"wrote {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
