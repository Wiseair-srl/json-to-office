---
'@json-to-office/core-pptx': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
---

Four more consulting deck blocks as JSON definitions in `consulting-deck-blocks.pptx.json` (#341): `cover` (client and date in the eyebrow, the title in the title role over the theme's cover rule, subtitle, optional logo, confidentiality), `kpi-row` (an action title over two to four figures in equal cells, value and unit in the stat role with the delta and label beneath), `two-column` (prose or up to five bullets beside a chart, table or image at a 1.1 : 1 split) and `statement` (one assertion in the display role with thirty words of support). Every slide of the deck now invokes a block; the definitions own their geometry as percentage frames, bind every size to a theme role with a safe default, and render warning-clean in both pipelines and both renderers on every bundled theme and canvas. The block catalogue, the playground's completions and the design guide pick them up from the template; nothing is registered.
