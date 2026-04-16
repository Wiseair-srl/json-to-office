---
'@json-to-office/core-pptx': patch
---

Skip image probe when not needed (both w/h set, no contain/cover); guard NaN/negative dimension values; warn on zero-sized sizing box; consolidate slide render context into single param
