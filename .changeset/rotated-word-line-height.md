---
'@json-to-office/jto-ops': patch
---

The rendered pass no longer takes a short upright word for rotated text, which made it report a paragraph as clipped.

A word was called rotated when it was half again as tall as it was wide. Three characters with a comma reach that standing in a paragraph — "it," measures 8.5 by 12.8 points in the report corpus — and a word taken for rotated text leaves its page's stream for the run after it, cutting the paragraph it sits in: the rendered pass then reported the paragraph as 29% rendered, "the rest nowhere on the page", while every word of it was on the page. Rotation is now read against the page's own line height, measured from the words that are plainly upright, so a chart's rotated axis title still reads as one run after the page.

This removes four false `W_QUALITY_RENDERED_CLIP` findings from the #409 verification corpus.
