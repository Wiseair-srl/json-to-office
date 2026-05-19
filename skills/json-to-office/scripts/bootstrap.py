#!/usr/bin/env python3
"""Probe the runtime environment and cache capabilities to caps.json.

Detects: node, npx, jto-cli (via local pnpm workspace OR remote npx),
soffice/libreoffice, pdftoppm (or pdf2image as a Python fallback).

Idempotent: re-running refreshes caps.json. Other scripts read caps.json
to decide which path to take (full render loop vs validate-only).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from _lib import SKILL_ROOT, get_caps_path


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def find_monorepo_root() -> Path | None:
    """Walk up from cwd looking for the json-to-office monorepo root.

    Match either (a) root package.json with name == 'json-to-office', or
    (b) heuristic: pnpm-workspace.yaml + packages/jto-cli both present.
    The heuristic catches forks/renames without losing the local dev path.
    """
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        pkg = parent / "package.json"
        if pkg.is_file():
            try:
                if json.loads(pkg.read_text()).get("name") == "json-to-office":
                    return parent
            except (json.JSONDecodeError, OSError):
                pass
        if (parent / "pnpm-workspace.yaml").is_file() and (parent / "packages" / "jto-cli").is_dir():
            return parent
    return None


def probe_jto_bin(monorepo: Path | None) -> tuple[str | None, list[str]]:
    """Return (jto_bin, prefix_args). prefix_args is the argv prefix to call."""
    # In-monorepo: prefer the built dist; fall back to tsx source via the root script.
    if monorepo:
        built = monorepo / "packages" / "jto-cli" / "dist" / "cli.js"
        if built.is_file() and which("node"):
            return ("node-dist", ["node", str(built)])
        if which("pnpm"):
            return ("pnpm-cli", ["pnpm", "-C", str(monorepo), "cli"])
    # Globally installed
    if which("jto-cli"):
        return ("jto-cli", ["jto-cli"])
    # Via npx (downloads on first call, then cached)
    if which("npx"):
        return ("npx", ["npx", "--yes", "@json-to-office/jto-cli@latest"])
    return (None, [])


def probe_pdftoppm() -> str | None:
    if which("pdftoppm"):
        return "pdftoppm"
    # Python fallback
    try:
        import pdf2image  # noqa: F401

        return "pdf2image"
    except ImportError:
        return None


def probe_soffice() -> str | None:
    for candidate in ("soffice", "libreoffice"):
        if which(candidate):
            return candidate
    return None


def main() -> int:
    monorepo = find_monorepo_root()
    jto_kind, jto_argv = probe_jto_bin(monorepo)
    soffice = probe_soffice()
    pdftoppm = probe_pdftoppm()

    caps_path = get_caps_path()
    caps = {
        "skill_root": str(SKILL_ROOT),
        "caps_path": str(caps_path),
        "monorepo_root": str(monorepo) if monorepo else None,
        "has_node": which("node") is not None,
        "has_npx": which("npx") is not None,
        "has_pnpm": which("pnpm") is not None,
        "jto_kind": jto_kind,
        "jto_argv": jto_argv,
        "soffice": soffice,
        "pdftoppm": pdftoppm,
        "can_render": bool(jto_kind),
        "can_screenshot": bool(jto_kind and soffice and pdftoppm),
    }

    caps_path.parent.mkdir(parents=True, exist_ok=True)
    caps_path.write_text(json.dumps(caps, indent=2))

    if "--quiet" not in sys.argv:
        print(json.dumps(caps, indent=2))

    if not caps["can_render"]:
        print(
            "\nWARN: no way to run jto-cli (need node + npx, or a local monorepo with pnpm). "
            "Skill will fail without it.",
            file=sys.stderr,
        )
    elif jto_kind == "npx":
        print(
            "\nNOTE: jto-cli will be fetched via `npx --yes @json-to-office/jto-cli@latest` "
            "on first invocation. Expect a 60-120 second wait while npm resolves and "
            "downloads the package. Subsequent calls reuse the npx cache.",
            file=sys.stderr,
        )

    if caps["can_render"] and not caps["can_screenshot"]:
        print(
            "\nNOTE: render loop will run in 'validate-only' mode. "
            "Install LibreOffice + poppler (pdftoppm) for the full pixel-perfect loop.",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
