---
'@json-to-office/mcp-server': minor
---

`jto_preview` gains `contactSheet: true` — one labelled image tiling every selected page.

Cross-page consistency is a question about the set: does every section opener look like the others, does the rhythm hold, is the running head on all of them. Asked one page at a time it costs twenty images and answers none of them; asked as a contact sheet it is a single look. The sheet renders at 72 DPI unless `dpi` says otherwise, and each cell carries its page number, so a finding on the sheet can be followed up with a full-resolution preview of that page.

The composition is plain Node — decode the 8-bit PNGs poppler writes, box-average them down, paste them into a grid, encode one PNG back out. Shelling out to an image tool would have been shorter and would have added a third way for preview to be unavailable on a host that has LibreOffice and poppler. Averaging rather than sampling matters: a page of 9pt text sampled at one pixel in five is speckle, and the sheet exists so that the text still reads as text.

Delivery follows the same contract as an over-budget page set — inline when it fits, written to the output root with an `info` diagnostic when it does not, refused only when `outputMode: "images"` demanded inlining. The ceiling is bytes _and_ pixels, because bytes alone let the useless case through: forty near-empty pages tile into a nine-megapixel sheet that still deflates under two megabytes, and a client scales an image that large down to roughly 1500px before a model ever sees it, taking every thumbnail below the size at which its text reads. Past four megapixels the sheet is written at full size instead, where it can be opened and zoomed.

Overlap with the per-page path is deliberate: the pages are still listed with their sizes and cache state, so a caller that spots something on the sheet can ask for that page alone at full resolution.
