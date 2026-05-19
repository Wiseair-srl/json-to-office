#!/usr/bin/env python3
"""Render a json-to-office JSON to .docx/.pptx, then PNG previews per page/slide.

Usage: python render_preview.py path/to/doc.{docx,pptx}.json [--out DIR]

Prints absolute PNG paths to stdout, one per line. The Claude skill model
is expected to Read each PNG (multimodal), inspect for visual issues, then
iterate on the JSON if needed.

Degrades gracefully:
- No node/jto-cli   → fail hard, nothing we can do
- No soffice / pdftoppm → 'validate-only mode': renders the office file but
  prints `VALIDATE_ONLY` and skips PNG generation. Skill should skip the
  visual loop.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from _lib import die, infer_kind, load_caps, run

SKILL_ROOT = Path(__file__).resolve().parent.parent
PREFLIGHT_SCRIPT = SKILL_ROOT / "scripts" / "preflight.py"


def run_preflight(input_path: Path) -> int:
    """Run preflight.py on a PPTX file. Streams output to the caller's stdout/stderr."""
    proc = subprocess.run(
        [sys.executable, str(PREFLIGHT_SCRIPT), str(input_path)],
    )
    return proc.returncode


def render_pdf_to_pngs(soffice_bin: str, pdftoppm_kind: str, office_path: Path, out_dir: Path) -> list[Path]:
    """Convert office file → PDF → numbered PNGs at 144 dpi."""
    pdf_dir = out_dir
    pdf_dir.mkdir(parents=True, exist_ok=True)

    soffice_proc = run(
        [
            soffice_bin,
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(pdf_dir),
            str(office_path),
        ]
    )
    if soffice_proc.returncode != 0:
        die(f"{soffice_bin} failed to convert {office_path.name} → pdf")

    pdf_path = pdf_dir / (office_path.stem + ".pdf")
    if not pdf_path.is_file():
        die(f"expected pdf at {pdf_path}, soffice did not produce it")

    pages_prefix = pdf_dir / "page"
    if pdftoppm_kind == "pdftoppm":
        proc = run(["pdftoppm", "-r", "144", str(pdf_path), str(pages_prefix), "-png"])
        if proc.returncode != 0:
            die("pdftoppm failed")
        pngs = sorted(pdf_dir.glob("page-*.png"))
    else:
        # pdf2image fallback
        from pdf2image import convert_from_path  # type: ignore

        images = convert_from_path(str(pdf_path), dpi=144)
        pngs = []
        for i, im in enumerate(images, 1):
            p = pdf_dir / f"page-{i:02d}.png"
            im.save(p, "PNG")
            pngs.append(p)
    return pngs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="Path to .docx.json or .pptx.json")
    parser.add_argument(
        "--out",
        help="Output dir (default: <input_parent>/.skill-out/<basename>/)",
        default=None,
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip the PPTX preflight overflow check (PPTX-only).",
    )
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.is_file():
        die(f"not a file: {input_path}")

    kind = infer_kind(input_path)
    caps = load_caps()

    # PPTX preflight: deterministic overflow check before any render.
    if kind == "pptx" and not args.skip_preflight:
        pf_rc = run_preflight(input_path)
        if pf_rc != 0:
            die(
                f"preflight failed for {input_path.name} — fix OVERFLOW reports above, "
                "or pass --skip-preflight to bypass.",
                code=pf_rc,
            )

    if not caps["can_render"]:
        die(
            "no jto-cli available — install Node, or run from inside the "
            "json-to-office monorepo with pnpm available."
        )

    # Default output sits next to the input file — the input is always in a
    # writable location, whereas <skill_root>/.skill-out may be read-only in
    # sandboxed environments (claude.ai, packaged .skill bundles).
    out_dir = Path(args.out).resolve() if args.out else (
        input_path.parent / ".skill-out" / input_path.stem
    )
    # Only fully clobber dirs we own (anything beneath a .skill-out segment).
    # User-supplied paths get artefact-level cleanup instead.
    is_skill_owned = any(p.name == ".skill-out" for p in (out_dir, *out_dir.parents))
    if out_dir.exists():
        if is_skill_owned:
            shutil.rmtree(out_dir)
        else:
            for pattern in ("out.docx", "out.pptx", "*.pdf", "page-*.png"):
                for stale in out_dir.glob(pattern):
                    if stale.is_file():
                        stale.unlink()
    out_dir.mkdir(parents=True, exist_ok=True)

    office_path = out_dir / f"out.{kind}"

    gen_argv = [
        *caps["jto_argv"],
        kind,
        "generate",
        str(input_path),
        "-o",
        str(office_path),
        "--no-google-fonts",
    ]
    proc = run(gen_argv)
    if proc.returncode != 0 or not office_path.is_file():
        die(f"jto-cli {kind} generate failed for {input_path.name}")

    if not caps["can_screenshot"]:
        print("VALIDATE_ONLY")
        print(f"OFFICE_FILE={office_path}")
        sys.stderr.write(
            "NOTE: skipped PNG generation — missing soffice/pdftoppm. "
            "Install LibreOffice + poppler for the full visual loop.\n"
        )
        return 0

    pngs = render_pdf_to_pngs(
        caps["soffice"], caps["pdftoppm"], office_path, out_dir
    )
    print(f"OFFICE_FILE={office_path}")
    for p in pngs:
        print(f"PNG={p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
