#!/usr/bin/env python3
"""Template regression gate: render every bundled template with the pinned CLI
and compare against the golden renders in references/renders/.

Run this on every `JTO_CLI_VERSION` bump (and after editing any template or
golden) BEFORE republishing the skill. It catches the failure mode that
static checks cannot: a CLI upgrade or template edit that still validates but
silently changes what renders — lost accent colors, moved boxes, dropped
components.

Per template:
  1. validate with the pinned CLI (deep validation must pass);
  2. generate the office file, convert to PDF (LibreOffice) and PNGs
     (pdftoppm, 144 dpi — same as the goldens);
  3. page count must match the golden set;
  4. every page must be pixel-close to its golden (block-averaged mean
     absolute difference below THRESHOLD);
  5. for PPTX templates with an inline theme, the theme's accent color must
     actually appear somewhere in the render (the historical failure was
     accent typography silently falling back to default text color).

Usage:
  python3 check_templates.py            # all templates
  python3 check_templates.py --kind pptx
  python3 check_templates.py --name executive-deck

Exit codes: 0 clean, 1 drift/failure, 2 environment cannot render.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import tempfile
import zlib
from pathlib import Path

from _lib import SKILL_ROOT, die, load_caps, render_env, run

TEMPLATES_DIR = SKILL_ROOT / "assets" / "templates"
RENDERS_DIR = SKILL_ROOT / "references" / "renders"

# Mean absolute channel difference (0–255 scale) on the block-averaged image.
# Antialiasing and PDF-rasterizer drift stay well under this; a lost accent
# color, moved box, or dropped component lands far above it.
THRESHOLD = 6.0

# Downsample grid for comparison (blocks across the wider axis).
GRID = 64

# Minimum fraction of pixels that must match the accent color for the
# accent-presence check (the accent bar alone clears this by an order of
# magnitude on a 1440×1080 page).
ACCENT_MIN_FRACTION = 0.0005
ACCENT_TOLERANCE = 30  # per-channel


# ─────────────────────────────────────────────────────────────────────────────
# Minimal PNG reader (pdftoppm output: 8-bit RGB/gray, non-interlaced)
# ─────────────────────────────────────────────────────────────────────────────


def read_png_rgb(path: Path) -> tuple[int, int, bytes]:
    """Decode a PNG into (width, height, RGB bytes). Supports the subset
    pdftoppm emits: 8-bit depth, color type 0 (gray) or 2 (RGB), no interlace."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        die(f"not a PNG: {path}")
    pos = 8
    idat = b""
    w = h = None
    color_type = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            w, h, bit_depth, color_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if bit_depth != 8 or color_type not in (0, 2) or interlace != 0:
                die(
                    f"unsupported PNG variant in {path} "
                    f"(depth={bit_depth} color={color_type} interlace={interlace}); "
                    "regenerate with pdftoppm -png"
                )
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
        pos += 12 + length
    if w is None:
        die(f"no IHDR in {path}")

    raw = zlib.decompress(idat)
    channels = 3 if color_type == 2 else 1
    stride = w * channels
    out = bytearray(w * h * 3)
    prev = bytearray(stride)
    src = 0
    for y in range(h):
        filt = raw[src]
        line = bytearray(raw[src + 1 : src + 1 + stride])
        src += 1 + stride
        if filt == 1:  # Sub
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 0xFF
        elif filt == 2:  # Up
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif filt == 3:  # Average
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif filt == 4:  # Paeth
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        prev = line
        row_off = y * w * 3
        if channels == 3:
            out[row_off : row_off + stride] = line
        else:
            for x in range(w):
                g = line[x]
                out[row_off + 3 * x : row_off + 3 * x + 3] = bytes((g, g, g))
    return w, h, bytes(out)


def block_average(w: int, h: int, rgb: bytes, grid: int) -> list[tuple[float, float, float]]:
    """Average the image into a coarse grid so tiny rasterizer drift washes out."""
    gx = grid
    gy = max(1, round(grid * h / w))
    cells = []
    for by in range(gy):
        y0, y1 = h * by // gy, max(h * by // gy + 1, h * (by + 1) // gy)
        for bx in range(gx):
            x0, x1 = w * bx // gx, max(w * bx // gx + 1, w * (bx + 1) // gx)
            r = g = b = n = 0
            for y in range(y0, y1):
                base = (y * w + x0) * 3
                for x in range(x1 - x0):
                    r += rgb[base]
                    g += rgb[base + 1]
                    b += rgb[base + 2]
                    base += 3
                    n += 1
            cells.append((r / n, g / n, b / n))
    return cells


def page_diff(golden: Path, fresh: Path) -> float:
    gw, gh, grgb = read_png_rgb(golden)
    fw, fh, frgb = read_png_rgb(fresh)
    ga = block_average(gw, gh, grgb, GRID)
    fa = block_average(fw, fh, frgb, GRID)
    if len(ga) != len(fa):
        return 255.0  # different aspect — definitely drift
    total = 0.0
    for (r1, g1, b1), (r2, g2, b2) in zip(ga, fa):
        total += abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
    return total / (len(ga) * 3)


