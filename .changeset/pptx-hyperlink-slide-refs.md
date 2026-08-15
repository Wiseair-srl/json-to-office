---
'@json-to-office/core-pptx': minor
---

fix(pptx): slide-targeted hyperlinks are authored-position based and never dangle

`hyperlink.slide` was written straight through to pptxgenjs, which turns it into a relationship to `ppt/slides/slideN.xml`. Nothing checked that the part existed, so an out-of-range number produced a relationship to a slide that is not in the archive — an ECMA-376 violation PowerPoint reports as a damaged file, with no warning from the generator. `enabled: false` made that reachable without anyone touching a slide number: dropping a mid-deck slide shortened the deck and shifted every slide after it.

`hyperlink.slide` now means **the Nth slide as authored in the JSON, counting slides switched off with `enabled: false`**, and is rebased onto the generated numbering at build time. Toggling a slide off no longer retargets the links that point past it — a link to authored slide 5 still lands on the content the author called slide 5, wherever it ends up. A ref that resolves to nothing (its target was switched off, or the number is outside the authored range) is dropped, and the component renders without a link plus a `HYPERLINK_SLIDE_UNRESOLVED` warning; it is never written as a dangling relationship. Decks with no disabled slides map one-to-one and are unchanged.
