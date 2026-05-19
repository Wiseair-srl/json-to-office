#!/usr/bin/env python3
"""Copy a template JSON to a destination path so the model can edit it.

Usage:
  python new_from_template.py <kind> <template-name> <destination.json>

Examples:
  python new_from_template.py pptx pricing decks/our-pricing.pptx.json
  python new_from_template.py docx executive-brief reports/q2.docx.json
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from _lib import die

SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = SKILL_ROOT / "assets" / "templates"


def main() -> int:
    if len(sys.argv) != 4:
        die("usage: python new_from_template.py <kind> <template-name> <destination.json>")

    kind = sys.argv[1].lower()
    name = sys.argv[2]
    dest = Path(sys.argv[3]).resolve()

    if kind not in {"docx", "pptx"}:
        die(f"kind must be 'docx' or 'pptx', got: {kind}")

    src = TEMPLATES_DIR / kind / f"{name}.{kind}.json"
    if not src.is_file():
        available = sorted(p.stem.split(".")[0] for p in (TEMPLATES_DIR / kind).glob(f"*.{kind}.json"))
        die(
            f"no template '{name}' for {kind}. "
            f"available: {', '.join(available) or '(none)'}"
        )

    if dest.exists():
        die(f"refusing to overwrite existing file: {dest}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    print(f"OK: copied {src.name} → {dest}")
    print(f"NEXT: edit slots in {dest}, then run validate.py + render_preview.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
