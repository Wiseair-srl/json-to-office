---
'@json-to-office/jto-ops': patch
---

The rendered pass no longer takes a short upright word for rotated text, which made it report a paragraph as clipped.

A word was called rotated when it was half again as tall as it was wide. Three characters with a comma reach that standing in a paragraph — "it," measures 8.5 by 12.8 points in the report corpus — and a word taken for rotated text leaves its page's stream for the run after it, cutting the paragraph it sits in: the rendered pass then reported the paragraph as 29% rendered, "the rest nowhere on the page", while every word of it was on the page. Rotation is now read against the company a word keeps: a word in a line of prose shares its baseline with upright words its own size, while a chart's rotated axis title crosses lines set at another size entirely, and still reads as one run after the page. The measure is local, because a page-wide one reads the size the page mostly sets — a dense table of eight-point labels — which a line of ordinary prose then towers over.

This removes four false `W_QUALITY_RENDERED_CLIP` findings from the #409 verification corpus.
