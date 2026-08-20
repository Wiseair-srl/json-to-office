---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Add table row insert/delete and cell text revisions, and teach the differ to
diff tables row by row.

**Authoring.** The table model is column-major, so anything belonging to a whole
row lives in a new row-parallel `props.rows` array indexed like
`columns[].cells`: `{ revision?, cantSplit?, tableHeader? }`. A row `revision`
is structural (`{ type: 'insert' | 'delete', author?, date? }`) — the existing
`Revision` shape cannot express it, since it requires text segments. Cells now
also accept a `revision` of their own, so a plain string cell can carry tracked
changes without being wrapped in a paragraph.

Marking a row deleted emits both halves Word needs: `w:trPr/w:del` **and** every
cell's runs and closing paragraph mark marked deleted. Without the second half,
accepting the change leaves an empty row behind instead of removing it. An
inserted row is marked symmetrically.

**Differ.** `diffDocuments` no longer treats a column-based table as opaque. It
builds a row-major view, aligns rows on their markdown-stripped cell texts, and
pairs unmatched runs — so a rewritten row becomes cell-level word changes rather
than a delete plus an insert. A deleted table is kept in the redline with every
row marked deleted rather than being dropped. Column-count changes, header-row
changes and the legacy `{ headers, rows }` shape stay on the block-replace path
and are reported in `summary.untracked`.

**Not included**, and reported as untracked: cell merging (the schema has no
merge state for a revision to describe) and the `*PrChange` family, which would
require the differ to synthesise a fully-resolved old-version options object.

`rows` is excluded from `componentDefaults.table`: `Type.Partial` is shallow and
`rows` is optional on a table, so a theme could otherwise mark the same row of
every table inserted or deleted. `columns` is deliberately left alone — theme
defaults replace arrays wholesale rather than merging them element-wise, and
`columns` is required on every table, so a theme's `columns` (and any comment or
revision inside it) can never reach one.
