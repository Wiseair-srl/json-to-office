---
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

Plugin builders: a document explicitly naming a known built-in theme now gets that built-in, instead of being shadowed by the constructor `theme` object. The constructor object still applies when the document names no theme or names something nothing recognizes (unknown-name fallback preserved). customThemes entries keep top precedence. Same contract in DOCX and PPTX.
