---
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared': minor
---

Capabilities needed to reproduce professionally designed Office templates.

**PPTX** — `text.runs[]` for per-run styling and `lineSpacingMultiple` for
percent line spacing; `shape.fill.gradient` (linear/radial) and
`shape.fill.pattern` (OOXML preset hatches), both injected into slide XML at
package time since pptxgenjs exposes neither; `shape.angleRange` for
arc/pie/blockArc/chord plus `flipH`/`flipV`; chart passthrough for
`dataBorder`, grid lines, axis label fonts and sizes, axis line visibility,
marker size and bar overlap.

**DOCX** — paragraph/heading `indent`; paragraph `tabStops` with leaders and
literal tab runs; `font.scale` for glyph width; `font.size` now accepts up to
120pt for display typography; and root `props.themeOverrides`, a partial theme
deep-merged over the named theme so palette tokens, font roles and named styles
can be defined in-document rather than in an external theme file. `boldColor`
resolves theme tokens like every other color prop.

DOCX also gains a single shared generation prologue, so the plain and
plugin-aware entry points can no longer disagree about theme resolution.
