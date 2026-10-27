---
'@json-to-office/core-docx': patch
---

A registered custom (plugin) component with `enabled: false` is now disabled, as every standard node already was. Its `render` never runs (nor any service call it would make) and nothing it would emit reaches the document, wherever the node sits: at the top level, inside a standard container, or emitted by another custom component's `render`. `standardDefinition` and `preservedDefinition` keep the node as authored, flag included, the way they keep a disabled standard node. A document with `blocks` used to reject a disabled custom component as an unknown component; it now generates.
