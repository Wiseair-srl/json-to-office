---
'@json-to-office/core-pptx': minor
'@json-to-office/jto': patch
---

Calibrate the PPTX fit estimator against rendered output, and bound the deck blocks' slots in characters as well as words.

The width model wrapped by character count, which assumes each line is cut at the margin, so it under-counted the ragged edge — worst at display sizes, where a line holds fewest words. It also gave the first line a glyph's height instead of a line's, and set display sizes on a tighter line pitch than the renderer uses. Against 1,680 rendered boxes (twelve faces, seven sizes, five widths, four lengths) the model now wraps at word boundaries, takes a flat 1.2 line pitch, counts every line's leading, and measures each face by its own advance with an allowance for bold. Under-estimates fall from 19% of boxes to about 2%, none by more than a line.

The consulting deck's slots now bound characters too, because that is what wrapping depends on: sixteen ordinary words fit an action title, sixteen compound nouns do not. Cover title ≤ 110 characters (and a 20pt final step), cover subtitle ≤ 150, action titles ≤ 110, takeaway ≤ 28 words and 240 characters, kpi-row label ≤ 48, statement support ≤ 24 words and 150 characters in a box grown to hold them.

The deck's widest cases now render clean: the cover title no longer prints over the subtitle, and the statement support and action-chart takeaway no longer run past their boxes.
