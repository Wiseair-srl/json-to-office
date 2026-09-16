---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

Quality analysis sees what registered code components emit (#453). Both generators gain `prepareQuality`, which expands blocks and plugins the way generation does and returns the prepared quality model; the format adapters take `plugins` in their options, and the CLI and playground pass their loaded plugins. A finding inside plugin output reports at the invocation (the block evaluator records `pluginOutputs`, and `toAuthoredBlockPointer` collapses pointers under them). `pptx/minimum-font-size` no longer offers a fontSize patch on text a block or plugin generated.
