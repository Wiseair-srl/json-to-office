---
'@json-to-office/shared-docx': patch
---

Reject `revision` together with `footnotes`/`endnotes` on a paragraph.

Tracked-change text renders from its segments as literal runs, so a `[^id]`
marker inside them never resolves and the declared note body was dropped. The
combination is not merely unimplemented — it is not expressible: docx's
`InsertedTextRun` and `DeletedTextRun` each wrap exactly one `TextRun` built
from their own options, so there is no way to place a footnote reference inside
`w:ins`/`w:del` without reaching past the library's public API.

Warning about it was not enough, since the schema still advertised a
combination the renderer could not honour. It is now a validation error, added
as a semantic rule (`collectNoteRevisionConflicts`) alongside the existing
image-source and indent mutual-exclusivity walks, so the exported JSON Schema
gains no conditional and editor completions are unchanged. The renderer keeps
its warning for callers that disable validation.

`diffDocuments` no longer emits the pair either: a paragraph it marks as a
tracked change has its notes stripped and reported in `summary.untracked`.
Without that, redlining a document whose paragraphs carry footnotes would
produce a redline that fails the new validation — the notes could never have
survived it anyway.

The same rule covers a table cell whose own `revision` drives the runs of a
paragraph inside it, and the table differ now keeps a component cell a
component — it previously replaced the content with a bare string when it
revised the cell, silently discarding the paragraph's font and other props.
