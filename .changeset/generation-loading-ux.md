---
'@json-to-office/jto': patch
---

Richer, more honest generation loading UI in the playground.

The full-screen "Generating Document" loader now shows the document's title,
a summary of what's being built (sections, visuals, images, tables,
paragraphs…), a live elapsed timer, and — once a build takes more than a few
seconds — rotating context hints tuned to the document (e.g. how many visuals
are being rasterized and that later builds reuse the cache). The active stage
uses an honest indeterminate sweep instead of a fake full progress bar, with
proper check icons for completed stages. The overlay shown over an existing
preview during rebuilds gains the stage message and elapsed time. Both
surfaces get a Cancel button wired to a new store-registered abort that
cancels the in-flight build quietly (no error banner).
