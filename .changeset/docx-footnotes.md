---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Add footnotes.

A footnote is authored in two halves: an inline `[^id]` marker in a
`paragraph`'s text and the body declared on the same paragraph via a new
`footnotes` prop (`[{ id, text }]`). The marker renders as a
`w:footnoteReference` and the body lands in `word/footnotes.xml`, so Word
numbers the notes and places them at the foot of the page.

- `[^id]` is only syntax where footnotes are declared, so existing documents —
  including prose containing regex character classes like `[^a-z]+` — are
  untouched.
- Numbering follows reference order; a body no marker resolves to is not
  emitted and is reported. A repeated marker reuses the same note.
- Markers resolve at the leaf of the text parser, so `**bold[^n]**` keeps its
  emphasis and a marker beside a link still works. They are not recognised in
  text that also carries `{PLACEHOLDER}` substitutions, which now warns instead
  of failing silently.
- Footnote ids come from a per-render async-local registry, so concurrent
  generations cannot cross-reference each other's bodies.

`createWordStyles` now always emits the `default` styles key rather than only
when a document language is set, and fills in the `footnoteText` /
`footnoteReference` hooks from the theme's `normal` style two points smaller —
otherwise notes would render in Word's default font rather than the document's.
