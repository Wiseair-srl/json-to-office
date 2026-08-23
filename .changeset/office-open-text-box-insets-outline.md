---
'@json-to-office/core-docx': patch
---

Fix a shape-mode `text-box` losing its padding and border colour on `office-open`

A `text-box` with `renderAs: "shape"` built two option keys the backend does
not read, so both values were accepted and then dropped on the way out.

`style.padding` was emitted as `topInset`/`bottomInset`/`leftInset`/`rightInset`.
`a:bodyPr` takes `lIns`/`tIns`/`rIns`/`bIns` (or a `margins` object), and no
`*Inset` key exists anywhere in `@office-open/docx` — so every shape text box
drew with the format's default insets and its text sat against the border.

`style.border`'s colour was nested under `outline.fill`. `OutlineOptions` is
line properties and fill properties merged into one bag, and it carries the
colour at the top level; a nested `fill` is ignored, so the border drew in the
default colour rather than the authored one.

Both are corrected against the same helpers the drawing-group emitters use.
`docxjs` always had them right, so this only moves `office-open` output — and
only towards it: the two backends now emit the same insets and the same
`<a:ln>` for the same document.
