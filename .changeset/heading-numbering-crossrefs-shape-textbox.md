---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
---

Apply `heading.props.numbering`, which the schema has always accepted and the
renderer always ignored. `true` binds the heading to one shared multilevel
definition — 1., 1.1., 1.1.1., with each level linked to its `Heading1`–`Heading6`
style — so Word renders the number and keeps it right when sections move. Turn
it on document-wide through `componentDefaults.heading.numbering`; `false` opts
a single heading out. A numbered heading's number also joins its cached TOC
entry, which is what keeps the cached copy and Word's own refresh in agreement.

Add `[@id]` cross-references to numbered headings and list items, alongside the
prerequisite per-item `id` on `list` items (which also makes an item an
internal-link target). `[@id]` writes a hyperlinked Word `REF` field carrying the
number as a cached value, so the PDF path — headless LibreOffice, which never
updates fields — shows it too; `:no_context`, `:full_context` and `:none` select
the other switches. A reference to an unknown id renders as literal text with a
warning rather than as Word's "Error! Reference source not found".

Add `text-box` `renderAs: 'shape'`, which emits a native Word text box (a WPS
DrawingML shape) instead of the default borderless one-cell table: real wrap
modes and z-order, at the cost of autofit, per-side borders and lazily-resolved
percentage sizes. `'table'` remains the default and is unchanged. Shape mode
falls back to the table rendering, with a warning, for content a shape cannot
hold (a nested `columns`) or a missing `width`/`height`.
