---
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/shared': minor
'@json-to-office/shared-pptx': patch
'@json-to-office/shared-docx': patch
'@json-to-office/jto-ops': minor
'@json-to-office/jto-cli': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': patch
---

Design taste becomes a first-class citizen: schema-valid is not well-designed,
and the toolchain now says so (#216, #218).

**Quality collectors in the cores.** `collectPptxQualityFindings` and
`collectDocxQualityFindings` lint the design layer deterministically, before
any render: an undeclared slide canvas (the renderer silently falls back to
4:3), text estimated to overflow its declared box, an overcrowded slide, an
unreadable font size, table widths that exceed their actual section, a skipped
heading level. The collectors reuse renderer normalization — resolved themes,
document/component defaults, templates, placeholders, grids, disabled state
and page overrides — rather than rebuilding that logic from authored JSON.
Findings are path-addressed like validation errors, carry the measured values
and a one-sentence fix, and are never errors — `warning` means it almost
certainly shows rendered, `info` means worth a look. The `QualityFinding` shape
and `W_QUALITY_*` code registry live in `@json-to-office/shared`;
`FormatAdapter` gains an optional `qualityCheck(doc, options)` hook so existing
third-party adapters remain source-compatible.

**Surfaced where agents live.** The MCP server's `jto_validate` runs the
collectors on every call and reports the findings beside structural diagnostics
without moving the `ok` gate. CLI validation prints the same warnings; HTTP
validation returns them as `quality`; playground generation includes them in
its warning panel and preserves them on cache hits. A new
`jto://themes/values` resource loads complete built-in values in ESM — palette,
fonts, style tables — instead of returning empty maps, and the `pptx-minimal`
starter now declares its 16:9 canvas so the first document an agent copies
models the rule.

**Calibrated against the corpus.** The thresholds are tuned so all stock
playground templates pass warning-clean, pinned by a regression suite —
a rule that flags known-good documents trains its consumers to ignore it.
`Company deck 4_3` was the one true positive: it relied on the renderer's
silent 4:3 fallback and now declares its canvas.
