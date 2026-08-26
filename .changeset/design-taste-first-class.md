---
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/shared': minor
'@json-to-office/shared-pptx': patch
'@json-to-office/shared-docx': patch
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': patch
---

Design taste becomes a first-class citizen: schema-valid is not well-designed,
and the toolchain now says so (#216, #218).

**Quality collectors in the cores.** `collectPptxQualityFindings` and
`collectDocxQualityFindings` lint the design layer deterministically, before
any render: an undeclared slide canvas (the renderer silently falls back to
4:3), text estimated to overflow its declared box, an overcrowded slide, an
unreadable font size, table column widths no page can hold, a skipped heading
level. The rules read the same theme, style and grid tables the renderer
reads, so the estimate and the render cannot drift apart the way an external
checker's mirrored constants did. Findings are path-addressed like validation
errors, carry the measured values and a one-sentence fix, and are never
errors — `warning` means it almost certainly shows rendered, `info` means
worth a look. The `QualityFinding` shape and `W_QUALITY_*` code registry live
in `@json-to-office/shared`; `FormatAdapter` grows a `qualityCheck(doc)`.

**Surfaced where agents live.** The MCP server's `jto_validate` runs the
collectors on every call and reports the findings beside the structural
diagnostics without moving the `ok` gate; the server instructions and tool
description say to repair them like defects. A new `jto://themes/values`
resource serves what each built-in theme actually is — palette, fonts, style
tables — instead of a bare name, and the `pptx-minimal` starter now declares
its 16:9 canvas so the first document an agent copies models the rule.

**Calibrated against the corpus.** The thresholds are tuned so all stock
playground templates pass warning-clean, pinned by a regression suite —
a rule that flags known-good documents trains its consumers to ignore it.
`Company deck 4_3` was the one true positive: it relied on the renderer's
silent 4:3 fallback and now declares its canvas.
