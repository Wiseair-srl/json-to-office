---
'@json-to-office/jto-ops': patch
---

The rendered pass no longer reports a table cell as clipped when poppler ran two cells of its row together.

Tight cell padding can leave the gap before the next cell as narrow as a word space, or narrower: 1.8pt in a row whose spaces are 2.6. The two cells then came out as one run of words, the reading order set a wrapped cell's second line after its neighbour ("operable by 2.1.1 Keyboard keyboard"), and the rendered pass reported the cell as cut off while every word of it was on the page. A row now also parts where a word starts on the edge of a column the rows around it mark, after a gap that is not the row's own word space, provided no row between them sets a word across that edge.

This removes the ten false `W_QUALITY_RENDERED_CLIP` findings left in the #409 verification corpus, every one a table cell; no other rendered finding in the corpus changes.
