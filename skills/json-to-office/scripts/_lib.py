"""Shared helpers for the skill's Python scripts."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_PATH = SKILL_ROOT / "scripts" / "bootstrap.py"

# Single source of truth for the jto CLI version, used by this skill's npx
# fallback (bootstrap.py) and read by the dependent Wiseair skills
# (quote-carousel, blog-cover) via scripts/jto_argv.py. Bump here only, then
# re-run bootstrap.py to refresh caps.json.
JTO_CLI_VERSION = "0.19.0"

# Hosted render service backing the `highcharts` and docx `visual` components.
# Both render out-of-process: the CLI offloads chart export (POST /export) and
# pptx-slide rasterization (POST /rasterize) to a service, then embeds the
# returned PNG. This instance backs both, so the render loop works where no
# service is otherwise configured. Env contract lives in the CLI:
# packages/jto-cli/src/format-adapter.ts.
RENDER_SERVER_URL = "https://jto-render-server.onrender.com"


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


def has_local_rasterizer(caps: dict) -> bool:
    """True when the CLI can rasterize `visual` components in-process.

    The in-process rasterizer needs LibreOffice (`soffice`) AND the real
    `pdftoppm` binary. The `pdf2image` Python fallback used for screenshots does
    NOT satisfy it — the CLI shells out to `pdftoppm` directly. `bootstrap.py`
    resolves both with the same candidate search the CLI uses (env overrides,
    macOS app-bundle, Windows defaults, PATH), so a resolved path counts here too.
    """
    return bool(caps.get("soffice")) and caps.get("pdftoppm") not in (None, "pdf2image")


def render_env(caps: dict, kind: str) -> dict:
    """Environment for `jto-cli generate`, wiring the out-of-process renderers.

    - HIGHCHARTS_SERVER_URL is always defaulted: there is no local fallback for
      chart rendering, so `highcharts` needs a server in both docx and pptx.
    - JTO_PPTX_RASTERIZER_URL is defaulted only for `kind == "docx"` AND only
      when no local rasterizer is present (see `has_local_rasterizer`). The var
      is docx-only — `visual` lives in core-docx, and the pptx adapter never
      reads it — so setting it for a pptx render would be inert and misleading.
      With local LibreOffice + pdftoppm the CLI's in-process path is faster and
      keeps document content on the machine; the hosted instance is the fallback.

    Both use setdefault semantics: a user-supplied env var always wins, so the
    public instance is overridable and can be opted out of. Only relevant to the
    `generate` step — chart/visual rendering happens there, not at validate time.
    """
    env = os.environ.copy()
    env.setdefault("HIGHCHARTS_SERVER_URL", RENDER_SERVER_URL)
    if kind == "docx" and not has_local_rasterizer(caps):
        env.setdefault("JTO_PPTX_RASTERIZER_URL", RENDER_SERVER_URL)
    return env


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
