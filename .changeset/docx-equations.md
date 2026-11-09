---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto-cli': minor
---

DOCX equations. A new `equation` component draws a display formula written in LaTeX — `{ "name": "equation", "props": { "latex": "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" } }`, with optional `alignment` (default `center`) and `spacing` — and a `paragraph`, a `list` item and a table cell's text take inline formulas between `\(` and `\)`. Both become Word's own equations (`m:oMath`), editable in Word's equation editor: the `docxjs` renderer converts the LaTeX with docx's `latexToMath` and draws it with docx's `Math*` components, behind a new `math` renderer feature. `$…$` is not math, so prices stay prices. Whether a formula converts is asked of the renderer through a new optional `DocxRenderer.checkFormula`: `checkDocxFormulas(document, renderer?)` reports each one that will not as `invalid_latex` at its path, generation refuses it, `FormatAdapter.rendererDiagnostics` carries it to hosts, and `jto_validate` returns it as `E_INVALID_LATEX`. `office-open` reads no LaTeX, so its schema has no `equation` and any formula under it is refused by name. `@json-to-office/shared-docx` exports `collectFormulas`, `inlineMathSpans` and `INLINE_MATH_PATTERN`.
