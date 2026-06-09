---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

feat(docx): tracked-change document diff

Diff two docx JSON definitions into a redline rendered as native Word tracked
changes (accept/reject, author, timestamp; opens in review mode).

- New `revision` prop on `paragraph`/`heading`/`list` items and a
  `trackRevisions` root prop, rendered as `w:ins`/`w:del`.
- `diffDocuments(oldDoc, newDoc)` (word-level diff, block alignment, fidelity
  summary), re-exported from `@json-to-office/json-to-docx`.
- CLI: `jto docx diff <old> <new> -o redline.docx`.
- Playground: `POST /api/docx/diff` endpoint and a Compare dialog that opens
  the redline as a normal document with live preview.
