#!/usr/bin/env python3
"""Validate a json-to-office JSON document against its schema via jto-cli.

Usage: python validate.py path/to/doc.{docx,pptx}.json

Exits non-zero on validation failure; prints the validator's diagnostics.
"""

from __future__ import annotations

import sys
from pathlib import Path

from _lib import die, infer_kind, load_caps, run


def main() -> int:
    if len(sys.argv) != 2:
        die("usage: python validate.py <input.{docx,pptx}.json>")

    input_path = Path(sys.argv[1]).resolve()
    if not input_path.is_file():
        die(f"not a file: {input_path}")

    kind = infer_kind(input_path)
    caps = load_caps()

    if not caps["can_render"]:
        die(
            "no jto-cli available — install Node, or run from inside the "
            "json-to-office monorepo with pnpm available."
        )

    argv = [*caps["jto_argv"], kind, "validate", str(input_path)]
    proc = run(argv)
    if proc.returncode == 0:
        print(proc.stdout or f"OK: {input_path.name} is valid {kind} JSON.")
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
