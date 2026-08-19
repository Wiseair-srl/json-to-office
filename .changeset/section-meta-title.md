---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/jto': minor
---

BREAKING (DOCX): `section` no longer accepts `title`/`level` props. They
conflated naming with content — a section title silently synthesized a
heading component at the top of the section (and bent TOC scoping and
pageBreak handling around it).

Sections now take `meta.title` instead: a pure authoring label, never
rendered, shown by editors and outlines (the playground sidebar uses it as
the section's outline label). For a visible title, add an explicit `heading`
child — what the synthesized heading was doing anyway, now stated in the
document.

Migration: `"props": { "title": "X", "level": 2 }` becomes
`"props": { "meta": { "title": "X" } }` plus, if the rendered heading was
wanted, a `{ "name": "heading", "props": { "text": "X", "level": 2 } }`
first child. Section-scoped TOCs still work via section bookmarks; they no
longer skip a synthesized title level. No stock template or example used
`title`.
