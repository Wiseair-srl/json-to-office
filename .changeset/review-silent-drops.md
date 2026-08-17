---
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
---

Fix three props that validated and rendered while being silently ignored.

`font.characterSpacing` reached paragraphs but not headings, and was dropped
whenever the text contained a placeholder — so the same value rendered letter
tracking for plain text and lost it for `Generated on {DATE}`. Both paths
already forwarded `font.scale`.

An unknown `shape.fill.pattern.preset` warned that it was falling back to the
solid foreground and then set no fill at all, leaving the shape on the
pptxgenjs default. It now uses the pattern foreground, with an explicit
`fill.color` still taking precedence.

`props: null` surfaced as `Cannot read properties of null` from theme
resolution on the one entry point that runs no validator (`generateDocument`
with no `$schema`); it now throws a clear error naming the problem.
