---
'@json-to-office/core-pptx': minor
---

fix(pptx): `enabled: false` on a slide actually drops the slide

Every PPTX component honours `enabled: false` — except the `slide` container itself. `processPresentation` walked the presentation's children and rendered each slide unconditionally, so a slide switched off in the JSON still appeared in the deck, at full size, in its original position. The check now runs on the slide node, matching both the component-level behaviour in this package and the way DOCX has always treated the flag.

**Decks that carry `enabled: false` slides get shorter.** A deck relying on the bug — a slide switched off but still expected in the output — will lose that slide and the ones after it will shift up. Remove the flag from any slide you want rendered. Slides with no `enabled` key are unaffected.
