---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/quality': minor
'@json-to-office/mcp-server': minor
---

The DOCX block tier, with its first block (#334). A block is a content
component with bounded slots that the pipeline lowers, purely, into the
existing primitives styled from the resolved theme. `key-takeaways` holds
3–5 one-sentence takeaways under a label and compiles to a rule in the
accent, the label in the theme's `label` role, a list and a closing
hairline, all read from the theme's `chrome.keyTakeaways` recipe (with
defaults that hold on a theme that declares none). The block stays where the
author put it — its compiled primitives become its `children` — so every
authored pointer keeps its address, and a source map ties each compiled node
back to its slot: a quality finding inside the box is reported at the
takeaway the author can patch. Too few or too many items is a schema error
at `/props/items`; an item over 25 words is the new `W_QUALITY_SLOT_BUDGET`
at that item. `jto_validate` gains `includeCompiled` to return the compiled
form, its source map and the lowered blocks' pointers.
