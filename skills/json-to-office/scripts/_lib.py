"""Shared helpers for the skill's Python scripts."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_PATH = SKILL_ROOT / "scripts" / "bootstrap.py"


def _candidate_caps_paths() -> list[Path]:
    """Ordered list of locations to try for caps.json.

    Preference: the skill's own .skill-out (best for local dev — keeps state
    next to the source). Fall back to user cache, then /tmp. Some runtimes
    (claude.ai sandbox, read-only mounted skill bundles) make the first path
    fail; the script picks the first writable candidate.
    """
    xdg = os.environ.get("XDG_CACHE_HOME")
    home_cache = Path(xdg) if xdg else Path.home() / ".cache"
    return [
        SKILL_ROOT / ".skill-out" / "caps.json",
        home_cache / "jto-skill" / "caps.json",
        Path("/tmp") / "jto-skill" / "caps.json",
    ]


def get_caps_path() -> Path:
    """Return the first caps.json path whose parent we can write to."""
    for path in _candidate_caps_paths():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Probe writability.
            probe = path.parent / ".write-probe"
            probe.touch()
            probe.unlink()
            return path
        except (OSError, PermissionError):
            continue
    # Last resort — return the /tmp candidate even if probe failed; the actual
    # write will raise a clear error.
    return _candidate_caps_paths()[-1]


def load_caps() -> dict:
    caps_path = get_caps_path()
    if not caps_path.is_file():
        subprocess.run([sys.executable, str(BOOTSTRAP_PATH), "--quiet"], check=True)
    return json.loads(caps_path.read_text())


def infer_kind(path: Path) -> str:
    """Return 'docx' or 'pptx' from a file ending exactly in .docx.json / .pptx.json."""
    name = path.name.lower()
    is_pptx = name.endswith(".pptx.json")
    is_docx = name.endswith(".docx.json")
    if is_pptx and is_docx:
        raise ValueError(f"Ambiguous filename (matches both kinds): {path.name}")
    if is_pptx:
        return "pptx"
    if is_docx:
        return "docx"
    raise ValueError(
        f"Cannot infer kind from filename: {path.name} "
        "(expected .docx.json or .pptx.json suffix)"
    )


def run(argv: list[str], **kw) -> subprocess.CompletedProcess:
    """Run a subprocess; surface stdout+stderr on failure."""
    proc = subprocess.run(argv, capture_output=True, text=True, **kw)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
    return proc


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)
