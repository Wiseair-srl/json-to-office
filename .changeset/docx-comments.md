---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Add Word review comments (single, unthreaded).

`heading`, `paragraph`, `list` and table cells (header and body) accept a
`comment` prop — `{ text, author?, initials?, date? }`. The commented runs are
wrapped in a `w:commentRangeStart` / `w:commentRangeEnd` pair followed by a
`w:commentReference` run, with the body written to `word/comments.xml`. A
list-level comment spans the whole list: the range opens on the first rendered
item and closes on the last.

Comment ids come from their own registry — a separate OOXML namespace from the
`w:ins`/`w:del` ids, but the same per-render async-local scoping, so concurrent
generations cannot interleave counters. Author and date default to stable
values so identical input still produces identical bytes.

Supporting changes:

- `componentDefaults` now rejects `comment` as well as `revision`. Both come
  from one exported `PER_INSTANCE_PROPS` list, and the regression test is driven
  by that list so a future per-instance prop cannot be forgotten.
- New `'comment-ids'` cache-bypass reason (`ComponentBypassReason`), so a
  commented component is never served from the cross-document cache.
- The document differ no longer reports a changed `comment` as an untracked
  formatting change.
- Dropped the vestigial `includeComments` request flag: comments are authored on
  the components that carry them, so a request-level toggle has nothing to mean.
  The options object stays open, so existing callers are unaffected.
