---
'@json-to-office/core-docx': patch
---

Give every bookmark its own `w:id`, so a cross-reference can read its target's
text.

`w:id` is what pairs a `w:bookmarkStart` with its `w:bookmarkEnd`, and docx
emits `w:id="1"` for every bookmark it builds: its `Bookmark` constructor
creates a fresh id generator per instance, so the counter never advances past
one (dolanmiu/docx#3478, unfixed in 9.7.1). Every range in the document
therefore opened and closed on the same id. Navigating by name still worked,
which is why internal links and the numeric cross-reference switches looked
healthy, but `[@id:none]` — which asks Word for the _text_ inside the range —
rendered blank in LibreOffice, and so in every exported PDF.

Bookmarks now take their numeric id from the render-scoped bookmark registry,
in a range disjoint from the section bookmarks, and are emitted as an explicit
start/end pair rather than through docx's `Bookmark`. Verified against both
LibreOffice 25.x and the 7.4 that the hosted playground runs.
