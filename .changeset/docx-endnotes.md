---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Add endnotes.

A `paragraph` now accepts `endnotes` alongside `footnotes`, with the same
`[{ id, text }]` shape and the same `[^id]` markers. The two differ only in
where Word puts the body: the foot of the page, or the end of the document.

- An id resolves against `footnotes` first, then `endnotes`. Declaring the same
  id in both warns and uses the footnote, so the result does not depend on prop
  order.
- Footnotes and endnotes number independently — they are separate OOXML parts —
  and both are emitted only when a marker actually resolves to them.
- Endnote text picks up the theme's `normal` style two points smaller, through
  Word's built-in `EndnoteText` / `EndnoteReference` styles.

The note schema and resolver are shared rather than duplicated:
`schemas/components/footnote.ts` becomes `note.ts` (exporting `NoteSchema`,
`FootnotesSchema`, `EndnotesSchema`) and `footnoteResolver.ts` becomes
`noteResolver.ts`. `endnotes` joins the per-instance props excluded from
`componentDefaults`.

Needs docx 9.7.1: `IPropertiesOptions.endnotes` does not exist in 9.5.1.
