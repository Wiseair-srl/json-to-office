---
'@json-to-office/core-docx': patch
'@json-to-office/shared-docx': patch
---

Review follow-ups on the docx issue batch:

- **Comments survive two paths that dropped them.** A comment on a paragraph
  whose text is markdown list syntax reached `createList` without it, and a
  comment on a table cell with no content was lost to the empty-cell early
  return. Both now anchor — the empty cell as a zero-length range plus its
  reference, which is what Word writes for a comment on an empty selection.
  Footnotes and endnotes now resolve on the markdown-list path too.
- **Notes alongside `revision` are announced, not swallowed.** Tracked-change
  text renders literally, so a `[^id]` marker inside it cannot resolve; the
  combination now warns and names the notes that will be dropped.
- **Duplicate note ids resolve first-declaration-wins**, within one array as
  well as across `footnotes` and `endnotes`, and warn. Previously a duplicate
  inside one array silently replaced the earlier body.
- **Cached TOC entries match a style mapping written either way.** `themeStyle`
  carries the theme key while `toc.styles[].styleId` may name the Word display
  name the `\t` switch needs; both forms are now indexed and looked up, so the
  cached entries no longer omit a row Word adds on refresh.
- **The table differ keeps authored row properties.** `cantSplit`,
  `tableHeader` and the rest travelled by index, which the diff invalidates by
  reinserting deleted rows; they now travel with their row and the diff's
  revision mark merges on top.
- **The table differ reports markdown-only edits**, matching the paragraph and
  list paths: a cell whose raw text changed but whose rendered text did not, and
  markdown flattened inside a revised cell, are both surfaced in
  `summary.untracked` instead of passing silently.
- **`includeComments` is restored as a deprecated no-op** rather than deleted.
  It never did anything, but `GenerateDocumentRequest` is a published type and
  removing the field narrowed it under callers that still pass it.
- Fixed the cross-process determinism test on Windows: it resolved the
  `node_modules/.bin/tsx` shell shim, which exists but cannot be spawned there,
  and embedded a bare Windows path as an ESM specifier.
