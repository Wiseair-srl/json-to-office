---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': patch
---

fix(docx): repeat table headers by default, and resolve cell colours through the theme

Two table fixes that change how already-shipped documents render.

**Header rows now repeat across page breaks.** `repeatHeaderOnPageBreak` has carried `default: true` in the exported JSON Schema since it was introduced, but `createTable` forwarded the raw prop to docx, so an omitted value meant "do not repeat" — the schema and the renderer disagreed. Any table that spans a page break and never set the prop explicitly will now show its header row at the top of each page. Set `"repeatHeaderOnPageBreak": false` on the table to keep the old rendering. The prop description (which said "Defaults to false") now matches the schema.

**Cell `color` / `backgroundColor` accept theme colour names.** Both were handed to docx verbatim, so only a 6-digit hex (with or without `#`) and `"auto"` ever produced a file: a theme colour name such as `"primary"`, a CSS keyword, or a typo aborted generation with docx's internal `Invalid hex value 'x'. Expected 6 digit hex value`. They now resolve the same way paragraph and heading colours do — theme colour name or `#RRGGBB` — with bare 6-digit hex and `"auto"` still accepted. Bare hex is normalised to uppercase on the way through, as `#RRGGBB` values already were, so a cell written `"backgroundColor": "abc123"` now reaches docx as `ABC123`. An unresolvable value still stops generation, but with a message that names the offending prop and lists what it accepts.

`"transparent"` is a `backgroundColor`-only sentinel (it is consumed at the shading site and has no `w:color` meaning). On `backgroundColor` it behaves as before; on `color` it used to abort generation inside docx and is now ignored, with a `TABLE_CELL_COLOR_INVALID` warning, so the cell's text takes the table style's colour. Documents that set `color: "transparent"` on a cell previously failed to build and will now build — check those cells if you were relying on the failure.
