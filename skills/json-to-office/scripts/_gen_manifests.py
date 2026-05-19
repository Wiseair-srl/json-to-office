#!/usr/bin/env python3
"""Regenerate slot_hints in every template manifest from the actual JSON.

Walks every *.{docx,pptx}.json under assets/templates/, emits a slot_hint
per content-bearing node, preserves hand-authored manifest keys
(name, description, when_to_use, theme_default, golden), and preserves any
existing slot_hint's label/example when its path matches an emitted node
(so manual label refinements survive a re-run).

Usage:
  python3 _gen_manifests.py                       # rewrite all in place
  python3 _gen_manifests.py --check               # exit 1 if any drift
  python3 _gen_manifests.py --kind pptx --name cover
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterator
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = SKILL_ROOT / "assets" / "templates"

KEEP_KEYS = ("name", "description", "when_to_use", "theme_default", "golden")
MAX_EXAMPLE = 80


def truncate(text: str, n: int = MAX_EXAMPLE) -> str:
    t = str(text).replace("\n", " ⏎ ")
    return t if len(t) <= n else t[: n - 1] + "…"


# ── PPTX ────────────────────────────────────────────────────────────────────


def classify_pptx(props: dict, slide_idx: int) -> str:
    y = props.get("y")
    font_size = float(props.get("fontSize") or 14)
    font_face = (props.get("fontFace") or "").lower()
    text = str(props.get("text") or "").strip()
    is_courier = "courier" in font_face
    is_upper = bool(text) and text == text.upper() and any(c.isalpha() for c in text)

    if isinstance(y, (int, float)) and y < 0.5:
        kind = "Top chrome"
    elif isinstance(y, (int, float)) and y > 5.0:
        kind = "Bottom chrome"
    elif font_size >= 60:
        kind = "Display headline"
    elif font_size >= 32:
        kind = "Headline"
    elif font_size >= 18:
        kind = "Subhead / lead"
    elif is_courier and font_size <= 12 and is_upper:
        kind = "Eyebrow / label"
    elif is_courier and font_size <= 12:
        kind = "Caption"
    else:
        kind = "Body"
    return f"Slide {slide_idx} · {kind}"


def walk_pptx(doc: dict) -> Iterator[tuple[str, str, str]]:
    for si, slide in enumerate(doc.get("children") or []):
        if not isinstance(slide, dict) or slide.get("name") != "slide":
            continue
        for ci, child in enumerate(slide.get("children") or []):
            if not isinstance(child, dict):
                continue
            name = child.get("name")
            props = child.get("props") or {}
            pfx = f"children[{si}].children[{ci}].props"
            if name in ("text", "shape") and props.get("text"):
                yield pfx + ".text", classify_pptx(props, si + 1), truncate(props["text"])
            elif name == "table" and props.get("data"):
                yield pfx + ".data", f"Slide {si + 1} · Table data", truncate(json.dumps(props["data"]))
            elif name == "chart" and props.get("data"):
                yield pfx + ".data", f"Slide {si + 1} · Chart data", truncate(json.dumps(props["data"]))


# ── DOCX ────────────────────────────────────────────────────────────────────


def docx_label(name: str, props: dict) -> str:
    if name == "heading":
        return f"Heading H{props.get('level', 1)}"
    if name == "paragraph":
        return "Paragraph"
    if name == "list":
        levels = props.get("levels") or []
        fmt = (levels[0].get("format") if levels else props.get("format")) or (
            "ordered" if props.get("ordered") else "bullet"
        )
        return f"List ({fmt})"
    if name == "table":
        return "Table"
    if name == "statistic":
        return "Statistic"
    if name == "text-box":
        return "Text box"
    if name == "toc":
        return "Table of contents"
    return name or "Node"


def walk_docx_body(children: list, prefix: str) -> Iterator[tuple[str, str, str]]:
    for ci, child in enumerate(children):
        if not isinstance(child, dict):
            continue
        name = child.get("name")
        props = child.get("props") or {}
        node = f"{prefix}[{ci}]"
        if name in ("heading", "paragraph", "text-box") and props.get("text"):
            yield f"{node}.props.text", docx_label(name, props), truncate(props["text"])
        elif name == "list" and props.get("items"):
            example = " | ".join(str(i) for i in props["items"])
            yield f"{node}.props.items", docx_label(name, props), truncate(example)
        elif name == "table":
            for col_i, col in enumerate(props.get("columns") or []):
                cells = col.get("cells") or []
                if not cells:
                    continue
                example = " | ".join(str(c.get("content", "")) for c in cells)
                yield (
                    f"{node}.props.columns[{col_i}].cells",
                    f"Table col {col_i + 1} cells",
                    truncate(example),
                )
        elif name == "statistic":
            if props.get("value") is not None:
                yield f"{node}.props.value", "Statistic value", truncate(str(props["value"]))
            if props.get("label"):
                yield f"{node}.props.label", "Statistic label", truncate(props["label"])
        elif name == "columns":
            yield from walk_docx_body(child.get("children") or [], f"{node}.children")


def walk_docx(doc: dict) -> Iterator[tuple[str, str, str]]:
    meta = (doc.get("props") or {}).get("metadata") or {}
    if meta.get("title"):
        yield "props.metadata.title", "Document title", truncate(meta["title"])
    for si, section in enumerate(doc.get("children") or []):
        if not isinstance(section, dict) or section.get("name") != "section":
            continue
        sp = section.get("props") or {}
        for hf in ("header", "footer"):
            for hi, item in enumerate(sp.get(hf) or []):
                if not isinstance(item, dict):
                    continue
                ip = item.get("props") or {}
                if ip.get("text"):
                    yield (
                        f"children[{si}].props.{hf}[{hi}].props.text",
                        f"Running {hf}",
                        truncate(ip["text"]),
                    )
        yield from walk_docx_body(section.get("children") or [], f"children[{si}].children")


# ── Manifest assembly ───────────────────────────────────────────────────────


def gen_hints(template: Path, kind: str) -> list[dict]:
    doc = json.loads(template.read_text())
    walker = walk_pptx if kind == "pptx" else walk_docx
    return [{"path": p, "label": l, "example": e} for (p, l, e) in walker(doc)]


def merge_manifest(existing: dict, hints: list[dict]) -> dict:
    prev_hints = existing.get("slot_hints") or []
    prev_by_path = {h["path"]: h for h in prev_hints if isinstance(h, dict) and "path" in h}
    merged = []
    for h in hints:
        old = prev_by_path.get(h["path"])
        # Only inherit prior label/example when the prior example actually
        # matches the current content; otherwise the old slot_hint was tied
        # to a different node and would carry a misleading label forward.
        if old and str(old.get("example", "")).strip() == str(h["example"]).strip():
            merged.append({
                "path": h["path"],
                "label": old.get("label", h["label"]),
                "example": old.get("example", h["example"]),
            })
        else:
            merged.append(h)
    # Preserve any prior documentation-only slot_hints (those without a path).
    for h in prev_hints:
        if isinstance(h, dict) and "path" not in h:
            merged.append(h)
    out: dict = {}
    for k in ("name", "description", "when_to_use"):
        if k in existing:
            out[k] = existing[k]
    out["slot_hints"] = merged
    for k in ("theme_default", "golden"):
        if k in existing:
            out[k] = existing[k]
    return out


def regenerate(template: Path, manifest: Path, kind: str) -> str:
    existing = json.loads(manifest.read_text()) if manifest.is_file() else {}
    new = merge_manifest(existing, gen_hints(template, kind))
    return json.dumps(new, indent=2, ensure_ascii=False) + "\n"


def find_pairs(kind: str | None, name: str | None) -> list[tuple[Path, Path, str]]:
    pairs = []
    for k in [kind] if kind else ["docx", "pptx"]:
        for tpl in sorted((TEMPLATES_DIR / k).glob(f"*.{k}.json")):
            stem = tpl.name.removesuffix(f".{k}.json")
            if name and stem != name:
                continue
            pairs.append((tpl, tpl.parent / f"{stem}.manifest.json", k))
    return pairs


def main() -> int:
    ap = argparse.ArgumentParser(description="Regenerate template slot_hints.")
    ap.add_argument("--check", action="store_true", help="Exit non-zero on drift; don't write.")
    ap.add_argument("--kind", choices=("docx", "pptx"))
    ap.add_argument("--name", help="Only the named template (basename without .{kind}.json).")
    args = ap.parse_args()

    pairs = find_pairs(args.kind, args.name)
    if not pairs:
        print("no templates matched", file=sys.stderr)
        return 1

    drift = []
    for tpl, mani, k in pairs:
        new_text = regenerate(tpl, mani, k)
        cur_text = mani.read_text() if mani.is_file() else ""
        n_hints = len(json.loads(new_text).get("slot_hints", []))
        if new_text != cur_text:
            drift.append(mani)
            if not args.check:
                mani.write_text(new_text)
                print(f"wrote {mani.relative_to(SKILL_ROOT)} ({n_hints} slot_hints)")
        elif not args.check:
            print(f"unchanged {mani.relative_to(SKILL_ROOT)} ({n_hints} slot_hints)")

    if args.check:
        if drift:
            print(f"\n{len(drift)} manifest(s) out of date:", file=sys.stderr)
            for m in drift:
                print(f"  - {m.relative_to(SKILL_ROOT)}", file=sys.stderr)
            return 1
        print("all manifests up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
