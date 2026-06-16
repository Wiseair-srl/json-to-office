---
'@json-to-office/core-docx': patch
---

fix(docx): honor lineSpacing and spacing on header/footer paragraphs

Paragraph modules in a section `header`/`footer` were rendered by a separate, minimal code path that only read font (family/size/bold/italic/color), text, and alignment. Any `font.lineSpacing` or paragraph `spacing` (before/after) set on a header/footer paragraph was silently dropped — it never reached the emitted OOXML.

Header/footer paragraphs now render through the same `createText` primitive as body paragraphs, so they honor `lineSpacing`, `spacing`, and the full font set (also `underline`, `boldColor`, `fontWeight`). Run-level font/size/color resolution against the theme's Normal style is preserved, so existing documents render unchanged unless they set these previously-ignored properties. Markdown link syntax in header/footer text is now parsed into hyperlinks, matching body paragraphs.
