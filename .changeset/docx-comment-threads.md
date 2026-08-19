---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Add comment threads: replies and resolved state.

A `comment` now accepts `replies` (in order) and `resolved`. Every comment in a
thread anchors over the same range — how Word groups them in the review pane —
and thread parentage is derived rather than authored: the renderer allocates the
ids, sets each reply's parent, and lets docx write
`word/commentsExtended.xml` with the `w15:paraIdParent` links and `w15:done`
flags.

Word threads are one level deep, so a reply carries the comment fields without
threading of its own.

One docx limitation is surfaced rather than swallowed: the resolved flag lives
in `commentsExtended.xml`, which docx writes only when the document contains at
least one reply. Setting `resolved` on a comment with no replies anywhere warns
that the flag will not survive.

Needs docx 9.7.1 — none of the threading machinery exists in 9.5.1.
