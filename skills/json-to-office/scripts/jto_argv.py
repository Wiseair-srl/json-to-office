#!/usr/bin/env python3
"""Print the resolved jto CLI command prefix, space-joined, on one line.

Intended for dependent skills (quote-carousel, blog-cover) that need to invoke
the jto CLI without re-implementing environment resolution or version pinning:

    JTO_SKILL=$(ls -d /mnt/skills/user/json-to-office /mnt/skills/plugins/*json-to-office* 2>/dev/null | head -1)
    python3 "$JTO_SKILL/scripts/bootstrap.py"   # once per session
    JTO=$(python3 "$JTO_SKILL/scripts/jto_argv.py")
    $JTO pptx generate input.pptx.json --theme-path theme.json -o out.pptx

The CLI version pin lives in `_lib.py` (JTO_CLI_VERSION) and is applied by
bootstrap.py's npx fallback. Re-run bootstrap.py after bumping the pin so a
stale caps.json doesn't keep an old resolution around.

Runs bootstrap automatically (quiet) if caps.json is missing. Exits non-zero
when no CLI path is available. Elements are space-joined, so a monorepo path
containing spaces would need manual handling (not the case in practice).
"""

from __future__ import annotations

import sys

from _lib import load_caps


def main() -> int:
    caps = load_caps()
    if not caps.get("can_render") or not caps.get("jto_argv"):
        print(
            "no jto CLI available — run bootstrap.py and check its warnings",
            file=sys.stderr,
        )
        return 1
    print(" ".join(caps["jto_argv"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
