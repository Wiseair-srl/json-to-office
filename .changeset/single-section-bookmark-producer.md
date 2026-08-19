---
'@json-to-office/core-docx': patch
---

Collapse the two `sectionBookmarkId` producers into one.

`context.section.sectionBookmarkId` was written by two independent counters over
two different traversal orders — a loop-carried fold in `core/render.ts` and a
DFS counter on `context.custom.sectionBookmarks` in `components/section.ts` —
with the second shadowing the first, and one consumer (the section-scoped TOC)
reading whichever won. Both call sites now allocate from a single
`globalSectionBookmarkRegistry`, which owns both id namespaces and their
disjoint numeric link-id ranges, and remembers what each section resolved to.

The ordinal fold is extracted to `core/sectionOrdinals.ts` as a pure function
over the layout chunk list. Generated output is byte-identical.
