---
'@json-to-office/core-pptx': minor
---

Generate presentations whose slides omit `props`. Validation has always accepted a slide with no `props` — every slide prop is optional, so the deep validator checks an empty object — but generation dereferenced `props.placeholders` unguarded and died on those documents with `TypeError: Cannot read properties of undefined`. `SlideComponentDefinition['props']` is now optional too, matching what validation accepts.
