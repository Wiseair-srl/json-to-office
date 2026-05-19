#!/usr/bin/env python3
"""Pre-flight overflow check for json-to-office PPTX JSON.

Estimates whether each `text` component (or text-bearing `shape`) will fit its
allocated box before any actual render. Catches the most common PPTX failure
mode — text overflowing its placeholder — deterministically and in
milliseconds.

Usage:
  python3 preflight.py deck.pptx.json
  python3 preflight.py deck.pptx.json --strict
  python3 preflight.py deck.pptx.json --json

Exit codes:
  0  no OVERFLOW (and no TIGHT in --strict)
  1  one or more OVERFLOW (or TIGHT in --strict)
  2  malformed input or wrong file kind

The estimator is intentionally conservative: it slightly under-estimates how
much fits, so a clean run is a strong signal the render will not overflow.
False positives are possible (especially with shorter-than-average glyphs);
false negatives are rare.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

# Default 16:9 slide canvas (matches the local templates).
DEFAULT_SLIDE_WIDTH_IN = 10.0
DEFAULT_SLIDE_HEIGHT_IN = 5.625

# Default grid if a slide-level grid is referenced but not declared.
DEFAULT_GRID = {
    "columns": 12,
    "rows": 6,
    "margin": {"top": 0.55, "right": 0.55, "bottom": 0.55, "left": 0.55},
    "gutter": {"column": 0.2, "row": 0.2},
}

# Conservative middle ground for proportional sans-serifs.
CHAR_WIDTH_FACTOR = 0.50

# Fragile-fit threshold in pt (renderer rounding).
SAFETY_BUFFER_PT = 8

def default_line_height_pt(font_size: float) -> float:
    """Renderer-aligned default lineSpacing when none is specified.

    Big display type uses tighter leading than body text. Mirrors the
    typographic rule in assets/taste/layout-system.md (headline LH 1.02–1.10,
    body LH 1.5–1.7) and matches what pptxgenjs/LibreOffice produce when no
    explicit lineSpacing is set.
    """
    if font_size >= 60:
        return font_size * 1.05
    if font_size >= 28:
        return font_size * 1.15
    return font_size * 1.25


# ─────────────────────────────────────────────────────────────────────────────
# Geometry
# ─────────────────────────────────────────────────────────────────────────────


def parse_grid(slide_grid_decl: dict | None, doc_grid: dict) -> dict:
    """Merge the doc-level grid with any slide-level override + defaults.

    `padding` is accepted as an alias for `margin` (the templates declare
    `grid: { columns, rows, gutter, padding }`). Promote it once, after
    merge, only if no explicit `margin` came from doc or slide level.
    """
    g = {**DEFAULT_GRID, **(doc_grid or {}), **(slide_grid_decl or {})}
    margin_explicit = (
        (slide_grid_decl or {}).get("margin") is not None
        or (doc_grid or {}).get("margin") is not None
    )
    if "padding" in g and not margin_explicit:
        p = g["padding"]
        if isinstance(p, dict):
            # Per-side dict: copy sides over, falling back to DEFAULT for any
            # missing side so downstream `m.get(side, …)` math stays numeric.
            defaults = DEFAULT_GRID["margin"]
            g["margin"] = {side: p.get(side, defaults[side]) for side in defaults}
        else:
            g["margin"] = {"top": p, "right": p, "bottom": p, "left": p}
    # margin / gutter can be scalars (numbers) — normalise into 4-sided / 2-axis dicts.
    if isinstance(g.get("margin"), (int, float)):
        m = g["margin"]
        g["margin"] = {"top": m, "right": m, "bottom": m, "left": m}
    if isinstance(g.get("gutter"), (int, float)):
        gut = g["gutter"]
        g["gutter"] = {"column": gut, "row": gut}
    return g


def grid_cell_in(grid: dict, slide_w_in: float, slide_h_in: float) -> tuple[float, float]:
    cols = grid.get("columns", 12)
    rows = grid.get("rows", 6)
    m = grid.get("margin", DEFAULT_GRID["margin"])
    gut = grid.get("gutter", DEFAULT_GRID["gutter"])
    inner_w = slide_w_in - m.get("left", 0.55) - m.get("right", 0.55)
    inner_h = slide_h_in - m.get("top", 0.55) - m.get("bottom", 0.55)
    cell_w = (inner_w - (cols - 1) * gut.get("column", 0.2)) / cols
    cell_h = (inner_h - (rows - 1) * gut.get("row", 0.2)) / rows
    return cell_w, cell_h


def grid_to_pt(grid_pos: dict, grid: dict, slide_w_in: float, slide_h_in: float) -> tuple[float, float]:
    col_span = grid_pos.get("columnSpan", 1)
    row_span = grid_pos.get("rowSpan", 1)
    cell_w, cell_h = grid_cell_in(grid, slide_w_in, slide_h_in)
    gut = grid.get("gutter", DEFAULT_GRID["gutter"])
    w_in = col_span * cell_w + (col_span - 1) * gut.get("column", 0.2)
    h_in = row_span * cell_h + (row_span - 1) * gut.get("row", 0.2)
    return w_in * 72, h_in * 72


def parse_dim(value, axis_in: float) -> float | None:
    """Parse a dim that may be a percentage string ('25%') or an inch number."""
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        if v.endswith("%"):
            try:
                return float(v[:-1]) / 100 * axis_in * 72
            except ValueError:
                return None
        try:
            return float(v) * 72
        except ValueError:
            return None
    if isinstance(value, (int, float)):
        return float(value) * 72
    return None


def absolute_to_pt(props: dict, slide_w_in: float, slide_h_in: float) -> tuple[float | None, float | None]:
    return parse_dim(props.get("w"), slide_w_in), parse_dim(props.get("h"), slide_h_in)


# ─────────────────────────────────────────────────────────────────────────────
# Text height estimation
# ─────────────────────────────────────────────────────────────────────────────


def estimate_text_height_pt(
    text: str,
    font_size: float,
    line_spacing: float,
    width_pt: float,
    para_before: float = 0,
    para_after: float = 0,
) -> int:
    if not text:
        return 0
    paragraphs = str(text).split("\n")
    total_lines = 0
    for para in paragraphs:
        if not para.strip():
            total_lines += 1
            continue
        chars_per_line = max(1, int(width_pt / (font_size * CHAR_WIDTH_FACTOR)))
        total_lines += max(1, math.ceil(len(para) / chars_per_line))
    # Rendered height: first line occupies font_size; each extra line adds one line_spacing.
    # This matches how PPTX/PDF renderers stack glyph rows.
    text_h = font_size + max(0, total_lines - 1) * line_spacing
    if len(paragraphs) > 1:
        text_h += (len(paragraphs) - 1) * (para_before + para_after)
    return text_h


def resolve_font_and_line(props: dict) -> tuple[float, float]:
    font_size = float(props.get("fontSize") or 14)
    line_spacing = props.get("lineSpacing")
    if line_spacing is None:
        line_spacing = default_line_height_pt(font_size)
    return font_size, float(line_spacing)


# ─────────────────────────────────────────────────────────────────────────────
# Walking
# ─────────────────────────────────────────────────────────────────────────────


def walk_text_nodes(component: dict):
    """Yield every `text` component, and `shape` components whose props.text is set."""
    if not isinstance(component, dict):
        return
    name = component.get("name")
    props = component.get("props") or {}
    if name == "text":
        yield component
    elif name == "shape" and props.get("text"):
        yield component
    for child in component.get("children") or []:
        yield from walk_text_nodes(child)


# ─────────────────────────────────────────────────────────────────────────────
# Analysis
# ─────────────────────────────────────────────────────────────────────────────


def analyze_slide(slide_idx: int, slide: dict, doc_grid: dict, slide_w_in: float, slide_h_in: float) -> list[dict]:
    findings = []
    slide_props = slide.get("props") or {}
    slide_grid_override = slide_props.get("grid")
    grid = parse_grid(slide_grid_override, doc_grid) if (doc_grid or slide_grid_override) else None

    for idx, node in enumerate(walk_text_nodes(slide), start=1):
        props = node.get("props") or {}
        text = props.get("text")
        if not text:
            continue

        font_size, line_spacing = resolve_font_and_line(props)
        para_before = float(props.get("paraSpaceBefore", 0))
        para_after = float(props.get("paraSpaceAfter", 0))

        grid_pos = props.get("grid")
        width_pt = height_pt = None
        positioning = None

        if grid_pos and grid is not None:
            width_pt, height_pt = grid_to_pt(grid_pos, grid, slide_w_in, slide_h_in)
            positioning = "grid"
        else:
            width_pt, height_pt = absolute_to_pt(props, slide_w_in, slide_h_in)
            positioning = "absolute"

        if width_pt is None or height_pt is None:
            # No declared box — skip; the model likely set defaults outside our reach.
            continue

        text_h = estimate_text_height_pt(
            text, font_size, line_spacing, width_pt,
            para_before=para_before, para_after=para_after,
        )
        margin_pt = height_pt - text_h
        chars = len(str(text))
        chars_per_line = max(1, int(width_pt / (font_size * CHAR_WIDTH_FACTOR)))
        est_lines = max(1, math.ceil(chars / chars_per_line))

        if margin_pt < 0:
            severity = "OVERFLOW"
        elif margin_pt < SAFETY_BUFFER_PT:
            severity = "TIGHT"
        else:
            severity = "OK"

        findings.append({
            "slide": slide_idx,
            "node_index": idx,
            "positioning": positioning,
            "severity": severity,
            "font_size": font_size,
            "line_spacing": line_spacing,
            "chars": chars,
            "est_lines": est_lines,
            "text_h_pt": round(text_h, 1),
            "available_pt": round(height_pt, 1),
            "margin_pt": round(margin_pt, 1),
            "width_pt": round(width_pt, 1),
            "preview": str(text).replace("\n", " ⏎ ")[:48],
        })

    return findings


KNOWN_ASPECTS = {
    "16:9 small":    (10.0,    5.625),
    "16:9 standard": (13.333,  7.5),
    "1:1 carousel":  (7.5,     7.5),
    "4:5 vertical":  (7.5,     9.375),
    "9:16 story":    (4.5,     8.0),
    "4:3 legacy":    (10.0,    7.5),
}


def _canvas_finding(severity: str, preview: str) -> dict:
    return {
        "slide": 0,
        "node_index": 0,
        "positioning": "document",
        "severity": severity,
        "font_size": 0,
        "line_spacing": 0,
        "chars": 0,
        "est_lines": 0,
        "text_h_pt": 0.0,
        "available_pt": 0.0,
        "margin_pt": 0.0,
        "width_pt": 0.0,
        "preview": preview,
    }


def check_canvas(props: dict) -> list[dict]:
    """Verify the document declares a known slide canvas.

    The renderer (pptxgenjs) defaults to LAYOUT_4x3 (10×7.5) when slideWidth /
    slideHeight are omitted. Content authored for 16:9 (10×5.625) on that
    canvas leaves a ~2" white strip at the bottom — silent failure, not
    caught by schema validation.
    """
    findings: list[dict] = []
    w = props.get("slideWidth")
    h = props.get("slideHeight")

    if w is None or h is None:
        findings.append(_canvas_finding(
            "OVERFLOW",
            "canvas not declared: set props.slideWidth + props.slideHeight (renderer default is 4:3, 10×7.5)",
        ))
        return findings

    try:
        w_f = float(w)
        h_f = float(h)
    except (TypeError, ValueError):
        findings.append(_canvas_finding(
            "OVERFLOW",
            f"canvas values not numeric: slideWidth={w!r} slideHeight={h!r}",
        ))
        return findings

    for name, (kw, kh) in KNOWN_ASPECTS.items():
        if abs(w_f - kw) < 0.01 and abs(h_f - kh) < 0.01:
            if name == "4:3 legacy":
                findings.append(_canvas_finding(
                    "TIGHT",
                    f"canvas is 4:3 legacy (10×7.5) — confirm intentional; 16:9 is the modern default",
                ))
            return findings

    findings.append(_canvas_finding(
        "TIGHT",
        f"canvas {w_f:g}×{h_f:g} does not match a known preset (16:9, 1:1, 4:5, 9:16)",
    ))
    return findings


def _safe_dim(value, default: float) -> float:
    """Parse a slide-canvas dimension; fall back to default on invalid input.

    check_canvas() re-parses and emits a structured finding for non-numeric
    values, so the silent fallback here is safe — it just prevents the
    estimator from crashing before that finding reaches the user.
    """
    if value is None:
        return default
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if v > 0 else default


def analyze_doc(doc: dict) -> list[dict]:
    props = doc.get("props") or {}
    slide_w_in = _safe_dim(props.get("slideWidth"), DEFAULT_SLIDE_WIDTH_IN)
    slide_h_in = _safe_dim(props.get("slideHeight"), DEFAULT_SLIDE_HEIGHT_IN)
    doc_grid = props.get("grid")

    findings: list[dict] = []
    findings.extend(check_canvas(props))

    for i, slide in enumerate(doc.get("children") or [], start=1):
        if not isinstance(slide, dict) or slide.get("name") != "slide":
            continue
        findings.extend(analyze_slide(i, slide, doc_grid, slide_w_in, slide_h_in))
    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────────────


ANSI = {
    "red": "\033[31m",
    "yellow": "\033[33m",
    "green": "\033[32m",
    "dim": "\033[2m",
    "reset": "\033[0m",
}


def color(text: str, key: str) -> str:
    if not sys.stdout.isatty():
        return text
    return f"{ANSI[key]}{text}{ANSI['reset']}"


def print_report(findings: list[dict]) -> tuple[list[dict], list[dict]]:
    overflow = [f for f in findings if f["severity"] == "OVERFLOW"]
    tight = [f for f in findings if f["severity"] == "TIGHT"]
    ok = [f for f in findings if f["severity"] == "OK"]

    print(f"\nPre-flight scan: {len(findings)} text node(s) analysed")
    print(f"  {color('OVERFLOW', 'red')}: {len(overflow)}")
    print(f"  {color('TIGHT',    'yellow')}: {len(tight)}")
    print(f"  {color('OK',       'green')}:    {len(ok)}\n")

    def show(group: list[dict], label: str, key: str):
        if not group:
            return
        print(color(f"── {label} ──", key))
        for f in group:
            if f["positioning"] == "document":
                print(f"  [document]  {f['preview']}")
                continue
            print(
                f"  Slide {f['slide']:>2} node#{f['node_index']:<2} [{f['positioning']}]  "
                f"text={f['text_h_pt']:>5}pt avail={f['available_pt']:>5}pt  "
                f"margin={f['margin_pt']:>+6.1f}pt  "
                f"({f['est_lines']} line(s) of {f['font_size']:g}pt)\n"
                f"     {color(f['preview'], 'dim')}"
            )
        print()

    show(overflow, "OVERFLOW (will not fit — must fix)", "red")
    show(tight, f"TIGHT (margin < {SAFETY_BUFFER_PT}pt — fragile)", "yellow")
    if not overflow and not tight:
        print(color("All placeholders fit. Render with confidence.", "green"))
    return overflow, tight


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pre-flight overflow check for json-to-office PPTX JSON.",
    )
    parser.add_argument("doc", type=Path, help="Path to .pptx.json")
    parser.add_argument("--strict", action="store_true",
                        help="Exit non-zero on TIGHT fits too.")
    parser.add_argument("--json", action="store_true",
                        help="Emit findings as JSON.")
    args = parser.parse_args()

    if not args.doc.is_file():
        print(f"ERROR: not a file: {args.doc}", file=sys.stderr)
        return 2

    name_lower = args.doc.name.lower().strip()
    if not name_lower.endswith(".pptx.json"):
        print(
            f"ERROR: preflight is PPTX-only; expected *.pptx.json, got {args.doc.name}",
            file=sys.stderr,
        )
        return 2

    try:
        doc = json.loads(args.doc.read_text())
    except json.JSONDecodeError as e:
        print(f"ERROR: invalid JSON in {args.doc}: {e}", file=sys.stderr)
        return 2

    findings = analyze_doc(doc)

    if args.json:
        print(json.dumps(findings, indent=2))
        overflow = [f for f in findings if f["severity"] == "OVERFLOW"]
        tight = [f for f in findings if f["severity"] == "TIGHT"]
    else:
        overflow, tight = print_report(findings)

    if overflow:
        return 1
    if args.strict and tight:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