def accent_fraction(path: Path, accent_rgb: tuple[int, int, int]) -> float:
    w, h, rgb = read_png_rgb(path)
    ar, ag, ab = accent_rgb
    hits = 0
    total = w * h
    # Sample every 4th pixel for speed; presence, not exact count, matters.
    for i in range(0, total, 4):
        off = i * 3
        if (
            abs(rgb[off] - ar) <= ACCENT_TOLERANCE
            and abs(rgb[off + 1] - ag) <= ACCENT_TOLERANCE
            and abs(rgb[off + 2] - ab) <= ACCENT_TOLERANCE
        ):
            hits += 1
    return hits / (total / 4)


# ─────────────────────────────────────────────────────────────────────────────
# Rendering
# ─────────────────────────────────────────────────────────────────────────────


def golden_pages(name: str) -> list[Path]:
    """Golden layout: single-page templates ship a flat <name>.png; multi-page
    ones a <name>/page-N.png directory."""
    flat = RENDERS_DIR / f"{name}.png"
    if flat.is_file():
        return [flat]
    d = RENDERS_DIR / name
    if d.is_dir():
        return sorted(d.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[1]))
    return []


def render_pages(caps: dict, kind: str, doc_path: Path, workdir: Path) -> list[Path]:
    name = doc_path.name.replace(f".{kind}.json", "")
    office = workdir / f"{name}.{kind}"
    proc = run(
        [*caps["jto_argv"], kind, "generate", str(doc_path), "-o", str(office), "--no-google-fonts"],
        env=render_env(caps, kind),
    )
    if proc.returncode != 0 or not office.is_file():
        die(f"generate failed for {doc_path.name}")
    proc = run([caps["soffice"], "--headless", "--convert-to", "pdf", "--outdir", str(workdir), str(office)])
    pdf = office.with_suffix(".pdf")
    if proc.returncode != 0 or not pdf.is_file():
        die(f"PDF conversion failed for {office.name}")
    prefix = workdir / f"{name}-page"
    proc = run([caps["pdftoppm"], "-r", "144", "-png", str(pdf), str(prefix)])
    if proc.returncode != 0:
        die(f"pdftoppm failed for {pdf.name}")
    return sorted(workdir.glob(f"{name}-page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))


def theme_accent(doc: dict) -> tuple[int, int, int] | None:
    theme = (doc.get("props") or {}).get("theme")
    if not isinstance(theme, dict):
        return None
    accent = (theme.get("colors") or {}).get("accent")
    if not isinstance(accent, str):
        return None
    v = accent.lstrip("#")
    if len(v) != 6:
        return None
    try:
        return tuple(int(v[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--kind", choices=["docx", "pptx"], help="Limit to one format")
    parser.add_argument("--name", help="Limit to one template name")
    args = parser.parse_args()

    caps = load_caps()
    if not caps.get("can_screenshot"):
        die(
            "environment cannot render to PNG (needs jto CLI + LibreOffice + "
            "pdftoppm) — the template gate requires the full pipeline",
            code=2,
        )

    kinds = [args.kind] if args.kind else ["pptx", "docx"]
    failures: list[str] = []
    checked = 0

    with tempfile.TemporaryDirectory(prefix="jto-check-templates-") as tmp:
        workdir = Path(tmp)
        for kind in kinds:
            for doc_path in sorted((TEMPLATES_DIR / kind).glob(f"*.{kind}.json")):
                name = doc_path.name.replace(f".{kind}.json", "")
                if args.name and name != args.name:
                    continue
                checked += 1
                goldens = golden_pages(name)
                if not goldens:
                    failures.append(f"{name}: no goldens under references/renders/")
                    continue

                proc = run([*caps["jto_argv"], kind, "validate", str(doc_path)])
                if proc.returncode != 0:
                    failures.append(f"{name}: validation failed")
                    continue

                pages = render_pages(caps, kind, doc_path, workdir)
                if len(pages) != len(goldens):
                    failures.append(
                        f"{name}: page count {len(pages)} != golden {len(goldens)}"
                    )
                    continue

                worst = 0.0
                for golden, fresh in zip(goldens, pages):
                    d = page_diff(golden, fresh)
                    worst = max(worst, d)
                    if d > THRESHOLD:
                        failures.append(
                            f"{name}/{golden.name}: pixel drift {d:.1f} > {THRESHOLD:g}"
                        )
                status = "DRIFT" if worst > THRESHOLD else "ok"
                print(f"  {kind}/{name}: {len(pages)} page(s), worst diff {worst:.1f} — {status}")

                if kind == "pptx":
                    doc = json.loads(doc_path.read_text())
                    accent = theme_accent(doc)
                    if accent:
                        best = max(accent_fraction(p, accent) for p in pages)
                        if best < ACCENT_MIN_FRACTION:
                            failures.append(
                                f"{name}: theme accent {accent} not found in any "
                                "rendered page — accent styling is being dropped"
                            )

    if checked == 0:
        die("no templates matched the filter")
    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"\nAll {checked} template(s) match their goldens.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
