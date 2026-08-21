---
'@json-to-office/shared-docx': minor
---

Reject the two `text-box` `renderAs: "shape"` requests a shape can never honour
at validation instead of quietly rendering a table.

A shape carries an absolute size and has no autofit, and its outline carries no
dash pattern — so a shape without both `width` and `height`, or with a
`dashed`/`dotted`/`double` border, could only ever come back as the default
one-cell table. That downgrade was reported with a `console.warn`, which is
invisible in an editor that shows only the rendered result: the author asked for
a shape, got a table, and was told nothing. Both cases are now validation errors
naming the two ways out — fix the prop, or write `renderAs: "table"`, which
auto-fits and draws every border style.

The third fallback stays at render time: content that renders as a table rather
than a paragraph (a nested `columns`) depends on what the children produce, not
on the props, so no static check can see it coming.

Documents relying on either fallback now fail validation.
